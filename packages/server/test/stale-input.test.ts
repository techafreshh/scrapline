// Stale-input regression probes (issue #241): latched inputs must not
// outlive the socket that wrote them. Abrupt close resets the slot to
// neutral, non-owner writes never latch, and graceful leave severs the
// owner binding without breaking resume. Raw node:net WS client, no
// dependencies (mirrors the room-eviction.test.ts dist-or-tsx fallback
// and freePort+spawn+poll idiom).
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
        this.emit({ t: "text", text: payload.toString("utf8") });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function helloWelcome(
  client: WsClient,
  view: string,
  name: string,
): Promise<{ pid: number; session: string }> {
  client.sendJson({ t: "hello", proto: 1, view, name });
  const msg = await client.next(1000);
  expect(msg.t).toBe("text");
  const welcome = JSON.parse((msg as { t: "text"; text: string }).text) as Record<string, unknown>;
  expect(welcome["t"]).toBe("welcome");
  expect(typeof welcome["pid"]).toBe("number");
  expect(typeof welcome["session"]).toBe("string");
  return { pid: welcome["pid"] as number, session: welcome["session"] as string };
}

function rowFor(body: Record<string, unknown>, pid: number): Record<string, unknown> | undefined {
  const players = body["players"];
  if (!Array.isArray(players)) {
    return undefined;
  }
  for (const item of players) {
    if (typeof item === "object" && item !== null && (item as Record<string, unknown>)["id"] === pid) {
      return item as Record<string, unknown>;
    }
  }
  return undefined;
}

/** Next snapshot carrying a row for pid (skips snapshots from before the join). */
async function snapshotWithPid(
  client: WsClient,
  pid: number,
  timeoutMs = 2000,
): Promise<{ x: number; tick: number; body: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await client.nextSnapshot(Math.max(50, deadline - Date.now()));
    const row = rowFor(body, pid);
    if (row === undefined) {
      continue;
    }
    const x = row["x"];
    const tick = body["tick"];
    if (typeof x === "number" && typeof tick === "number") {
      return { x, tick, body };
    }
  }
  throw new Error(`no snapshot row for pid ${pid} within budget`);
}

/**
 * Displacement rate for pid over a wall-clock window: consumes the live
 * snapshot stream from its oldest queued frame to a fresh one, so stale
 * queue tails flush through the window instead of skewing one interval.
 * Returns px per world tick plus row presence.
 */
async function windowDrift(
  client: WsClient,
  pid: number,
  windowMs: number,
): Promise<{ dx: number; dticks: number; rate: number; present: boolean }> {
  const first = await snapshotWithPid(client, pid, 2000);
  const deadline = Date.now() + windowMs;
  let last = first;
  while (Date.now() < deadline) {
    try {
      last = await snapshotWithPid(client, pid, Math.max(60, deadline - Date.now() + 150));
    } catch {
      break;
    }
  }
  const dx = Math.abs(last.x - first.x);
  const dticks = Math.max(1, last.tick - first.tick);
  return { dx, dticks, rate: dx / dticks, present: rowFor(last.body, pid) !== undefined };
}

/** Discard the stale queued tail so the next window measures fresh ticks. */
async function drainSnapshots(client: WsClient, budgetMs = 400): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      await client.nextSnapshot(Math.max(50, deadline - Date.now()));
    } catch {
      return;
    }
  }
}

function drive(client: WsClient, session: string, moveX = 1): void {
  client.sendJson({ t: "input", session, moveX, aim: 0, buttons: 0 });
}

