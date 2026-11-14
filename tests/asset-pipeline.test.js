// CC0 asset-pipeline contract tests (issue #143): the CC0-only source dir,
// the LICENSES.md manifest, the built atlas shape, the 6 MB budget, and
// the live GET /assets/atlas.json route served through server.js.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "packages", "client", "assets");
const CLIENT_DIST_ASSETS = path.join(ROOT, "packages", "client", "dist", "assets");
const BUDGET_BYTES = 6291456;

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

function sizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sizeBytes(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
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

test("LICENSES.md manifest exists with pack, author, license, and files", () => {
  const manifest = fs.readFileSync(path.join(ROOT, "LICENSES.md"), "utf8");
  assert.match(manifest, /CC0/);
  assert.match(manifest, /Author/);
  assert.match(manifest, /Files/);
  assert.match(manifest, /CC0-1\.0/);
});

test("packages/client/assets holds only CC0 SVG sources", () => {
  const names = fs.readdirSync(ASSETS);
  assert.ok(names.length >= 1, "expected at least one CC0 source sprite");
  for (const name of names) {
    // The OFL display webfont lives under fonts/ (issue #151), not as a
    // top-level sprite: its own manifest entry covers it below.
    if (name === "fonts") {
      continue;
    }
    assert.match(name, /\.svg$/, `${name} must be an SVG source`);
    const body = fs.readFileSync(path.join(ASSETS, name), "utf8");
    assert.match(body, /<svg[\s>]/, `${name} must be a valid SVG root`);
  }
  const svgs = names.filter((name) => name.endsWith(".svg"));
  assert.ok(svgs.length >= 1, "expected at least one CC0 source sprite");
});

test("every asset file is listed under the manifest Files section", () => {
  const manifest = fs.readFileSync(path.join(ROOT, "LICENSES.md"), "utf8");
  const names = fs.readdirSync(ASSETS);
  for (const name of names) {
    assert.ok(
      manifest.includes(name),
      `${name} must be listed in LICENSES.md`,
    );
  }
});

test("built atlas.json parses with all frames present on disk", () => {
  const raw = fs.readFileSync(path.join(CLIENT_DIST_ASSETS, "atlas.json"), "utf8");
  const index = JSON.parse(raw);
  assert.equal(index.meta.app, "scrapline");
  assert.ok(index.frames !== null && typeof index.frames === "object");
  const keys = Object.keys(index.frames);
  assert.ok(keys.length >= 1, "expected at least one atlas frame");
  for (const key of keys) {
    const frame = index.frames[key];
    assert.equal(typeof frame.file, "string", `${key} needs a file`);
    assert.ok(
      fs.existsSync(path.join(CLIENT_DIST_ASSETS, frame.file)),
      `${frame.file} must exist next to atlas.json`,
    );
  }
});

test("summed dist assets stay within the 6 MB budget", () => {
  const bytes = sizeBytes(CLIENT_DIST_ASSETS);
  assert.ok(
    bytes <= BUDGET_BYTES,
    `dist assets are ${bytes} bytes, expected <= ${BUDGET_BYTES}`,
  );
});

test("GET /assets/atlas.json serves the built index as JSON", async () => {
  const res = await get("/assets/atlas.json");
  assert.equal(res.status, 200);
  assert.match(res.contentType, /application\/json/);
  const index = JSON.parse(res.text);
  assert.equal(index.meta.app, "scrapline");
  assert.ok(index.frames !== null && typeof index.frames === "object");
});
