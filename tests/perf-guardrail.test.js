// Performance-guardrail regression tests for issue #87: the PixiJS engine
// must ship as a lazy pixi-*.js chunk (never synchronous in main.js), the
// initial main.js must stay under 400kB gzipped, and the served page must
// paint a "Loading" screen while the canvas stays hidden until the chunk
// (or the canvas2d fallback) is ready.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const CLIENT_DIST = path.join(ROOT, "packages", "client", "dist");
const CLIENT_SRC_HTML = path.join(ROOT, "packages", "client", "index.html");

/** Raw bytes of the largest assets/pixi-*.js chunk (throws when absent). */
function pixiChunk() {
  const assets = path.join(CLIENT_DIST, "assets");
  const names = fs
    .readdirSync(assets)
    .filter((n) => n.startsWith("pixi-") && n.endsWith(".js"));
  assert.ok(names.length >= 1, "expected an assets/pixi-*.js chunk in dist");
  let best = null;
  for (const name of names) {
    const file = path.join(assets, name);
    const size = fs.statSync(file).size;
    if (best === null || size > best.size) {
      best = { name, file, size };
    }
  }
  return best;
}

test("lazy pixi chunk exists and clears 200kB raw", () => {
  const chunk = pixiChunk();
  assert.ok(
    chunk.size > 200 * 1024,
    `pixi chunk ${chunk.name} is ${chunk.size} bytes, expected >200kB`,
  );
});

test("no synchronous vendor lib.js remains in dist", () => {
  const lib = path.join(CLIENT_DIST, "assets", "lib.js");
  assert.ok(
    !fs.existsSync(lib),
    "assets/lib.js must be gone: the pixi engine ships as pixi-*.js",
  );
});

test("initial main.js is lazy and under 400kB gzipped", () => {
  const main = path.join(CLIENT_DIST, "main.js");
  const source = fs.readFileSync(main, "utf8");
  // No static `from "./assets/..."` import: the pixi chunk is fetched
  // only through the dynamic import() behind the loading screen.
  assert.doesNotMatch(
    source,
    /from\s*["']\.\/assets\//,
    "main.js must not statically import the pixi chunk",
  );
  assert.match(
    source,
    /import\(\s*["']\.\/assets\/pixi-/,
    "main.js must dynamically import the pixi chunk",
  );
  // No synchronous engine code: pixi internals tag logs "pixi.js/...".
  assert.ok(
    !source.includes("pixi.js/"),
    "main.js must not embed pixi.js engine code synchronously",
  );
  const gzipped = zlib.gzipSync(fs.readFileSync(main)).length;
  assert.ok(
    gzipped < 400 * 1024,
    `main.js gzips to ${gzipped} bytes, expected <400kB`,
  );
});

test("loading screen ships in source and built HTML", () => {
  for (const file of [
    CLIENT_SRC_HTML,
    path.join(CLIENT_DIST, "index.html"),
  ]) {
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /id="loading"/, `${file} needs a #loading overlay`);
    assert.match(html, /Loading/, `${file} needs Loading progress text`);
    assert.ok(
      html.includes('<canvas id="game">'),
      `${file} must ship the bare canvas tag`,
    );
    assert.match(
      html,
      /#game\s*\{[^}]*visibility:\s*hidden/,
      `${file} must hide the canvas via stylesheet until the chunk resolves`,
    );
  }
});

test("renderer reveals the canvas only after the chunk settles", () => {
  const main = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "main.ts"),
    "utf8",
  );
  assert.match(main, /revealCanvas/, "main.ts must define a canvas reveal");
  assert.match(
    main,
    /Loading PixiJS engine/,
    "main.ts must show engine progress text while fetching",
  );
});

// Live HTTP contract below: the served page carries the loading screen
// and the served pixi chunk matches the dist bytes.

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
    bytes: null,
  };
}

async function getBytes(pathname) {
  const res = await fetch(base + pathname);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    bytes: buf,
  };
}

before(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
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

test("GET / paints Loading before the canvas", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /Loading/);
  assert.match(root.text, /id="loading"/);
  assert.ok(root.text.includes('<canvas id="game">'), "page must ship the bare canvas tag");
  assert.match(root.text, /#game\s*\{[^}]*visibility:\s*hidden/);
});

test("GET /assets/pixi-*.js serves the >200kB lazy chunk", async () => {
  const chunk = pixiChunk();
  const res = await getBytes(`/assets/${chunk.name}`);
  assert.equal(res.status, 200);
  assert.match(res.contentType, /javascript/);
  assert.ok(
    res.bytes.length > 200 * 1024,
    `served pixi chunk is ${res.bytes.length} bytes, expected >200kB`,
  );
});
