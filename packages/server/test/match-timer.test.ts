// Black-box match-timer probes (issue #254): the snapshot carries the
// room's authoritative remaining time (tick plus timeLimitTicks) and two
// staggered clients observe the same clock at the same wall moment.
// Raw node:net WS client, no dependencies (mirrors the
// snapshot.test.ts freePort+spawn+poll idiom); never imports the server
// module.
import { describe, expect, it, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_SERVER = path.join(HERE, "..", "dist", "server.js");
const SRC_SERVER = path.join(HERE, "..", "src", "server.ts");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as net.AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

async function getJson(port: number, pathname: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: res.status, body: await res.text() };
}

/** Spawned server: dist bundle when built, tsx src fallback otherwise. */
class ServerProc {
  readonly child: ChildProcess;
  readonly port: number;

  constructor(port: number) {
    this.port = port;
    if (fs.existsSync(DIST_SERVER)) {
      this.child = spawn(process.execPath, [DIST_SERVER], {
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      this.child = spawn("npx", ["tsx", SRC_SERVER, String(port)], {
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
  }

  /** Poll /health until it answers 200 with status ok (2s budget). */
  async waitHealthy(timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const health = await getJson(this.port, "/health");
        if (health.status === 200 && health.body.includes('"status":"ok"')) {
          return;
        }
        lastError = new Error(`unexpected health response: ${health.status} ${health.body}`);
      } catch (err) {
        lastError = err;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`server did not become healthy in time: ${String(lastError)}`);
  }

  kill(): void {
    if (this.child.exitCode === null) {
      this.child.kill();
    }
  }
}

/** Masked client text frame for a JSON value. */
function maskedText(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const mask = crypto.randomBytes(4);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x81;
  const out = Buffer.alloc(header.length + 4 + payload.length);
  header.copy(out, 0);
  mask.copy(out, header.length);
  for (let i = 0; i < payload.length; i += 1) {
    out[header.length + 4 + i] = (payload[i] as number) ^ (mask[i % 4] as number);
  }
  return out;
}

type Inbound = { t: "text"; text: string } | { t: "close"; code: number };

/** Raw WS client speaking masked frames over node:net. */
class WsClient {
  readonly socket: net.Socket;
  private buffer: Buffer;
  private readonly queue: Inbound[] = [];
  private waiters: Array<(msg: Inbound) => void> = [];

  private constructor(socket: net.Socket, leftover: Buffer) {
    this.socket = socket;
    this.buffer = leftover;
    this.socket.on("data", (chunk: Buffer) => this.push(chunk));
    this.socket.on("error", () => {});
  }

  static async connect(port: number, target = "/room"): Promise<WsClient> {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(port, "127.0.0.1", () => resolve(s));
      s.once("error", reject);
      setTimeout(() => reject(new Error("connect timeout")), 2000);
    });
    const key = crypto.randomBytes(16).toString("base64");
    socket.write(
      `GET ${target} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
    const leftover = await new Promise<Buffer>((resolve, reject) => {
      let head = Buffer.alloc(0);
      const timer = setTimeout(() => reject(new Error("handshake timeout")), 2000);
      const onData = (chunk: Buffer): void => {
        head = Buffer.concat([head, chunk]);
        const idx = head.indexOf("\r\n\r\n");
        if (idx >= 0) {
          clearTimeout(timer);
          socket.removeListener("data", onData);
          const status = head.subarray(0, idx).toString("utf8").split("\r\n")[0];
          if (!status?.includes("101")) {
            reject(new Error(`handshake rejected: ${status}`));
            return;
          }
          resolve(head.subarray(idx + 4));
        }
      };
      socket.on("data", onData);
      socket.once("error", reject);
    });
    return new WsClient(socket, leftover);
  }

  sendJson(value: unknown): void {
    this.socket.write(maskedText(value));
  }

  private push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x1) {
        this.emit({ t: "text", text: payload.toString("utf8") });
      } else if (opcode === 0x8) {
        this.emit({ t: "close", code: payload.length >= 2 ? payload.readUInt16BE(0) : 0 });
      } else if (opcode === 0x9) {
        const mask = crypto.randomBytes(4);
        const pong = Buffer.alloc(2 + 4 + payload.length);
        pong[0] = 0x8a;
        pong[1] = 0x80 | payload.length;
        mask.copy(pong, 2);
        for (let i = 0; i < payload.length; i += 1) {
          pong[6 + i] = (payload[i] as number) ^ (mask[i % 4] as number);
        }
        this.socket.write(pong);
      }
    }
  }

  private emit(msg: Inbound): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter(msg);
    } else {
      this.queue.push(msg);
    }
  }

  next(timeoutMs = 1000): Promise<Inbound> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), timeoutMs);
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  /** Skip non-snapshot texts until a snapshot arrives (or the budget runs out). */
  async nextSnapshot(timeoutMs = 1500): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.next(Math.max(50, deadline - Date.now()));
      if (msg.t !== "text") {
        throw new Error(`expected text frame, got close ${msg.code}`);
      }
      const body = JSON.parse(msg.text) as Record<string, unknown>;
      if (body["t"] === "snapshot") {
        return body;
      }
    }
    throw new Error("no snapshot frame within budget");
  }

  /** Drain every queued text frame without blocking (welcome reads). */
  drainTexts(): string[] {
    const out: string[] = [];
    while (this.queue.length > 0) {
      const msg = this.queue.shift() as Inbound;
      if (msg.t === "text") {
        out.push(msg.text);
      }
    }
    return out;
  }

  destroy(): void {
    this.waiters.splice(0);
    try {
      this.socket.destroy();
    } catch {
      // Already gone.
    }
  }
}

const procs: ServerProc[] = [];
const clients: WsClient[] = [];

afterEach(() => {
  while (clients.length > 0) {
    (clients.pop() as WsClient).destroy();
  }
  while (procs.length > 0) {
    (procs.pop() as ServerProc).kill();
  }
});

async function launch(): Promise<ServerProc> {
  const proc = new ServerProc(await freePort());
  procs.push(proc);
  await proc.waitHealthy();
  return proc;
}

async function dial(proc: ServerProc, target = "/room"): Promise<WsClient> {
  const client = await WsClient.connect(proc.port, target);
  clients.push(client);
  return client;
}

async function hello(
  client: WsClient,
  name: string,
  timeoutMs = 1000,
): Promise<Record<string, unknown>> {
  client.sendJson({ t: "hello", proto: 1, view: "dune", name });
  const msg = await client.next(timeoutMs);
  if (msg.t !== "text") {
    throw new Error(`expected welcome text, got close ${msg.code}`);
  }
  return JSON.parse(msg.text) as Record<string, unknown>;
}

describe("server match timer", () => {
  it("welcome carries the authoritative time cap alongside the room tick", async () => {
    const proc = await launch();
    const client = await dial(proc);
    const welcome = await hello(client, "Alice");
    expect(welcome["t"]).toBe("welcome");
    expect(typeof welcome["tick"]).toBe("number");
    expect(Number.isFinite(welcome["tick"] as number)).toBe(true);
    // The cap rides the welcome so the HUD renders the room countdown
    // from the first frame, never a join-relative 5:00.
    expect(typeof welcome["timeLimitTicks"]).toBe("number");
    expect(Number.isFinite(welcome["timeLimitTicks"] as number)).toBe(true);
    expect(welcome["timeLimitTicks"] as number).toBeGreaterThan(0);
  });

  it("staggered clients observe the same tick and cap at the same wall moment", async () => {
    const proc = await launch();
    const alice = await dial(proc);
    const welcomeA = await hello(alice, "Alice");
    const sessionA = welcomeA["session"] as string;
    // Let the room clock advance before Bob joins late.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const bob = await dial(proc);
    const welcomeB = await hello(bob, "Bob");
    const sessionB = welcomeB["session"] as string;
    // Bob's welcome tick is later than Alice's: the clock is room-owned.
    expect(welcomeB["tick"] as number).toBeGreaterThanOrEqual(welcomeA["tick"] as number);
    expect(welcomeB["timeLimitTicks"]).toBe(welcomeA["timeLimitTicks"]);

    // Both clients poll snapshots at the same wall moment: the remaining
    // time (cap minus tick) must agree, so both HUDs render one value.
    alice.sendJson({ t: "input", session: sessionA, tick: 0, moveX: 0, aim: 0, buttons: 0 });
    bob.sendJson({ t: "input", session: sessionB, tick: 0, moveX: 0, aim: 0, buttons: 0 });
    const [firstA, snapB] = await Promise.all([
      alice.nextSnapshot(1500),
      bob.nextSnapshot(1500),
    ]);
    // Drain Alice's pre-Bob backlog (queued while Bob was dialing) so
    // both heads are post-join broadcasts from the same wall moment.
    let snapA = firstA;
    while ((snapA["tick"] as number) < (welcomeB["tick"] as number)) {
      snapA = await alice.nextSnapshot(1500);
    }
    for (const snap of [snapA, snapB]) {
      expect(typeof snap["tick"]).toBe("number");
      expect(Number.isFinite(snap["tick"] as number)).toBe(true);
      expect(typeof snap["timeLimitTicks"]).toBe("number");
      expect(snap["timeLimitTicks"]).toBe(welcomeA["timeLimitTicks"]);
    }
    // Same broadcast cadence: both snapshots land within one 20 Hz
    // quantum of each other, so the remaining agrees to the second.
    expect(Math.abs((snapA["tick"] as number) - (snapB["tick"] as number))).toBeLessThanOrEqual(6);
    const remainingA = (snapA["timeLimitTicks"] as number) - (snapA["tick"] as number);
    const remainingB = (snapB["timeLimitTicks"] as number) - (snapB["tick"] as number);
    expect(Math.abs(remainingA - remainingB)).toBeLessThanOrEqual(6);
  });

  it("snapshot ticks advance while the cap stays fixed", async () => {
    const proc = await launch();
    const client = await dial(proc);
    const welcome = await hello(client, "Alice");
    const session = welcome["session"] as string;
    client.sendJson({ t: "input", session, tick: 0, moveX: 0, aim: 0, buttons: 0 });
    const first = await client.nextSnapshot(1500);
    const second = await client.nextSnapshot(1500);
    expect(second["tick"] as number).toBeGreaterThan(first["tick"] as number);
    expect(second["timeLimitTicks"]).toBe(first["timeLimitTicks"]);
  });
});
