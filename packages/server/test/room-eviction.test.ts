// Black-box room-eviction probes: emptied rooms are deleted from the
// `rooms` map (observable via /health), occupied rooms survive, and a
// re-hello after eviction works. Raw node:net WS client, no dependencies
// (mirrors the handshake.test.ts dist-or-tsx-fallback and
// freePort+spawn+poll idiom).
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
  private continuations: Buffer[] = [];
  private fragmented = false;

  private constructor(socket: net.Socket, leftover: Buffer) {
    this.socket = socket;
    this.buffer = leftover;
    this.socket.on("data", (chunk: Buffer) => this.push(chunk));
    this.socket.on("error", () => {});
  }

  static async connect(port: number, target = "/"): Promise<WsClient> {
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
        if (this.fragmented) continue;
        this.emit({ t: "text", text: payload.toString("utf8") });
      } else if (opcode === 0x0) {
        this.continuations.push(payload);
      } else if (opcode === 0x8) {
        this.emit({ t: "close", code: payload.length >= 2 ? payload.readUInt16BE(0) : 0 });
      } else if (opcode === 0x9) {
        // Server ping: answer with a masked pong so the link never stalls.
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
    if (this.fragmented === false && this.continuations.length > 0) {
      // Test server never fragments; flush defensively if it ever does.
      const text = Buffer.concat(this.continuations.splice(0)).toString("utf8");
      this.emit({ t: "text", text });
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

  /** Next parsed server snapshot, skipping welcomes/joins/leave banners. */
  async nextSnapshot(timeoutMs = 1500): Promise<{ body: Record<string, unknown> }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.next(Math.max(50, deadline - Date.now()));
      if (msg.t !== "text") {
        continue;
      }
      const body = JSON.parse(msg.text) as Record<string, unknown>;
      if (body["t"] === "snapshot") {
        return { body };
      }
    }
    throw new Error("timed out waiting for snapshot");
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

async function dial(proc: ServerProc, target = "/"): Promise<WsClient> {
  const client = await WsClient.connect(proc.port, target);
  clients.push(client);
  return client;
}

async function roomsCount(port: number): Promise<number> {
  const health = await getJson(port, "/health");
  expect(health.status).toBe(200);
  return (JSON.parse(health.body) as Record<string, unknown>)["rooms"] as number;
}

/** Poll /health until `rooms` reads `want` (2s budget). */
async function waitRooms(port: number, want: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    last = await roomsCount(port);
    if (last === want) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for rooms=${want}, last saw ${last}`);
}

async function helloWelcome(
  client: WsClient,
  view: string,
  name: string,
): Promise<Record<string, unknown>> {
  client.sendJson({ t: "hello", proto: 1, view, name });
  const msg = await client.next(1000);
  expect(msg.t).toBe("text");
  const welcome = JSON.parse((msg as { t: "text"; text: string }).text) as Record<string, unknown>;
  expect(welcome["t"]).toBe("welcome");
  return welcome;
}

describe("server room eviction", () => {
  it("empty room is evicted: rooms drops back to 0 after the last socket leaves", async () => {
    const proc = await launch();
    const client = await dial(proc);
    await helloWelcome(client, "evict-solo", "Alice");
    expect(await roomsCount(proc.port)).toBe(1);
    client.destroy();
    await waitRooms(proc.port, 0);
  });

  it("probing many view names does not accumulate rooms once sockets close", async () => {
    const proc = await launch();
    const viewers: WsClient[] = [];
    for (let i = 0; i < 5; i += 1) {
      const client = await dial(proc);
      viewers.push(client);
      await helloWelcome(client, `evict-${i}`, `Viewer${i}`);
    }
    expect(await roomsCount(proc.port)).toBe(5);
    for (const viewer of viewers) {
      viewer.destroy();
    }
    await waitRooms(proc.port, 0);
  });

  it("occupied room survives one disconnect and the observer still gets snapshots", async () => {
    const proc = await launch();
    const alice = await dial(proc);
    await helloWelcome(alice, "evict-shared", "Alice");
    const bob = await dial(proc);
    await helloWelcome(bob, "evict-shared", "Bob");
    expect(await roomsCount(proc.port)).toBe(1);
    bob.destroy();
    // The room stays while Alice remains, and she still observes ticks.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await roomsCount(proc.port)).toBe(1);
    const snapshot = await alice.nextSnapshot(1500);
    expect(Array.isArray(snapshot.body["players"])).toBe(true);
  });

  it("re-hello after eviction yields a welcome and recreates the room", async () => {
    const proc = await launch();
    const first = await dial(proc);
    await helloWelcome(first, "evict-return", "Alice");
    expect(await roomsCount(proc.port)).toBe(1);
    first.destroy();
    await waitRooms(proc.port, 0);
    const second = await dial(proc);
    const welcome = await helloWelcome(second, "evict-return", "Bob");
    expect(welcome["t"]).toBe("welcome");
    expect(typeof welcome["pid"]).toBe("number");
    expect(await roomsCount(proc.port)).toBe(1);
  });
});
