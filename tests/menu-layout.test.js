// Menu layout hierarchy contract tests (issue #314): black-box HTTP
// probes for /menu.css plus static scans proving the left-anchored grid,
// the readable scrim, the probe hooks, and the CTA order. Mirrors
// tests/layers.test.js (freePort + spawned server.js + get() helpers).
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

/** Largest px gap declared in a rule body (gap or padding shorthand). */
function maxGapPx(body) {
  let max = 0;
  for (const match of body.matchAll(/var\(--spacing-(\d+)\)/g)) {
    max = Math.max(max, Number.parseInt(match[1], 10));
  }
  for (const match of body.matchAll(/(\d+(?:\.\d+)?)px/g)) {
    max = Math.max(max, Number.parseFloat(match[1]));
  }
  return max;
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

test("GET /menu.css returns 200 CSS carrying the menu layout", async () => {
  const menu = await get("/menu.css");
  assert.equal(menu.status, 200);
  assert.match(menu.contentType, /text\/css/);
  assert.match(menu.text, /\.menu-scrim/);
  assert.match(menu.text, /\.menu-grid/);
  assert.match(menu.text, /#menu-tip/);
});

test("HEAD /menu.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/menu.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("GET / links the menu stylesheet beside the layers sheet", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /menu\.css/);
  assert.match(root.text, /layers\.css/);
});

test("GET / mounts the menu probe hooks and lockup strings", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /menu-logo/);
  assert.match(root.text, /menu-cta/);
  assert.match(root.text, /menu-scrim/);
  assert.match(root.text, /menu-tagline/);
  assert.match(root.text, /Scrapline/);
  assert.match(root.text, /deterministic jetpack arena/);
});

test("static menu.css carries no raw six-digit hex", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  assert.doesNotMatch(
    source,
    /#[0-9a-fA-F]{6}/,
    "menu.css must consume token variables, not raw hex",
  );
});

test("static menu.css pins the scrim absolute with a token background", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".menu-scrim");
  assert.equal(declarationValue(body, "position"), "absolute");
  assert.match(
    declarationValue(body, "background") || "",
    /var\(--/,
    "scrim background must come from a token variable",
  );
});

test("static menu.css declares a grid with gaps of at least 8px", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".menu-grid");
  assert.match(declarationValue(body, "display") || "", /grid/);
  assert.ok(
    maxGapPx(body) >= 8,
    `menu grid gap must be >= 8px, got: ${body.trim()}`,
  );
  const column = ruleBody(source, ".menu-column");
  assert.ok(
    maxGapPx(column) >= 8,
    `menu column gap must be >= 8px, got: ${column.trim()}`,
  );
});

test("static menu.css pins the tips line to the bottom-left", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, "#menu-tip");
  assert.equal(declarationValue(body, "position"), "absolute");
  assert.ok(declarationValue(body, "bottom") !== null, "tips must set bottom");
  assert.ok(declarationValue(body, "left") !== null, "tips must set left");
});

test("static menu.css never takes over stacking or tiles images", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  assert.doesNotMatch(source, /z-index/, "stacking stays owned by layers.css");
  assert.doesNotMatch(source, /background-image/, "menu.css must never tile an image");
  assert.doesNotMatch(source, /\b\d{4,}px\b/, "menu.css must not use four-digit pixel sizes");
});

test("source index.html orders the CTA stack after Quick Play", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  const ids = [
    "quick-play",
    "play",
    "play-online",
    "challenges-open",
    "locker-open",
    "settings-open",
    "howto-open",
  ];
  let cursor = -1;
  for (const id of ids) {
    const at = source.indexOf(`id="${id}"`);
    assert.ok(at !== -1, `expected id="${id}" in index.html`);
    assert.ok(at > cursor, `id="${id}" must follow the previous CTA in index.html`);
    cursor = at;
  }
});

test("source index.html keeps the exact lockup strings as siblings", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(source, /<h1 class="menu-logo">Scrapline<\/h1>/);
  assert.match(
    source,
    /<h1 class="menu-logo">Scrapline<\/h1>\s*<p class="menu-tagline">deterministic jetpack arena<\/p>/,
  );
});

test("combined server source serves the /menu.css route", () => {
  const source = fs.readFileSync(COMBINED, "utf8");
  assert.match(source, /\/menu\.css/);
});
