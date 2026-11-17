// Walking-skeleton contract probes (issue #260): black-box checks over
// the `npm start` launcher with no build output present — /health ok,
// / serves html with the loading screen, /api/state carries players+tick,
// and a raw WS hello to /room yields a welcome with players+tick.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const net = require("node:net");
const path = require("node:path");

let child = null;
let base = "";
let port = 0;

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

async function get(pathname) {
  const res = await fetch(base + pathname);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    text: await res.text(),
  };
}

before(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  // Boot through the `npm start` launcher so the no-dist fallback path
  // is what the probes exercise, exactly as a clean clone would.
  child = spawn(process.execPath, ["scripts/start-combined.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // 5s health budget from process start (issue #260 acceptance).
  const deadline = Date.now() + 5000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await get("/health");
      if (health.status === 200 && health.text.includes('"ok"')) {
        return;
      }
      lastError = new Error(`unexpected health response: ${health.status} ${health.text}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy in time: ${lastError}`);
});

after(() => {
  if (child !== null) {
    child.kill();
    child = null;
  }
});

test("GET /health returns 200 containing ok within 5s of server start", async () => {
  const health = await get("/health");
  assert.equal(health.status, 200);
  assert.match(health.text, /"ok"/);
});

test("GET / returns 200 text/html containing loading", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.contentType, /text\/html/);
  assert.match(root.text, /loading/i);
});

test("GET /api/state returns 200 JSON with players array and numeric tick", async () => {
  const state = await get("/api/state");
  assert.equal(state.status, 200);
  assert.match(state.contentType, /application\/json/);
  const body = JSON.parse(state.text);
  assert.ok(Array.isArray(body.players), "players must be an array");
  assert.equal(typeof body.tick, "number");
});

test("WS hello to /room yields welcome with players and numeric tick", async () => {
  const welcome = await helloRoom({ t: "hello", proto: 1, view: "dune", name: "Probe" });
  assert.equal(welcome.t, "welcome");
  assert.ok(Array.isArray(welcome.players), "players must be an array");
  assert.equal(typeof welcome.tick, "number");
});

/** Masked client text frame for a JSON value. */
function maskedText(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
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
  header[0] = 0x81;
  const out = Buffer.alloc(header.length + 4 + payload.length);
  header.copy(out, 0);
  mask.copy(out, header.length);
  for (let i = 0; i < payload.length; i += 1) {
    out[header.length + 4 + i] = payload[i] ^ mask[i % 4];
  }
  return out;
}

/** Raw WS hello against /room; resolves with the first text frame body. */
function helloRoom(hello) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for welcome"));
    }, 2000);
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    const key = crypto.randomBytes(16).toString("base64");
    socket.write(
      "GET /room HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${key}\r\n` +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const idx = buffer.indexOf("\r\n\r\n");
        if (idx < 0) {
          return;
        }
        const status = buffer.subarray(0, idx).toString("utf8").split("\r\n")[0];
        if (!status.includes("101")) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`handshake rejected: ${status}`));
          return;
        }
        upgraded = true;
        buffer = buffer.subarray(idx + 4);
        socket.write(maskedText(hello));
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) {
            return;
          }
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) {
            return;
          }
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + length) {
          return;
        }
        const payload = buffer.subarray(offset, offset + length);
        buffer = buffer.subarray(offset + length);
        if (opcode === 0x1) {
          clearTimeout(timer);
          socket.destroy();
          try {
            resolve(JSON.parse(payload.toString("utf8")));
          } catch (err) {
            reject(err);
          }
          return;
        }
        if (opcode === 0x8) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error("server closed before welcome"));
          return;
        }
      }
    });
  });
}