describe("server stale session inputs", () => {
  it("abrupt close resets the latched input to neutral while the row persists", async () => {
    const proc = await launch();
    const driver = await dial(proc);
    const infoD = await helloWelcome(driver, "stale-close", "Driver");
    const observer = await dial(proc);
    await helloWelcome(observer, "stale-close", "Observer");

    // Latch a full-right intent, then measure the driving rate live.
    drive(driver, infoD.session, 1);
    await sleep(80);
    drive(driver, infoD.session, 1);
    const driving = await windowDrift(observer, infoD.pid, 600);
    expect(driving.present).toBe(true);
    // Full stick at 290px/s steps ~4.8px/tick; 0.5px/tick keeps 10x margin
    // for loaded runners while still proving the slot was driving.
    expect(driving.rate).toBeGreaterThan(0.5);

    // Abrupt transport drop with no leave frame; the observer keeps the room alive.
    driver.destroy();
    await sleep(500);
    await drainSnapshots(observer, 400);
    const after = await windowDrift(observer, infoD.pid, 600);
    // Backfill pins the row: the player idles on neutral input, never drops.
    expect(after.present).toBe(true);
    expect(after.rate).toBeLessThan(Math.max(0.4, driving.rate * 0.35));
  });

  it("non-owner input writes are ignored and the socket stays usable", async () => {
    const proc = await launch();
    const victim = await dial(proc);
    const infoV = await helloWelcome(victim, "stale-hijack", "Victim");
    const observer = await dial(proc);
    await helloWelcome(observer, "stale-hijack", "Observer");
    const attacker = await dial(proc);
    const infoA = await helloWelcome(attacker, "stale-hijack", "Attacker");

    // A live non-owner socket sprays the victim session with full-right
    // intents; the ownership gate must drop every frame silently.
    for (let i = 0; i < 3; i += 1) {
      attacker.sendJson({ t: "input", session: infoV.session, moveX: 1, aim: 0, buttons: 0 });
      await sleep(60);
    }
    // No close and no error reply on the hijacking socket: the 60 Hz loop
    // stays quiet and the socket stays usable for its own session.
    const quietDeadline = Date.now() + 300;
    while (Date.now() < quietDeadline) {
      try {
        const msg = await attacker.next(Math.max(50, quietDeadline - Date.now()));
        if (msg.t === "close") {
          throw new Error("hijack input closed the socket");
        }
        const body = JSON.parse((msg as { t: "text"; text: string }).text) as Record<
          string,
          unknown
        >;
        expect(body["t"]).not.toBe("error");
      } catch (err) {
        if (err instanceof Error && err.message.includes("timed out waiting for frame")) {
          break;
        }
        throw err;
      }
    }

    await drainSnapshots(observer, 300);
    const drift = await windowDrift(observer, infoV.pid, 700);
    expect(drift.present).toBe(true);
    // The victim never drifts: neutral holds under load (<0.4px/tick).
    expect(drift.rate).toBeLessThan(0.4);

    // The hijacking socket is still fully usable on its own session.
    drive(attacker, infoA.session, 1);
    await sleep(80);
    drive(attacker, infoA.session, 1);
    const own = await windowDrift(observer, infoA.pid, 600);
    expect(own.present).toBe(true);
    expect(own.rate).toBeGreaterThan(0.5);
  });

  it("graceful leave severs the binding but re-join plus input resumes drift", async () => {
    const proc = await launch();
    const driver = await dial(proc);
    const infoD = await helloWelcome(driver, "stale-leave", "Driver");
    const observer = await dial(proc);
    await helloWelcome(observer, "stale-leave", "Observer");

    drive(driver, infoD.session, 1);
    await sleep(80);
    drive(driver, infoD.session, 1);
    const driving = await windowDrift(observer, infoD.pid, 600);
    expect(driving.present).toBe(true);
    expect(driving.rate).toBeGreaterThan(0.5);

    // Graceful leave resets the slot; post-leave frames from the severed
    // socket must not re-arm it.
    driver.sendJson({ t: "leave", session: infoD.session });
    await sleep(200);
    for (let i = 0; i < 3; i += 1) {
      drive(driver, infoD.session, 1);
      await sleep(60);
    }
    // The severed socket gets no close for the ignored post-leave inputs:
    // it may still observe snapshots, but never a close frame.
    const quietDeadline = Date.now() + 300;
    while (Date.now() < quietDeadline) {
      try {
        const msg = await driver.next(Math.max(50, quietDeadline - Date.now()));
        if (msg.t === "close") {
          throw new Error("post-leave input closed the socket");
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("timed out waiting for frame")) {
          break;
        }
        throw err;
      }
    }
    await drainSnapshots(observer, 400);
    const stilled = await windowDrift(observer, infoD.pid, 600);
    expect(stilled.present).toBe(true);
    expect(stilled.rate).toBeLessThan(Math.max(0.4, driving.rate * 0.35));

    // Same-socket resume re-acquires the binding and inputs latch again.
    driver.sendJson({ t: "join", session: infoD.session });
    const joinDeadline = Date.now() + 1000;
    let welcome: Record<string, unknown> | null = null;
    while (Date.now() < joinDeadline && welcome === null) {
      const msg = await driver.next(Math.max(50, joinDeadline - Date.now()));
      expect(msg.t).toBe("text");
      const body = JSON.parse((msg as { t: "text"; text: string }).text) as Record<
        string,
        unknown
      >;
      if (body["t"] === "welcome") {
        welcome = body;
      }
    }
    expect(welcome).not.toBeNull();
    drive(driver, infoD.session, 1);
    await sleep(80);
    drive(driver, infoD.session, 1);
    await drainSnapshots(observer, 300);
    const revived = await windowDrift(observer, infoD.pid, 600);
    expect(revived.present).toBe(true);
    expect(revived.rate).toBeGreaterThan(0.5);
  });
});
