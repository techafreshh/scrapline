// UI verification lap contract tests (issue #321): black-box HTTP
// probes plus static scans proving `npm run verify:ui` pins the whole
// PRD at both resolutions (8 views x 2 viewports, 16 PNGs >10KB) with
// title, tiling, hover, fps, budget, and probes guardrails plus the
// after-menu-return JSON and verify.log proofs. Mirrors
// tests/menu-layout.test.js (freePort + spawned server.js + get()
// helpers); the browser lap itself stays out of `npm test` (no browser
// in CI), so this file asserts the script contract statically.
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
const SCRIPT = path.join(ROOT, "scripts", "verify-ui.js");
const PACKAGE_JSON = path.join(ROOT, "package.json");
const GITIGNORE = path.join(ROOT, ".gitignore");
const BUTTON_CSS = path.join(ROOT, "packages", "client", "public", "components", "button.css");
const CLIENT_DIST = path.join(ROOT, "packages", "client", "dist");
const CSS_ROUTES = [
  "/tokens.css",
  "/layers.css",
  "/menu.css",
  "/hud.css",
  "/components/button.css",
  "/components/panel.css",
  "/components/chrome.css",
  "/components/icons.css",
  "/overlays/setup.css",
  "/overlays/settings.css",
  "/overlays/howto.css",
  "/overlays/challenges.css",
  "/overlays/locker.css",
  "/overlays/endscreen.css",
  "/overlays/connecting.css",
];
// 6 MB shipped budget (the tools/check-budget.js BUDGET_BYTES twin).
const BUDGET_BYTES = 6291456;

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

/** Recursive byte sum of every file under dir (check-budget.js idiom). */
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

test("package.json wires npm run verify:ui at scripts/verify-ui.js", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  assert.equal(pkg.scripts["verify:ui"], "node scripts/verify-ui.js");
  assert.ok(fs.existsSync(SCRIPT), "expected scripts/verify-ui.js to exist");
});

test("npm test includes the verify-ui contract test", () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  assert.match(pkg.scripts.test, /tests\/verify-ui\.test\.js/);
});

test("captures/ output is gitignored like artifacts/", () => {
  const ignored = fs.readFileSync(GITIGNORE, "utf8");
  assert.match(ignored, /^captures\/$/m);
});

test("static script pins both resolutions and all 8 views", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /1920x1080/);
  assert.match(source, /1280x720/);
  for (const view of ["menu", "setup", "how-to", "challenges", "locker", "midmatch-hud", "end-screen", "after-menu-return"]) {
    assert.ok(source.includes(`"${view}"`), `expected view "${view}" in verify-ui.js`);
  }
  assert.match(source, /VIEWS/);
  assert.match(source, /VIEWPORTS/);
  // Art gate (issue #352): one mockup per view in the header table
  // (after-menu-return reuses the menu mockup).
  for (const mockup of ["ME-01-menu-v1.jpg", "SC-02-v1.jpg", "SC-04-v1.jpg", "SC-05-v1.jpg", "SC-06-v1.jpg", "HU-01-hud-v1.jpg", "SC-07-end-screen-v1.jpg"]) {
    assert.ok(source.includes(mockup), `expected mockup ${mockup} in verify-ui.js`);
  }
});

test("static script enforces the 16-file census with a 10KB floor", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /MIN_PNG_BYTES = 10 \* 1024/);
  assert.match(source, /census\.length === 16/);
  assert.match(source, /after-menu-return\.json/);
  assert.match(source, /verify\.log/);
});

test("static script asserts the title, bleed, fps, and budget guardrails", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /top >= 0/);
  assert.match(source, /\.menu-logo/);
  assert.match(source, /bannedWordCount/);
  assert.match(source, /bodyText/);
  assert.match(source, /titleBox/);
  assert.match(source, /MIN_FPS = 30/);
  assert.match(source, /BUDGET_BYTES = 6291456/);
  assert.match(source, /puppeteer-core/);
});

test("static script emits every required verify.log token", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  for (const token of ["hover:ok", "tiling:ok", "fps:ok", "budget:ok", "probes:green", "art:ok"]) {
    assert.ok(source.includes(token), `expected log token ${token} in verify-ui.js`);
  }
});

