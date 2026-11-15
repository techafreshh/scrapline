// Black-box snapshot-broadcast probes: hello -> welcome -> inputs yields
// 20 Hz JSON snapshots with numeric ticks and finite x/y rows. Raw
// node:net WS client, no dependencies (mirrors the handshake.test.ts
// freePort+spawn+poll idiom); never imports the server module.
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
  async nextSnapshot(timeoutMs = 1500): Promise<{ tick: number; at: number; players: unknown[] }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.next(Math.max(50, deadline - Date.now()));
      if (msg.t !== "text") {
        throw new Error(`expected text frame, got close ${msg.code}`);
      }
      const body = JSON.parse(msg.text) as Record<string, unknown>;
      if (body["t"] === "snapshot") {
        const players = Array.isArray(body["players"]) ? body["players"] : [];
        return { tick: body["tick"] as number, at: Date.now(), players };
      }
    }
    throw new Error("no snapshot frame within budget");
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

describe("server snapshot broadcast", () => {
  it("hello -> welcome, then inputs yield a snapshot with numeric tick and finite x/y rows", async () => {
    const proc = await launch();
    const client = await dial(proc);
    client.sendJson({ t: "hello", proto: 1, view: "dune" });
    const first = await client.next(1000);
    expect(first.t).toBe("text");
    const welcome = JSON.parse((first as { t: "text"; text: string }).text) as Record<
      string,
      unknown
    >;
    expect(welcome["t"]).toBe("welcome");
    expect(typeof welcome["session"]).toBe("string");
    const session = welcome["session"] as string;
    for (let i = 0; i < 5; i += 1) {
      client.sendJson({ t: "input", session, tick: i, moveX: 0, aim: 0, buttons: 0 });
    }
    const snapshot = await client.nextSnapshot(1500);
    expect(typeof snapshot.tick).toBe("number");
    expect(Number.isFinite(snapshot.tick)).toBe(true);
    expect(snapshot.players.length).toBeGreaterThanOrEqual(1);
    for (const item of snapshot.players) {
      const row = item as Record<string, unknown>;
      expect(typeof row["x"]).toBe("number");
      expect(typeof row["y"]).toBe("number");
      expect(Number.isFinite(row["x"] as number)).toBe(true);
      expect(Number.isFinite(row["y"] as number)).toBe(true);
    }
  });

  it("streams consecutive snapshots ~50ms apart (20 Hz within 20-120ms)", async () => {
    const proc = await launch();
    const client = await dial(proc);
    client.sendJson({ t: "hello", proto: 1, view: "dune" });
    const first = await client.next(1000);
    expect(first.t).toBe("text");
    const welcome = JSON.parse((first as { t: "text"; text: string }).text) as Record<
      string,
      unknown
    >;
    const session = welcome["session"] as string;
    client.sendJson({ t: "input", session, tick: 0, moveX: 0, aim: 0, buttons: 0 });
    const firstSnap = await client.nextSnapshot(1500);
    const secondSnap = await client.nextSnapshot(1500);
    expect(secondSnap.tick).not.toBe(firstSnap.tick);
    const gap = secondSnap.at - firstSnap.at;
    expect(gap).toBeGreaterThanOrEqual(20);
    expect(gap).toBeLessThanOrEqual(120);
  });
});
