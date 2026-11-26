// Art A9 menu type hierarchy + CTA legibility contract tests (issue
// #381): black-box HTTP probes for /menu.css plus static scans proving
// the CTA label clears 24px on a flat accent face (edge band only), the
// wordmark clears 56px as the largest element, the six secondaries clear
// 16px on one consistent inset, and the panel lands in the 282-333px
// band at 1280x720. Mirrors tests/menu-cta.test.js (freePort + spawned
// server.js + get() + ruleBody/declarationValue helpers).
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

test("GET /menu.css returns 200 CSS carrying the A9 type hooks", async () => {
  const menu = await get("/menu.css");
  assert.equal(menu.status, 200);
  assert.match(menu.contentType, /text\/css/);
  assert.match(menu.text, /\.menu-logo/);
  assert.match(menu.text, /\.menu-cta/);
  assert.match(menu.text, /\.menu-secondary/);
});

test("static menu.css sets the CTA label past the 24px floor", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const size = pxNumber(declarationValue(ruleBody(source, ".menu-cta"), "font-size"));
  assert.ok(size !== null, "CTA rule must set font-size");
  assert.ok(size >= 24, `CTA label must be >= 24px, got: ${size}px`);
});

test("static menu.css keeps the CTA face flat (edge band only)", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  for (const selector of [".menu-cta", ".menu-cta:hover", ".menu-cta:active"]) {
    const body = ruleBody(source, selector);
    const slice = declarationValue(body, "border-image-slice");
    assert.ok(slice !== null, `${selector} must set border-image-slice`);
    assert.doesNotMatch(slice, /fill/, `${selector} must drop the fill so the face stays flat`);
    assert.match(
      declarationValue(body, "background") || "",
      /var\(--accent/,
      `${selector} face must reference the accent token`,
    );
  }
  const base = ruleBody(source, ".menu-cta");
  assert.match(
    declarationValue(base, "color") || "",
    /var\(--color-bg/,
    "CTA ink must reference the dark token for the 12:1 face contrast",
  );
});

test("static menu.css makes the wordmark the largest element past 56px", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const height = pxNumber(declarationValue(ruleBody(source, ".menu-logo"), "min-height"));
  assert.ok(height !== null, "wordmark rule must set min-height");
  assert.ok(height >= 56, `wordmark must be >= 56px tall, got: ${height}px`);
  const artHeight = pxNumber(
    (declarationValue(ruleBody(source, ".menu-art-ready .menu-logo"), "background-size") || "").split(/\s+/)[1],
  );
  assert.ok(artHeight !== null, "wordmark art must set background-size");
  assert.ok(artHeight >= 56, `wordmark art must be >= 56px tall, got: ${artHeight}px`);
  const cta = pxNumber(declarationValue(ruleBody(source, ".menu-cta"), "font-size"));
  assert.ok(height > (cta ?? 0), "wordmark box must outscale the CTA label");
});

test("static menu.css keeps every secondary label at 16px on one inset", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const body = ruleBody(source, ".menu-secondary");
  const size = declarationValue(body, "font-size") || "";
  const resolved = size.includes("var(--font-body)") ? 16 : pxNumber(size);
  assert.ok(resolved !== null && resolved >= 16, `secondary labels must be >= 16px, got: ${size}`);
  assert.equal(
    declarationValue(body, "margin-left"),
    declarationValue(body, "margin-right"),
    "the six secondaries must share one consistent lateral inset",
  );
  assert.match(declarationValue(body, "margin-left") || "", /var\(--spacing/, "inset must ride the spacing scale");
});

test("static menu.css lands the panel inside the 282-333px band", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const columns = declarationValue(ruleBody(source, ".menu-grid"), "grid-template-columns") || "";
  const track = pxNumber((columns.split(/\s+minmax\(0, 1fr\)/)[0].match(/,\s*([\d.]+px)\s*\)/) || [])[1] ?? null);
  assert.ok(track !== null, `grid first track must cap in px, got: ${columns}`);
  assert.ok(track >= 282 && track <= 333, `panel track must land 282-333px, got: ${track}px`);
  const cap = pxNumber(declarationValue(ruleBody(source, ".menu-column"), "max-width"));
  assert.ok(cap !== null, "menu column must set max-width");
  assert.ok(cap >= 282 && cap <= 333, `panel must land 282-333px, got: ${cap}px`);
  // 320px reads 25% of the 1280px viewport: inside the 22-26% mockup band.
  assert.ok(cap / 1280 >= 0.22 && cap / 1280 <= 0.26, `panel must read 22-26% of 1280px, got: ${(cap / 1280 * 100).toFixed(1)}%`);
});

test("static menu.css keeps the CTA summary chip inside the plate", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const qp = ruleBody(source, "#quick-play");
  assert.equal(declarationValue(qp, "padding-left"), "var(--spacing-12)");
  assert.equal(declarationValue(qp, "padding-right"), "var(--spacing-12)");
  const chip = ruleBody(source, "#quick-play-chip");
  assert.equal(pxNumber(declarationValue(chip, "font-size")), 11);
  const pad = declarationValue(chip, "padding") || "";
  assert.match(pad, /var\(--spacing-8\)/);
});

test("static A9 type scale reads wordmark > CTA > secondary", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  const wordmark = pxNumber(declarationValue(ruleBody(source, ".menu-logo"), "min-height"));
  const cta = pxNumber(declarationValue(ruleBody(source, ".menu-cta"), "font-size"));
  const secondaryBody = ruleBody(source, ".menu-secondary");
  const secondaryRaw = declarationValue(secondaryBody, "font-size") || "";
  const secondary = secondaryRaw.includes("var(--font-body)") ? 16 : pxNumber(secondaryRaw);
  assert.ok(wordmark !== null && cta !== null && secondary !== null);
  assert.ok(wordmark > cta, "wordmark must outscale the CTA label");
  assert.ok(cta > secondary, "CTA label must outscale the secondary labels");
});

test("static menu.css upholds the token/image/stacking bans", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}/, "menu.css stays token-only");
  assert.doesNotMatch(source, /background-image/, "menu.css must never tile an image");
  assert.doesNotMatch(source, /z-index/, "stacking stays owned by layers.css");
});

test("source index.html still mounts the wordmark, CTA, and six secondaries", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(source, /<h1 class="menu-logo">Scrapline<\/h1>/);
  assert.match(source, /id="quick-play"/);
  const matches = source.match(/menu-secondary/g) || [];
  assert.equal(matches.length, 6, `expected 6 menu-secondary hits, got ${matches.length}`);
});
