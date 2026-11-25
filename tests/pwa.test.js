// Offline-first PWA contract tests (issue #159): live HTTP probes against
// a spawned server.js for /sw.js and /manifest.webmanifest (status,
// content-types, body shape) plus the page wiring that boots the game with
// a storage-safe fallback. Mirrors tests/skeleton.test.js (freePort +
// spawned server.js + get() helpers).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");

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
  child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname + "/..",
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
      lastError = new Error(`unexpected health: ${health.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${lastError}`);
});

after(() => {
  if (child !== null) {
    child.kill();
    child = null;
  }
});

test("GET /sw.js returns 200 JavaScript carrying the versioned cache", async () => {
  const worker = await get("/sw.js");
  assert.equal(worker.status, 200);
  assert.match(worker.contentType, /javascript/);
  assert.match(worker.text, /scrapline-v\d+/);
  assert.match(worker.text, /addEventListener\(\s*['"]fetch['"]/);
});

test("GET /manifest.webmanifest returns 200 manifest JSON with name and icons", async () => {
  const manifest = await get("/manifest.webmanifest");
  assert.equal(manifest.status, 200);
  assert.match(manifest.contentType, /manifest\+json|application\/json/);
  const parsed = JSON.parse(manifest.text);
  assert.equal(parsed.name, "Scrapline");
  assert.ok(Array.isArray(parsed.icons) && parsed.icons.length >= 2);
  for (const icon of parsed.icons) {
    assert.match(String(icon.src), /\.png$/);
  }
});

test("GET / wires the manifest link and the safe worker registration", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /<link rel="manifest"/);
  assert.match(root.text, /manifest\.webmanifest/);
  assert.match(root.text, /serviceWorker/);
  assert.match(root.text, /continuing online-only/);
});

test("GET /icons/icon-512.png returns 200 PNG for the manifest icon", async () => {
  const res = await fetch(base + "/icons/icon-512.png");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /image\/png/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(Array.from(buf.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(buf.readUInt32BE(16), 512);
  assert.equal(buf.readUInt32BE(20), 512);
});

test("GET /icons/icon-192-maskable.png returns 200 maskable PNG", async () => {
  const res = await fetch(base + "/icons/icon-192-maskable.png");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /image\/png/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.readUInt32BE(16), 192);
  assert.equal(buf.readUInt32BE(20), 192);
});

test("HEAD /sw.js returns 200 with a JavaScript content-type", async () => {
  const res = await fetch(base + "/sw.js", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /javascript/);
});

test("HEAD /manifest.webmanifest returns 200 with a manifest content-type", async () => {
  const res = await fetch(base + "/manifest.webmanifest", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(
    res.headers.get("content-type") || "",
    /manifest\+json|application\/json/,
  );
});
