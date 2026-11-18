// Cohesive HUD module contract tests (issue #317): black-box HTTP
// probes for /hud.css plus static scans proving the shared module skin,
// the four corner clusters, the label-size weapon name, and the accent
// grenade pips. Mirrors tests/menu-layout.test.js (freePort + spawned
// server.js + get()/ruleBody helpers).
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
const HUD_CSS = path.join(ROOT, "packages", "client", "public", "hud.css");
const TOKENS_CSS = path.join(ROOT, "packages", "client", "public", "tokens.css");
const SRC_HTML = path.join(ROOT, "packages", "client", "index.html");
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

/** Body of the first rule matching a literal selector in a CSS source. */
function ruleBody(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start !== -1, `expected selector ${selector} in hud.css`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, `expected rule block for ${selector}`);
  return source.slice(open + 1, close);
}

/** First declaration value for a property inside a rule body. */
function declarationValue(body, property) {
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);?`).exec(body);
  return match === null ? null : match[1].trim();
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

test("GET /hud.css returns 200 CSS carrying the module skin", async () => {
  const hud = await get("/hud.css");
  assert.equal(hud.status, 200);
  assert.match(hud.contentType, /text\/css/);
  assert.match(hud.text, /\.hud-module/);
  assert.match(hud.text, /\.ammo-weapon/);
  assert.match(hud.text, /\.grenade-pip/);
});

test("HEAD /hud.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/hud.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("GET / links the HUD module stylesheet", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /hud\.css/);
});

test("GET / mounts at least four hud-module clusters on the right ids", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  const hits = root.text.match(/hud-module/g) || [];
  assert.ok(hits.length >= 4, `expected >= 4 hud-module mounts, got ${hits.length}`);
  assert.match(root.text, /id="hud-status"[^>]*class="hud-module"|class="hud-module"[^>]*id="hud-status"/);
  assert.match(root.text, /id="hud-center"[^>]*class="hud-module"|class="hud-module"[^>]*id="hud-center"/);
  assert.match(root.text, /id="killfeed"[^>]*class="hud-module"|class="hud-module"[^>]*id="killfeed"/);
  assert.match(root.text, /id="ammo-module"[^>]*class="hud-module"|class="hud-module"[^>]*id="ammo-module"/);
  assert.match(root.text, /id="ammo-name"[^>]*class="ammo-weapon"|class="ammo-weapon"[^>]*id="ammo-name"/);
});

test("static hud-module skin uses a 2px token border and token panel fill", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, ".hud-module");
  assert.match(declarationValue(body, "border") || "", /2px/);
  assert.match(declarationValue(body, "border") || "", /var\(--color-border\)/);
  assert.match(declarationValue(body, "background") || "", /var\(--color-panel\)/);
  const tokens = fs.readFileSync(TOKENS_CSS, "utf8");
  assert.match(tokens, /--color-border:\s*#2a3550/);
  const panel = /--color-panel:\s*([^;]+);/.exec(tokens);
  assert.ok(panel !== null, "tokens.css must define --color-panel");
  assert.match(panel[1], /0\.92/, "--color-panel alpha must stay below 1.0");
});

test("static hud-module accent bar rides the cyan token", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, ".hud-module::before");
  assert.match(declarationValue(body, "background") || "", /var\(--color-cyan\)/);
});

test("static killfeed module cancels the legacy bottom offset", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, "#killfeed.hud-module");
  assert.equal(declarationValue(body, "bottom"), "auto");
});

test("static ammo-weapon name resolves to label size or smaller", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, "#ammo-name.ammo-weapon");
  assert.match(declarationValue(body, "font-size") || "", /var\(--font-label\)/);
  const tokens = fs.readFileSync(TOKENS_CSS, "utf8");
  const label = /--font-label:\s*([^;]+);/.exec(tokens);
  assert.ok(label !== null, "tokens.css must define --font-label");
  assert.ok(
    Number.parseFloat(label[1]) <= 12,
    `--font-label must resolve to <= 12px, got ${label[1].trim()}`,
  );
});

test("static grenade pips reference the cyan or warm accent token", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, ".grenade-pip");
  assert.match(
    body,
    /var\(--color-cyan\)|var\(--color-warm\)/,
    "grenade pips must paint from an accent token",
  );
});

test("hud.css and index.html carry no brick-era references", () => {
  const css = fs.readFileSync(HUD_CSS, "utf8");
  assert.doesNotMatch(css, /brick/i, "hud.css must not reference brick");
  const html = fs.readFileSync(SRC_HTML, "utf8");
  assert.doesNotMatch(html, /brick/i, "index.html must not reference brick");
  assert.doesNotMatch(html, /hud-ammo[^"]*["']?\s*:\s*[^;]*url/i, "no .hud-ammo brick background");
});

test("static hud.css never takes over stacking or tiles images", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  assert.doesNotMatch(source, /z-index/, "stacking stays owned by layers.css");
  assert.doesNotMatch(source, /background-image/, "hud.css must never tile an image");
  assert.doesNotMatch(
    source,
    /#[0-9a-fA-F]{6}/,
    "hud.css must consume token variables, not raw hex",
  );
});

test("both server sources serve the /hud.css route", () => {
  assert.match(fs.readFileSync(SERVER_JS, "utf8"), /\/hud\.css/);
  assert.match(fs.readFileSync(COMBINED, "utf8"), /\/hud\.css/);
});
