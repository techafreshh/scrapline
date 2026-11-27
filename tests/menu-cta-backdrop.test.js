// Sticky CTA backdrop contract tests (issue #391): black-box HTTP
// probes for /menu.css and /layers.css plus static scans proving the
// sticky CTA keeps an opaque backdrop above the legacy z-index 1
// siblings below ~700px viewport height (accent face + opaque halo,
// z-index 2 from the stacking authority), the column carries a visible
// bottom fade affordance beside the thin scrollbar, and the 720p pins
// stay exactly as issues #381/#359/#387 set them. Mirrors
// tests/menu-short.test.js (freePort + spawned server.js + get() +
// ruleBody/declarationValue/shortBlock helpers).
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
const LAYERS_CSS = path.join(ROOT, "packages", "client", "public", "layers.css");
const CHROME_CSS = path.join(ROOT, "packages", "client", "public", "components", "chrome.css");

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

/** Leading px number of a declaration value (null when not a px size). */
function pxNumber(value) {
  if (value === null) {
    return null;
  }
  const match = /^([\d.]+)px/.exec(value);
  return match === null ? null : Number.parseFloat(match[1]);
}

/** Source slice starting at the short-viewport media query. */
function shortBlock(source) {
  const at = source.indexOf("@media (max-height: 700px)");
  assert.ok(at !== -1, "expected @media (max-height: 700px) in source");
  return source.slice(at);
}

/** Rule body of the #quick-play rule inside the short block. */
function shortCtaBody(source) {
  const block = shortBlock(source);
  const at = block.indexOf("#quick-play");
  assert.ok(at !== -1, "expected #quick-play in the short block");
  const open = block.indexOf("{", at);
  const close = block.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, "expected rule block for #quick-play");
  return block.slice(open + 1, close);
}

/** Rule body of the .menu-column rule inside the short block. */
function shortColumnBody(source) {
  const block = shortBlock(source);
  const at = block.indexOf(".menu-column");
  assert.ok(at !== -1, "expected .menu-column in the short block");
  const open = block.indexOf("{", at);
  const close = block.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, "expected rule block for .menu-column");
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

test("GET /menu.css short block carries the opaque CTA backdrop with sticky intact", async () => {
  const menu = await get("/menu.css");
  assert.equal(menu.status, 200);
  assert.match(menu.contentType, /text\/css/);
  const body = shortCtaBody(menu.text);
  assert.equal(declarationValue(body, "position"), "sticky");
  assert.equal(declarationValue(body, "top"), "0");
  assert.match(declarationValue(body, "background") || "", /var\(--accent\)/);
  const shadow = declarationValue(body, "box-shadow") || "";
  assert.match(shadow, /var\(--color-bg\)/);
  assert.match(shadow, /0 0 24px/);
});

test("GET /layers.css raises the sticky CTA above the legacy siblings", async () => {
  const layers = await get("/layers.css");
  assert.equal(layers.status, 200);
  assert.match(layers.contentType, /text\/css/);
  assert.match(layers.text, /@media \(max-height: 700px\)/);
  const block = shortBlock(layers.text);
  const at = block.indexOf("#quick-play");
  assert.ok(at !== -1, "expected #quick-play in the layers.css short query");
  const open = block.indexOf("{", at);
  const close = block.indexOf("}", open);
  const body = block.slice(open + 1, close);
  assert.equal(declarationValue(body, "z-index"), "2");
});

test("static short block fades the column bottom while keeping internal scroll", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = shortColumnBody(source);
  assert.equal(declarationValue(body, "overflow-y"), "auto");
  assert.equal(declarationValue(body, "scrollbar-gutter"), "stable");
  assert.match(declarationValue(body, "mask-image") || "", /linear-gradient\(to bottom/);
  assert.match(declarationValue(body, "-webkit-mask-image") || "", /linear-gradient\(to bottom/);
  assert.match(declarationValue(body, "mask-image") || "", /transparent/);
});

test("static chrome faces still pair the thin scrollbar with the fade", () => {
  const source = fs.readFileSync(CHROME_CSS, "utf8");
  assert.match(source, /\.menu-column/);
  assert.match(source, /scrollbar-width\s*:\s*thin/);
});

test("static 720p pins are unchanged outside the short block", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const cta = ruleBody(source, ".menu-cta");
  assert.equal(pxNumber(declarationValue(cta, "font-size")), 26);
  assert.ok(Number.parseFloat(declarationValue(cta, "min-height")) >= 56);
  const secondary = ruleBody(source, ".menu-secondary");
  const raw = declarationValue(secondary, "font-size") || "";
  const resolved = raw.includes("var(--font-body)") ? 16 : pxNumber(raw);
  assert.ok(resolved !== null && resolved >= 16);
  assert.equal(pxNumber(declarationValue(secondary, "min-height")), 44);
  assert.equal(pxNumber(declarationValue(ruleBody(source, ".menu-logo"), "min-height")), 60);
  const cap = pxNumber(declarationValue(ruleBody(source, ".menu-column"), "max-width"));
  assert.ok(cap >= 282 && cap <= 333, `panel must land 282-333px, got: ${cap}px`);
});

test("static short blocks uphold the token/image/stacking bans", () => {
  const menu = fs.readFileSync(MENU_CSS, "utf8");
  const menuShort = shortBlock(menu);
  assert.doesNotMatch(menuShort, /#[0-9a-fA-F]{6}/, "menu short block stays token-only");
  assert.doesNotMatch(menuShort, /background-image/, "menu short block must never tile an image");
  assert.doesNotMatch(menuShort, /z-index/, "stacking stays owned by layers.css");
  const layers = fs.readFileSync(LAYERS_CSS, "utf8");
  assert.doesNotMatch(layers, /#[0-9a-fA-F]{6}/, "layers.css stays token-only");
  assert.doesNotMatch(layers, /background-image/, "layers.css must never set a background image");
});
