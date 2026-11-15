#!/usr/bin/env node
// Online two-client smoke probe (issue #218): headless, zero-dependency
// (node:net/crypto/child_process/fs only). Boots the authoritative server,
// asserts health, two headless WS clients joining with both pids in one
// snapshot within 2s, bogus-session 4002, malformed close (no hang),
// double-join error with a still-usable socket, and a 2MB payload closing
// 1009 — each within 1s. First port wins everywhere: argv/PORT lists split
// on whitespace, commas, semicolons, or colons resolve to the first finite
// integer. Exits 0 with ALL GREEN, or 1 with a one-line FAIL reason.
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST_SERVER = path.join(HERE, "..", "..", "packages", "server", "dist", "server.js");
const SRC_SERVER = path.join(HERE, "..", "..", "packages", "server", "src", "server.ts");

/** First finite positive integer in a port-list token (first port wins). */
function firstPortInteger(text) {
  if (typeof text === "number") {
    return Number.isFinite(text) && text > 0 ? Math.floor(text) : undefined;
  }
  if (typeof text !== "string") {
    return undefined;
  }
  for (const part of text.split(/[\s,;:]+/)) {
    if (part.length === 0) {
      continue;
    }
    const n = Number(part);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
  }
  return undefined;
}

/** Free loopback port for the spawned server (verify-presentation idiom). */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const assigned = probe.address().port;
      probe.close(() => resolve(assigned));
    });
  });
}

/**
 * Probe port: first integer across argv then PORT (lists split on
 * whitespace/commas/semicolons/colons), else a free pick. The raw PORT
 * value passes through to the server env so the server's own first-port
 * resolution is exercised end to end.
 */
async function resolveProbePort() {
  for (const arg of process.argv.slice(2)) {
    const found = firstPortInteger(arg);
    if (found !== undefined) {
      return { port: found, raw: process.env.PORT };
    }
  }
  const fromEnv = firstPortInteger(process.env.PORT);
  if (fromEnv !== undefined) {
    return { port: fromEnv, raw: process.env.PORT };
  }
  return { port: await freePort(), raw: undefined };
}

async function getHealth(port, pathname) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: res.status, body: await res.text() };
}

/** Masked client frame for arbitrary bytes (any length, incl. 2MB). */
function maskedFrame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  let header;
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
  header[0] = 0x80 | opcode;
  const out = Buffer.alloc(header.length + 4 + payload.length);
  header.copy(out, 0);
  mask.copy(out, header.length);
  for (let i = 0; i < payload.length; i += 1) {
    out[header.length + 4 + i] = payload[i] ^ mask[i % 4];
  }
  return out;
}

/** Raw WS client speaking masked frames over node:net (no dependencies). */
class WsClient {
  constructor(socket, leftover) {
    this.socket = socket;
    this.buffer = leftover;
    this.queue = [];
    this.waiters = [];
    this.socket.on("data", (chunk) => this.push(chunk));
    this.socket.on("error", () => {});
  }

