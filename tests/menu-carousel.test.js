// Map carousel selected-state contract tests (issue #316): black-box
// HTTP probes for /menu.css plus static scans proving the cards carry a
// fixed size with an accent selected state, dimmed unselected cards, a
// `transform` transition, and a per-card best-score line. Mirrors
// tests/menu-cta.test.js (freePort + spawned server.js + get() +
// ruleBody/declarationValue helpers).
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

test("GET /menu.css returns 200 CSS carrying the carousel hooks", async () => {
  const menu = await get("/menu.css");
  assert.equal(menu.status, 200);
  assert.match(menu.contentType, /text\/css/);
  assert.match(menu.text, /\.map-card/);
  assert.match(menu.text, /\.map-card\.selected/);
  assert.match(menu.text, /\.map-best/);
  assert.match(menu.text, /#map-carousel/);
});

test("HEAD /menu.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/menu.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("static menu.css gives the selected card a cyan border", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".map-card.selected");
  assert.match(
    declarationValue(body, "border-color") || "",
    /var\(--color-cyan\)/,
    "selected rule must set border-color to the cyan token",
  );
});

test("static menu.css gives the selected card a scale transform", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".map-card.selected");
  assert.match(
    declarationValue(body, "transform") || "",
    /scale\(/,
    "selected rule must scale up via transform",
  );
});

test("static menu.css fixes every card to an equal box", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".map-card");
  const width = declarationValue(body, "width");
  const height = declarationValue(body, "height");
  assert.ok(width !== null && Number.parseFloat(width) > 0, "base rule must fix width");
  assert.ok(height !== null && Number.parseFloat(height) > 0, "base rule must fix height");
  assert.match(
    declarationValue(body, "transition") || "",
    /transform/,
    "base rule transition must animate transform",
  );
  assert.match(
    declarationValue(body, "border") || "",
    /2px solid/,
    "base rule must keep a constant 2px border so boxes stay equal",
  );
});

test("static menu.css dims unselected cards below full opacity", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const base = ruleBody(source, ".map-card");
  const baseOpacity = Number.parseFloat(declarationValue(base, "opacity") || "1");
  assert.ok(baseOpacity < 1, `base opacity must dim unselected cards, got ${baseOpacity}`);
  const selected = ruleBody(source, ".map-card.selected");
  assert.equal(declarationValue(selected, "opacity"), "1");
});

test("static menu.css types the best line on tokens with a reserved line", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".map-best");
  assert.match(
    declarationValue(body, "font-size") || "",
    /var\(--font-label\)/,
    "best line must use the label type token",
  );
  assert.ok(
    declarationValue(body, "min-height") !== null,
    "best line must reserve a min-height so empty cards stay equal",
  );
});

test("source index.html ships three cards with best lines in the stage track", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  const carousel = /<div id="map-carousel"[\s\S]*?<\/div>\s*<\/div>/.exec(source);
  assert.ok(carousel !== null, "expected a #map-carousel block");
  const cards = carousel[0].match(/data-map-card="(kilima|dune|frostbite)"/g) || [];
  assert.equal(cards.length, 3, `expected 3 data-map-card cards, got ${cards.length}`);
  const bests = carousel[0].match(/<span class="map-best"><\/span>/g) || [];
  assert.equal(bests.length, 3, `expected a map-best span per card, got ${bests.length}`);
  assert.match(
    carousel[0],
    /class="map-card selected"[^>]*data-map-card="kilima"/,
    "kilima ships as the selected default",
  );
  const stage = /<div class="menu-stage">[\s\S]*?<div id="map-carousel"/.exec(source);
  assert.ok(stage !== null, "expected #map-carousel inside the .menu-stage track");
});

test("tokens.css defines the cyan token behind the selected border", () => {
  const source = fs.readFileSync(TOKENS_CSS, "utf8");
  assert.match(source, /--color-cyan\s*:\s*#[0-9a-fA-F]{6}/);
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