test("static script pins a fixed match seed for every navigation (issue #412)", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /VERIFY_SEED\s*=\s*\d+/);
  assert.ok(source.includes("?seed="), "expected a ?seed= navigation in verify-ui.js");
  assert.match(source, /seededUrl\(base\)/);
  // Both viewport navigations must ride the seed — a bare `/` load
  // rolls Math.random() per run and churns every sibling PNG.
  assert.doesNotMatch(source, /page\.goto\(`\$\{base\}\/`/);
});

test("static script stabilizes animated DOM before every capture (issue #412)", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /stabilizeForCapture/);
  assert.match(source, /verify-freeze/);
  assert.match(source, /menu-soldier/);
  assert.match(source, /menu-flame/);
  assert.match(source, /challenges-countdown/);
  assert.match(source, /menu-tip/);
  assert.match(source, /VERIFY_TIP_TEXT/);
  assert.match(source, /document\.fonts/);
  assert.match(source, /requestAnimationFrame/);
  // Tick-anchored waits replay the same match state for the fixed seed;
  // wall sleeps alone land on different ticks under fps jitter.
  assert.match(source, /waitForSimTicks/);
  assert.match(source, /__scraplineTick >=/);
});

test("static script never records volatile run state in log or snapshot (issue #412)", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(source.includes("server healthy at local"), "healthy line must not carry the ephemeral port");
  assert.doesNotMatch(source, /server healthy at \$\{base\}/);
  assert.ok(source.includes('"local"'), "snapshot URL must read local, not the ephemeral base");
  assert.ok(!source.includes("readAfterReturnSnapshot(page, `${base}/`"), "snapshot must not record the ephemeral base");
  // The exact fps mean jitters run to run; the log keeps only the verdict.
  assert.doesNotMatch(source, /fps:ok \(mean=/);
});

test("static art gate bans legacy tiles and decodes without new deps", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /ui\/tile_/);
  assert.match(source, /verify\/art-gate/);
  assert.match(source, /slice-sheet/);
  assert.match(source, /decodePng/);
  assert.doesNotMatch(source, /pngjs|sharp|jimp/);
  const helper = fs.readFileSync(path.join(ROOT, "scripts", "verify", "art-gate.js"), "utf8");
  assert.match(helper, /slice-sheet/);
  assert.match(helper, /decodePng/);
  assert.doesNotMatch(helper, /pngjs|sharp|jimp/);
});

test("GET / serves the menu plus every overlay mount the lap captures", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /Scrapline/);
  assert.match(root.text, /menu-logo/);
  assert.ok(root.text.includes('<canvas id="game">'));
  for (const id of ["setup", "howto", "challenges", "locker", "end-screen"]) {
    assert.ok(root.text.includes(`id="${id}"`), `expected id="${id}" in /`);
  }
});

test("served stylesheets carry hover states and never tile", async () => {
  let hoverRoutes = 0;
  for (const route of CSS_ROUTES) {
    const res = await get(route);
    assert.equal(res.status, 200, `expected 200 for ${route}`);
    assert.match(res.contentType, /text\/css/);
    assert.doesNotMatch(
      res.text,
      /background-repeat\s*:\s*repeat\b/,
      `${route} must never set background-repeat: repeat`,
    );
    if (/:hover/.test(res.text)) {
      hoverRoutes += 1;
    }
  }
  assert.ok(hoverRoutes >= 3, `expected >=3 sheets with :hover, found ${hoverRoutes}`);
});

test("static button primitive carries the :hover state", () => {
  const source = fs.readFileSync(BUTTON_CSS, "utf8");
  assert.match(source, /\.sl-btn:hover/);
});

test("dist bundle stays within the 6 MB budget the lap asserts", () => {
  const bytes = sizeBytes(CLIENT_DIST);
  assert.ok(bytes > 0, "expected a built packages/client/dist (npm test builds first)");
  assert.ok(bytes <= BUDGET_BYTES, `dist is ${bytes} bytes, expected <= ${BUDGET_BYTES}`);
});