  static async connect(port, target = "/") {
    const socket = await new Promise((resolve, reject) => {
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
    const leftover = await new Promise((resolve, reject) => {
      let head = Buffer.alloc(0);
      const timer = setTimeout(() => reject(new Error("handshake timeout")), 2000);
      const onData = (chunk) => {
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
    const client = new WsClient(socket, leftover);
    if (leftover.length > 0) {
      client.push(Buffer.alloc(0));
    }
    return client;
  }

  sendJson(value) {
    this.socket.write(maskedFrame(0x1, Buffer.from(JSON.stringify(value), "utf8")));
  }

  sendRawText(text) {
    this.socket.write(maskedFrame(0x1, Buffer.from(text, "utf8")));
  }

  sendBytes(opcode, payload) {
    this.socket.write(maskedFrame(opcode, payload));
  }

  push(chunk) {
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
        this.sendBytes(0xa, Buffer.from(payload));
      } else if (opcode === 0xa) {
        this.emit({ t: "pong" });
      }
    }
  }

  emit(msg) {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter(msg);
    } else {
      this.queue.push(msg);
    }
  }

  next(timeoutMs = 1000) {
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

  destroy() {
    this.waiters.splice(0);
    try {
      this.socket.destroy();
    } catch {
      // Already gone.
    }
  }
}

let server = null;
const clients = [];

function fail(reason) {
  for (const client of clients.splice(0)) {
    client.destroy();
  }
  if (server !== null) {
    try {
      server.kill();
    } catch {
      // Already gone.
    }
  }
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

/** Skip non-snapshot frames until a snapshot carrying every pid arrives. */
async function waitSnapshotWithPids(client, pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msg = await client.next(Math.max(50, deadline - Date.now())).catch(() => null);
    if (msg === null) {
      break;
    }
    if (msg.t !== "text") {
      fail(`expected snapshot text while waiting for pids, got close ${msg.code}`);
    }
    let body;
    try {
      body = JSON.parse(msg.text);
    } catch {
      continue;
    }
    if (body?.t !== "snapshot" || !Array.isArray(body.players)) {
      continue;
    }
    const ids = new Set(body.players.map((p) => p?.id));
    if (pids.every((pid) => ids.has(pid))) {
      return body;
    }
  }
  fail(`snapshot containing pids [${pids.join(",")}] never arrived`);
}

/** Skip snapshots until an error frame arrives (or a welcome, which fails). */
async function waitError(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msg = await client.next(Math.max(50, deadline - Date.now())).catch(() => null);
    if (msg === null) {
      break;
    }
    if (msg.t === "close") {
      fail(`double-join closed the socket with ${msg.code} instead of erroring`);
    }
    let body;
    try {
      body = JSON.parse(msg.text);
    } catch {
      continue;
    }
    if (body?.t === "welcome") {
      fail("double-join yielded a second welcome instead of an error");
    }
    if (body?.t === "error") {
      return body;
    }
  }
  fail("double-join error frame never arrived");
}

async function main() {
  const { port, raw } = await resolveProbePort();
  const env = { ...process.env, PORT: raw ?? String(port) };
  if (fs.existsSync(DIST_SERVER)) {
    server = spawn(process.execPath, [DIST_SERVER], { env, stdio: ["ignore", "pipe", "pipe"] });
  } else {
    server = spawn("npx", ["tsx", SRC_SERVER, String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  }

  // Health 200 with status ok (2s).
  {
    const deadline = Date.now() + 2000;
    let last = "no response";
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const health = await getHealth(port, "/health");
        if (health.status === 200 && health.body.includes('"status":"ok"')) {
          healthy = true;
          break;
        }
        last = `${health.status} ${health.body}`;
      } catch (err) {
        last = String(err);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!healthy) {
      fail(`health never OK on first port ${port}: ${last}`);
    }
  }

  // Two headless clients join; one snapshot carries both pids (2s).
  const alice = await WsClient.connect(port, "/play").catch((err) => fail(`alice connect: ${err.message}`));
  clients.push(alice);
  const bob = await WsClient.connect(port, "/play").catch((err) => fail(`bob connect: ${err.message}`));
  clients.push(bob);
  alice.sendJson({ t: "hello", proto: 1, view: "dune", name: "Alice" });
  const welcomeAlice = await alice.next(1000).catch(() => fail("alice got no welcome within 1s"));
  if (welcomeAlice.t !== "text") {
    fail(`alice welcome closed with ${welcomeAlice.code}`);
  }
  let parsedAlice;
  try {
    parsedAlice = JSON.parse(welcomeAlice.text);
  } catch {
    fail("alice welcome is not JSON");
  }
  bob.sendJson({ t: "hello", proto: 1, view: "dune", name: "Bob" });
  const welcomeBob = await bob.next(1000).catch(() => fail("bob got no welcome within 1s"));
  if (welcomeBob.t !== "text") {
    fail(`bob welcome closed with ${welcomeBob.code}`);
  }
  let parsedBob;
  try {
    parsedBob = JSON.parse(welcomeBob.text);
  } catch {
    fail("bob welcome is not JSON");
  }
  if (typeof parsedAlice.pid !== "number" || typeof parsedBob.pid !== "number") {
    fail("welcome frames carry no numeric pids");
  }
  await waitSnapshotWithPids(alice, [parsedAlice.pid, parsedBob.pid], 2000);

  // Bogus session join closes 4002 (1s).
  {
    const bogus = await WsClient.connect(port).catch((err) => fail(`bogus connect: ${err.message}`));
    clients.push(bogus);
    bogus.sendJson({ t: "join", session: "bogus-zzz" });
    const msg = await bogus.next(1000).catch(() => fail("bogus join never closed within 1s"));
    if (msg.t !== "close" || msg.code !== 4002) {
      fail(`bogus join closed with ${msg.t === "close" ? msg.code : "text"} instead of 4002`);
    }
  }

  // Malformed hello closes cleanly without hanging (1s).
  {
    const malformed = await WsClient.connect(port).catch((err) => fail(`malformed connect: ${err.message}`));
    clients.push(malformed);
    malformed.sendRawText("not-json{{{");
    const msg = await malformed.next(1000).catch(() => fail("malformed hello hung (no close within 1s)"));
    if (msg.t !== "close") {
      fail("malformed hello got a text reply instead of a close");
    }
  }

  // Double-join errors on the open socket, which stays usable (1s).
  {
    alice.sendJson({ t: "join", session: parsedAlice.session });
    const errBody = await waitError(alice, 1000);
    if (errBody.code !== "already-joined") {
      fail(`double-join error code is ${errBody.code} instead of already-joined`);
    }
    alice.sendJson({ t: "input", session: parsedAlice.session, moveX: 0, aim: 0, buttons: 0 });
    await waitSnapshotWithPids(alice, [parsedAlice.pid, parsedBob.pid], 1000).catch(() =>
      fail("socket unusable after double-join error (no snapshot within 1s)"),
    );
  }

  // 2MB masked text frame closes 1009 (1s).
  {
    const huge = await WsClient.connect(port).catch((err) => fail(`huge connect: ${err.message}`));
    clients.push(huge);
    huge.sendBytes(0x1, Buffer.alloc(2 * 1024 * 1024, 0x78));
    const msg = await huge.next(1000).catch(() => fail("2MB payload never closed within 1s"));
    if (msg.t !== "close" || msg.code !== 1009) {
      fail(`2MB payload closed with ${msg.t === "close" ? msg.code : "text"} instead of 1009`);
    }
  }

  for (const client of clients.splice(0)) {
    client.destroy();
  }
  server.kill();
  console.log("ONLINE SMOKE: ALL GREEN");
}

main().catch((err) => fail(String(err?.message ?? err)));
