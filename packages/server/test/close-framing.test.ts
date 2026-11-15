// Close-framing probes: short-close black-box regression plus direct
// execution of the shipped frameClose for boundary/long reasons.
// The shipped src is never imported (importing executes top-level listen);
// instead the function text is read and evaluated in isolation.
import { describe, expect, it, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";

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

function maskedText(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const mask = crypto.randomBytes(4);
  const header = Buffer.alloc(2);
  header[0] = 0x81;
  header[1] = 0x80 | payload.length;
  const out = Buffer.alloc(header.length + 4 + payload.length);
  header.copy(out, 0);
  mask.copy(out, header.length);
  for (let i = 0; i < payload.length; i += 1) {
    out[header.length + 4 + i] = (payload[i] as number) ^ (mask[i % 4] as number);
  }
  return out;
}

const procs: ServerProc[] = [];
const sockets: net.Socket[] = [];

afterEach(() => {
  while (sockets.length > 0) {
    try {
      (sockets.pop() as net.Socket).destroy();
    } catch {
      // Already gone.
    }
  }
  while (procs.length > 0) {
    (procs.pop() as ServerProc).kill();
  }
});

function readRawClose(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let head = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error("close timeout")), 1000);
    const onData = (chunk: Buffer): void => {
      head = Buffer.concat([head, chunk]);
      if (head.length >= 2) {
        clearTimeout(timer);
        socket.removeListener("data", onData);
        resolve(head);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function rawHandshake(port: number): Promise<{ socket: net.Socket; leftover: Buffer }> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1", () => resolve(s));
    s.once("error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 2000);
  });
  sockets.push(socket);
  const key = crypto.randomBytes(16).toString("base64");
  socket.write(
    `GET / HTTP/1.1\r\n` +
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
        resolve(head.subarray(idx + 4));
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
  return { socket, leftover };
}

/** Evaluate the shipped frameClose source in isolation (no top-level listen). */
function loadFrameClose(): (code: number, reason?: string) => Buffer {
  const src = fs.readFileSync(SRC_SERVER, "utf8");
  const match = /function frameClose\([\s\S]*?\n\}/.exec(src);
  if (match === null) {
    throw new Error("frameClose source not found");
  }
  const sandbox: Record<string, unknown> = { Buffer };
  vm.createContext(sandbox);
  // The shipped source is TypeScript: erase its annotations so plain node:vm
  // can evaluate the exact shipped logic unmodified in behavior.
  const js = match[0]
    .replace(/\(code: number, reason = ""\)/, '(code, reason = "")')
    .replace(/\): Buffer/, ")")
    .replace("let header: Buffer;", "let header;");
  const fn = vm.runInContext(`${js}\nframeClose;`, sandbox) as (
    code: number,
    reason?: string,
  ) => Buffer;
  return fn;
}

/** Minimal RFC 6455 server-frame parser for round-trip assertions. */
function parseClose(frame: Buffer): { opcode: number; code: number; reason: string } {
  const opcode = (frame[0] as number) & 0x0f;
  const marker = (frame[1] as number) & 0x7f;
  let len: number;
  let offset: number;
  if (marker < 126) {
    len = marker;
    offset = 2;
  } else if (marker === 126) {
    len = frame.readUInt16BE(2);
    offset = 4;
  } else {
    len = Number(frame.readBigUInt64BE(2));
    offset = 10;
  }
  const payload = frame.subarray(offset, offset + len);
  return {
    opcode,
    code: payload.length >= 2 ? payload.readUInt16BE(0) : 0,
    reason: payload.length > 2 ? payload.subarray(2).toString("utf8") : "",
  };
}

describe("close framing", () => {
  it("bogus session close arrives as short 2-byte header 0x88 with code 4002", async () => {
    const proc = new ServerProc(await freePort());
    procs.push(proc);
    await proc.waitHealthy();
    const { socket, leftover } = await rawHandshake(proc.port);
    const initial = leftover.length > 0 ? leftover : Buffer.alloc(0);
    socket.write(maskedText({ t: "join", session: "bogus-zzz" }));
    const raw = Buffer.concat([initial, await readRawClose(socket)]);
    const expectedLen = 2 + Buffer.byteLength("unknown session", "utf8");
    expect(raw[0]).toBe(0x88);
    expect(raw[1]).toBe(expectedLen);
    const parsed = parseClose(raw);
    expect(parsed.opcode).toBe(0x8);
    expect(parsed.code).toBe(4002);
    expect(parsed.reason).toBe("unknown session");
  });

  it("123-char reason stays short form, 124-char reason uses 126 extended form", () => {
    const frameClose = loadFrameClose();
    const short = frameClose(4002, "a".repeat(123));
    expect(short[0]).toBe(0x88);
    expect(short[1]).toBe(125);
    expect(short.length).toBe(2 + 125);
    expect(parseClose(short).reason).toBe("a".repeat(123));

    const boundary = frameClose(4002, "a".repeat(124));
    expect(boundary[0]).toBe(0x88);
    expect(boundary[1]).toBe(126);
    expect(boundary.readUInt16BE(2)).toBe(126);
    expect(boundary.length).toBe(4 + 126);
    const parsed = parseClose(boundary);
    expect(parsed.opcode).toBe(0x8);
    expect(parsed.code).toBe(4002);
    expect(parsed.reason).toBe("a".repeat(124));
  });

  it("300-char reason round-trips through the 126 extended form", () => {
    const frameClose = loadFrameClose();
    const reason = "b".repeat(300);
    const frame = frameClose(4002, reason);
    expect(frame[0]).toBe(0x88);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(2 + 300);
    const parsed = parseClose(frame);
    expect(parsed.code).toBe(4002);
    expect(parsed.reason).toBe(reason);
  });

  it("~66KB reason uses the 127 extended form with intact code and reason", () => {
    const frameClose = loadFrameClose();
    const reason = "c".repeat(66000);
    const frame = frameClose(4002, reason);
    const payloadLen = 2 + Buffer.byteLength(reason, "utf8");
    expect(frame[0]).toBe(0x88);
    expect(frame[1]).toBe(127);
    expect(frame.readBigUInt64BE(2)).toBe(BigInt(payloadLen));
    expect(frame.length).toBe(10 + payloadLen);
    const parsed = parseClose(frame);
    expect(parsed.code).toBe(4002);
    expect(parsed.reason).toBe(reason);
  });
});
