// Quick Play CTA dominance contract tests (issue #315): black-box HTTP
// probes for /menu.css plus static scans proving the CTA carries the
// accent fill with a hover glow, the six secondaries recede to ghost
// style, and the token guard rails hold. Mirrors tests/menu-layout.test.js
// (freePort + spawned server.js + get() + ruleBody/declarationValue).
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
const MENU_CSS = path.join(ROOT, "packages", "client", "public", "menu.css");
const TOKENS_CSS = path.join(ROOT, "packages", "client", "public", "tokens.css");
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

/** Body of the first rule matching a literal selector in a CSS source. */
function ruleBody(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start !== -1, `expected selector ${selector} in menu.css`);
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

test("GET /menu.css returns 200 CSS carrying the CTA hooks", async () => {
  const menu = await get("/menu.css");
  assert.equal(menu.status, 200);
  assert.match(menu.contentType, /text\/css/);
  assert.match(menu.text, /\.menu-cta/);
  assert.match(menu.text, /\.menu-secondary/);
});

test("HEAD /menu.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/menu.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("static menu.css gives the CTA an accent fill", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".menu-cta");
  assert.match(
    declarationValue(body, "background") || "",
    /var\(--accent/,
    "CTA background must reference the accent token",
  );
});

test("static menu.css gives the CTA hover a glow shadow", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".menu-cta:hover");
  assert.match(
    declarationValue(body, "box-shadow") || "",
    /0 0/,
    "CTA hover must set a glow box-shadow containing 0 0",
  );
});

test("static menu.css keeps the CTA at least 56px tall", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".menu-cta");
  const minHeight = declarationValue(body, "min-height");
  assert.ok(minHeight !== null, "CTA rule must set min-height");
  assert.ok(
    Number.parseFloat(minHeight) >= 56,
    `CTA min-height must be >= 56, got: ${minHeight}`,
  );
});

test("source index.html tags exactly the six secondaries beside Quick Play", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  const matches = source.match(/menu-secondary/g) || [];
  assert.equal(matches.length, 6, `expected 6 menu-secondary hits, got ${matches.length}`);
  for (const id of [
    "play",
    "play-online",
    "challenges-open",
    "locker-open",
    "settings-open",
    "howto-open",
  ]) {
    const tag = new RegExp(`id="${id}"[^>]*menu-secondary`).exec(source);
    assert.ok(tag !== null, `id="${id}" must carry menu-secondary`);
  }
  const quick = /id="quick-play"[^>]*>/.exec(source)[0];
  assert.match(quick, /menu-cta/);
  assert.doesNotMatch(quick, /menu-secondary/);
});

test("tokens.css defines the accent alias for the CTA fill", () => {
  const source = fs.readFileSync(TOKENS_CSS, "utf8");
  assert.match(source, /--accent\s*:\s*#[0-9a-fA-F]{6}/);
});

test("static menu.css still carries no raw hex and no stacking takeovers", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  assert.doesNotMatch(
    source,
    /#[0-9a-fA-F]{6}/,
    "menu.css must consume token variables, not raw hex",
  );
  assert.doesNotMatch(source, /z-index/, "stacking stays owned by layers.css");
});

test("combined server source serves the /menu.css route", () => {
  const source = fs.readFileSync(COMBINED, "utf8");
  assert.match(source, /\/menu\.css/);
});
