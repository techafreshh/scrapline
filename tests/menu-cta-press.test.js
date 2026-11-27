// Pressed-state nuance at short heights (issue #396): black-box HTTP
// probe for /menu.css plus static scans proving the short-viewport
// sticky CTA keeps its opaque backdrop while :active swaps the glow
// for the inset press shadow below ~700px viewport height. Mirrors
// tests/menu-cta-backdrop.test.js (freePort + spawned server.js +
// get() + ruleBody/declarationValue/shortBlock helpers).
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
  assert.ok(start !== -1, `expected selector ${selector}`);
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

/** Source slice starting at the short-viewport media query. */
function shortBlock(source) {
  const at = source.indexOf("@media (max-height: 700px)");
  assert.ok(at !== -1, "expected @media (max-height: 700px) in source");
  return source.slice(at);
}

/** Rule body of the non-active #quick-play rule inside the short block. */
function shortCtaBody(source) {
  const block = shortBlock(source);
  const at = block.indexOf("#quick-play");
  assert.ok(at !== -1, "expected #quick-play in the short block");
  const open = block.indexOf("{", at);
  const close = block.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, "expected rule block for #quick-play");
  return block.slice(open + 1, close);
}

/** Rule body of the #quick-play:active rule inside the short block. */
function shortPressBody(source) {
  const block = shortBlock(source);
  const at = block.indexOf("#quick-play:active");
  assert.ok(at !== -1, "expected #quick-play:active in the short block");
  const open = block.indexOf("{", at);
  const close = block.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, "expected rule block for #quick-play:active");
  return block.slice(open + 1, close);
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

test("GET /menu.css short block carries a #quick-play:active press override", async () => {
  const menu = await get("/menu.css");
  assert.equal(menu.status, 200);
  assert.match(menu.contentType, /text\/css/);
  const block = shortBlock(menu.text);
  assert.match(block, /#quick-play:active/);
  const body = shortPressBody(menu.text);
  const shadow = declarationValue(body, "box-shadow") || "";
  assert.match(shadow, /var\(--color-bg\)/);
  assert.match(shadow, /inset/);
});

test("static short press rule keeps the opaque halo and swaps the glow for the inset", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = shortPressBody(source);
  const shadow = declarationValue(body, "box-shadow") || "";
  assert.match(shadow, /var\(--color-bg\)/, "press shadow must keep the opaque halo");
  assert.match(shadow, /inset 0 2px 8px rgba\(0, 0, 0, 0\.45\)/);
  assert.doesNotMatch(shadow, /0 0 24px/, "press shadow must drop the glow layer");
});

test("static non-active short #quick-play keeps sticky plus halo and glow", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = shortCtaBody(source);
  assert.equal(declarationValue(body, "position"), "sticky");
  assert.equal(declarationValue(body, "top"), "0");
  assert.match(declarationValue(body, "background") || "", /var\(--accent\)/);
  const shadow = declarationValue(body, "box-shadow") || "";
  assert.match(shadow, /var\(--color-bg\)/);
  assert.match(shadow, /0 0 24px/);
});

test("static base .menu-cta:active still sets the same inset press shadow", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const beforeShort = source.slice(0, source.indexOf("@media (max-height: 700px)"));
  const body = ruleBody(beforeShort, ".menu-cta:active");
  const shadow = declarationValue(body, "box-shadow") || "";
  assert.match(shadow, /inset 0 2px 8px rgba\(0, 0, 0, 0\.45\)/);
});

test("static short press rule upholds the token/image/stacking bans", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = shortPressBody(source);
  assert.doesNotMatch(body, /z-index/, "stacking stays owned by layers.css");
  assert.doesNotMatch(body, /background-image/, "press rule must never tile an image");
  assert.doesNotMatch(body, /#[0-9a-fA-F]{6}/, "press rule stays token-only");
  assert.equal(declarationValue(body, "position"), null);
  assert.equal(declarationValue(body, "background"), null);
  const menuShort = shortBlock(source);
  assert.doesNotMatch(menuShort, /#[0-9a-fA-F]{6}/, "menu short block stays token-only");
  assert.doesNotMatch(menuShort, /background-image/, "menu short block must never tile an image");
  assert.doesNotMatch(menuShort, /z-index/, "stacking stays owned by layers.css");
});
