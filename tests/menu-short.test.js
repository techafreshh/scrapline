// Short-viewport menu contract tests (issue #387): black-box HTTP
// probes for /menu.css plus static scans proving the menu stays
// reachable below ~700px viewport height (scrollable column capped
// clear of the tip strip, sticky CTA, reserved scrollbar groove) while
// the 720p layout pins stay exactly as issues #381/#359 set them.
// Mirrors tests/menu-layout.test.js (freePort + spawned server.js +
// get() + ruleBody/declarationValue helpers).
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
  assert.ok(at !== -1, "expected @media (max-height: 700px) in menu.css");
  return source.slice(at);
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

test("GET /menu.css carries the short-viewport query with sticky CTA and gutter", async () => {
  const menu = await get("/menu.css");
  assert.equal(menu.status, 200);
  assert.match(menu.contentType, /text\/css/);
  assert.match(menu.text, /@media \(max-height: 700px\)/);
  const block = shortBlock(menu.text);
  assert.match(block, /position:\s*sticky/);
  assert.match(block, /scrollbar-gutter:\s*stable/);
});

test("static short block caps the column clear of the tip strip with internal scroll", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const block = shortBlock(source);
  assert.match(block, /max-height:\s*calc\(100vh - 96px\)/);
  assert.match(block, /max-height:\s*calc\(100dvh - 96px\)/);
  assert.match(block, /overflow-y:\s*auto/);
  assert.match(block, /scrollbar-gutter:\s*stable/);
  assert.match(block, /overscroll-behavior:\s*contain/);
});

test("static short block pins the CTA sticky to the visible top", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const block = shortBlock(source);
  const at = block.indexOf("#quick-play");
  assert.ok(at !== -1, "expected #quick-play in the short block");
  const open = block.indexOf("{", at);
  const close = block.indexOf("}", open);
  const body = block.slice(open + 1, close);
  assert.equal(declarationValue(body, "position"), "sticky");
  assert.equal(declarationValue(body, "top"), "0");
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

test("static short block upholds the token/image/stacking bans", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const block = shortBlock(source);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{6}/, "short block stays token-only");
  assert.doesNotMatch(block, /background-image/, "short block must never tile an image");
  assert.doesNotMatch(block, /z-index/, "stacking stays owned by layers.css");
});
