// Settings/HowTo/Challenges/Locker on Panel primitive (issue #319):
// black-box HTTP probes for /overlays/*.css plus static scans proving
// the Panel header/close contract, token row spacing, no tiling, and
// setup `?map=arena2` preservation. Mirrors tests/menu-layout.test.js
// (freePort + spawned server.js + get() helpers).
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
const OVERLAYS = path.join(ROOT, "packages", "client", "public", "overlays");
const SHEETS = ["setup.css", "settings.css", "howto.css", "challenges.css", "locker.css"];
const LAYERS_CSS = path.join(ROOT, "packages", "client", "public", "layers.css");
const LAYERS_TS = path.join(ROOT, "packages", "client", "src", "ui", "layers.ts");
const ROUTER_TS = path.join(ROOT, "packages", "client", "src", "overlays", "router.ts");
const SETUP_TS = path.join(ROOT, "packages", "client", "src", "setup.ts");
const MAIN_TS = path.join(ROOT, "packages", "client", "src", "main.ts");
const SERVER_JS = path.join(ROOT, "server.js");
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

test("GET /overlays/*.css returns 200 CSS for all five panels", async () => {
  for (const sheet of SHEETS) {
    const res = await get(`/overlays/${sheet}`);
    assert.equal(res.status, 200, `expected 200 for /overlays/${sheet}`);
    assert.match(res.contentType, /text\/css/, `expected CSS for ${sheet}`);
    assert.ok(res.text.length > 0, `expected a body for ${sheet}`);
  }
});

test("HEAD /overlays/setup.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/overlays/setup.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("static five panel stylesheets never tile and consume tokens", () => {
  for (const sheet of SHEETS) {
    const source = fs.readFileSync(path.join(OVERLAYS, sheet), "utf8");
    assert.doesNotMatch(
      source,
      /background-repeat\s*:\s*repeat\b/,
      `${sheet} must never set background-repeat: repeat`,
    );
    assert.doesNotMatch(source, /background-image/, `${sheet} must never tile an image`);
    assert.doesNotMatch(source, /z-index/, `${sheet} stacking stays owned by layers.css`);
    assert.doesNotMatch(
      source,
      /#[0-9a-fA-F]{6}/,
      `${sheet} must consume token variables, not raw hex`,
    );
    assert.match(
      source,
      /var\(--spacing-/,
      `${sheet} must space rows from the token scale`,
    );
    assert.match(source, /\.panel-head/, `${sheet} must carry the shared header`);
    assert.match(source, /\.panel-close/, `${sheet} must carry the close hook`);
    assert.match(source, /\.sl-panel/, `${sheet} must scope the Panel primitive`);
  }
});

test("GET / links all five overlay stylesheets", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  for (const sheet of SHEETS) {
    assert.match(root.text, new RegExp(`/overlays/${sheet.replace(".", "\\.")}`));
  }
});

test("GET / mounts five Panel overlays with h2 plus panel-close", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  for (const id of ["setup", "settings", "howto", "challenges", "locker"]) {
    assert.match(root.text, new RegExp(`id="${id}"`), `expected overlay #${id}`);
  }
  const closes = root.text.match(/panel-close/g) || [];
  assert.ok(closes.length >= 5, `expected >= 5 panel-close hits, got ${closes.length}`);
  for (const id of ["setup", "settings", "howto", "challenges", "locker"]) {
    const block = new RegExp(`id="${id}"[\\s\\S]{0,2000}?class="sl-panel"`);
    assert.match(root.text, block, `#${id} must contain .sl-panel`);
    const head = new RegExp(`id="${id}"[\\s\\S]{0,3000}?<h2>`);
    assert.match(root.text, head, `#${id} must contain an h2 header`);
    const close = new RegExp(`id="${id}"[\\s\\S]{0,4000}?panel-close`);
    assert.match(root.text, close, `#${id} must contain a .panel-close button`);
  }
});

test("static layers own the challenges/locker overlay band", () => {
  const css = fs.readFileSync(LAYERS_CSS, "utf8");
  assert.match(css, /#challenges/);
  assert.match(css, /#locker/);
  const ts = fs.readFileSync(LAYERS_TS, "utf8");
  assert.match(ts, /"challenges"/);
  assert.match(ts, /"locker"/);
});

test("static setup preserves verbatim ?map=arena2 in DOM and URL", () => {
  const setup = fs.readFileSync(SETUP_TS, "utf8");
  assert.match(setup, /rawMapFromUrl/);
  assert.match(setup, /ensureExtraMapButton/);
  assert.match(setup, /arena2|isKnownMap/);
  const main = fs.readFileSync(MAIN_TS, "utf8");
  assert.match(main, /rawMapFromUrl/);
  assert.match(main, /encodeURIComponent/);
  assert.match(main, /map=arena2|outQuery/);
  assert.match(main, /routeFromHash/);
  assert.match(main, /applyHashRoute/);
  assert.match(main, /bindOverlayRouter/);
  assert.match(fs.readFileSync(ROUTER_TS, "utf8"), /routeFromHash/);
});

test("both server sources serve the /overlays/* route", () => {
  assert.match(fs.readFileSync(SERVER_JS, "utf8"), /\/overlays\//);
  assert.match(fs.readFileSync(COMBINED, "utf8"), /\/overlays\//);
});
