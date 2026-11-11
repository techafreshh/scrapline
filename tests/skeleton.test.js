// Walking-skeleton contract tests: live HTTP probes against a spawned
// server plus a source-shape check on the deterministic World stub.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

let child = null;
let base = "";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
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
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await get("/api/health");
      if (health.status === 200 && health.text.includes('"status":"ok"')) {
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

test("GET /api/health returns 200 JSON containing status ok", async () => {
  const health = await get("/api/health");
  assert.equal(health.status, 200);
  assert.match(health.contentType, /application\/json/);
  assert.match(health.text, /"status":"ok"/);
});

test("GET / serves a page containing the game canvas", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /<canvas/);
  assert.match(root.text, /id="game"/);
});

test("GET /main.js serves the 60Hz tick loop", async () => {
  const loop = await get("/main.js");
  assert.equal(loop.status, 200);
  assert.match(loop.text, /__scraplineTick/);
  assert.match(loop.text, /setInterval/);
});

test("core World source exports class World with step() and hash()", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "core", "src", "world.ts"),
    "utf8",
  );
  assert.match(source, /export\s+(class|const).*World|class\s+World/);
  assert.match(source, /class\s+World/);
  assert.match(source, /\bstep\s*\(/);
  assert.match(source, /\bhash\s*\(/);
});
