// Layer discipline contract tests (issue #313): black-box HTTP probes for
// /layers.css plus static scans proving the numeric stacking bands and the
// no-tiling guard. Mirrors tests/tokens.test.js (freePort + spawned
// server.js + get() helpers).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

let child = null;
let base = "";
let port = 0;

const ROOT = path.join(__dirname, "..");
const LAYERS_CSS = path.join(ROOT, "packages", "client", "public", "layers.css");
const SRC_HTML = path.join(ROOT, "packages", "client", "index.html");
const COMBINED = path.join(ROOT, "packages", "server", "src", "server.ts");

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

/** First z-index value in the rule block following a selector. */
function zIndexFor(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start !== -1, `expected selector ${selector} in layers.css`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, `expected rule block for ${selector}`);
  const body = source.slice(open + 1, close);
  const match = /z-index\s*:\s*(-?\d+)/.exec(body);
  assert.ok(match !== null, `${selector} must declare a z-index band`);
  return Number.parseInt(match[1], 10);
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

test("GET /layers.css returns 200 CSS carrying the stacking bands", async () => {
  const layers = await get("/layers.css");
  assert.equal(layers.status, 200);
  assert.match(layers.contentType, /text\/css/);
  assert.match(layers.text, /z-index/);
  assert.match(layers.text, /#menu/);
  assert.match(layers.text, /#end-screen/);
});

test("HEAD /layers.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/layers.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("GET / links the layers stylesheet beside the tokens sheet", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /layers\.css/);
  assert.match(root.text, /tokens\.css/);
});

test("GET / mounts the menu root class for the top band", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /menu-root/);
});

test("static bands order menu > overlay > HUD > canvas numerically", () => {
  const source = fs.readFileSync(LAYERS_CSS, "utf8");
  const menu = zIndexFor(source, "#menu");
  const overlay = zIndexFor(source, "#end-screen");
  const hud = zIndexFor(source, "#hud");
  const canvas = zIndexFor(source, "#game");
  assert.ok(
    menu > overlay && overlay > hud && hud > canvas,
    `expected 30 > 20 > 10 > 0, got menu=${menu} overlay=${overlay} hud=${hud} canvas=${canvas}`,
  );
});

test("static layers.css never tiles: no repeat fill, no fixed giant box", () => {
  const source = fs.readFileSync(LAYERS_CSS, "utf8");
  assert.doesNotMatch(
    source,
    /background-repeat\s*:\s*repeat\b/,
    "layers.css must never set background-repeat: repeat",
  );
  assert.doesNotMatch(
    source,
    /background-image/,
    "layers.css must never set a background image",
  );
  assert.doesNotMatch(
    source,
    /\b\d{4,}px\b/,
    "layers.css must not use four-digit pixel sizes",
  );
});

test("static layers.css consumes token variables, not raw hex", () => {
  const source = fs.readFileSync(LAYERS_CSS, "utf8");
  assert.doesNotMatch(
    source,
    /#[0-9a-fA-F]{6}/,
    "layers.css must consume token variables, not raw hex",
  );
  for (const match of source.matchAll(/background\s*:\s*([^;]+);/g)) {
    assert.match(
      match[1],
      /var\(--/,
      `background "${match[1].trim()}" must come from a token variable`,
    );
  }
});

test("source index.html keeps the #end-standings id for HUD handles", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(source, /id="end-standings"/);
});

test("combined server source serves the /layers.css route", () => {
  const source = fs.readFileSync(COMBINED, "utf8");
  assert.match(source, /\/layers\.css/);
});
