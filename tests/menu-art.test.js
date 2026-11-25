// Menu restyle contract tests (issue #348): black-box HTTP probes for
// the sliced /assets/ui/* kit plus static scans proving the carousel
// nav affordances, the plates, and the token guard rails. Mirrors
// tests/menu-carousel.test.js (freePort + spawned server.js + get()).
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
const CHROME_CSS = path.join(ROOT, "packages", "client", "public", "components", "chrome.css");
const TOKENS_CSS = path.join(ROOT, "packages", "client", "public", "tokens.css");
const SRC_HTML = path.join(ROOT, "packages", "client", "index.html");
const CAROUSEL_TS = path.join(ROOT, "packages", "client", "src", "menu", "carousel.ts");
const ART_TS = path.join(ROOT, "packages", "client", "src", "menu", "art.ts");
const UI_DIR = path.join(ROOT, "packages", "client", "assets", "ui");
const COMBINED = path.join(ROOT, "packages", "server", "src", "server.ts");

const KIT = [
  "wordmark.png",
  "menu-card.png",
  "menu-arrow-left.png",
  "menu-arrow-right.png",
  "menu-dot-on.png",
  "menu-dot-off.png",
  "menu-tip.png",
  "menu-avatar.png",
  "menu-field.png",
];

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
    buffer: Buffer.from(await res.arrayBuffer()),
    text: "",
  };
}

async function getText(pathname) {
  const res = await fetch(base + pathname);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    text: await res.text(),
  };
}

/** PNG signature + IHDR dimensions. */
function pngDims(buf) {
  assert.deepEqual(
    Array.from(buf.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "expected the PNG signature",
  );
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
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
      const health = await getText("/api/health");
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

test("GET /assets/ui/wordmark.png serves the sliced lockup at 237x50", async () => {
  const res = await get("/assets/ui/wordmark.png");
  assert.equal(res.status, 200);
  assert.match(res.contentType, /image\/png/);
  const dims = pngDims(res.buffer);
  assert.deepEqual([dims.width, dims.height], [237, 50]);
});

test("GET /assets/ui/* serves every menu plate as a PNG", async () => {
  for (const name of KIT) {
    const res = await get(`/assets/ui/${name}`);
    assert.equal(res.status, 200, `GET /assets/ui/${name} returned ${res.status}`);
    assert.match(res.contentType, /image\/png/, `${name} must serve PNG`);
    const dims = pngDims(res.buffer);
    assert.ok(dims.width > 0 && dims.height > 0, `${name} must have a box`);
  }
});

test("static chrome.css points every menu url at the committed kit", () => {
  const source = fs.readFileSync(CHROME_CSS, "utf8");
  const urls = [];
  for (const match of source.matchAll(/url\("(\.\.\/assets\/ui\/[^"]+)"\)/g)) {
    urls.push(match[1]);
  }
  assert.ok(urls.length >= 9, `expected >=9 menu art urls, got ${urls.length}`);
  for (const url of urls) {
    const disk = path.join(UI_DIR, path.basename(url));
    assert.ok(fs.existsSync(disk), `${url} must exist in ${UI_DIR}`);
  }
});

test("static chrome.css never repeats menu art and sizes it whole-pixel", () => {
  const source = fs.readFileSync(CHROME_CSS, "utf8");
  assert.doesNotMatch(source, /background-repeat\s*:\s*repeat\b/);
  assert.match(source, /menu-art-ready/);
  assert.match(source, /wordmark\.png/);
  assert.match(source, /menu-card\.png/);
  assert.match(source, /menu-tip\.png/);
  assert.match(source, /menu-avatar\.png/);
  assert.match(source, /menu-field\.png/);
});

test("source index.html flanks the cards with arrows and dots", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  const prev = source.indexOf('id="carousel-prev"');
  const carousel = source.indexOf('id="map-carousel"');
  const next = source.indexOf('id="carousel-next"');
  const dots = source.indexOf('id="carousel-dots"');
  assert.ok(prev !== -1 && carousel !== -1 && next !== -1 && dots !== -1);
  assert.ok(prev < carousel, "prev arrow must precede the cards");
  assert.ok(carousel < next, "next arrow must follow the cards");
  assert.ok(next < dots, "dots must follow the arrows");
  const dotHits = source.match(/data-carousel-dot="(kilima|dune|frostbite)"/g) || [];
  assert.equal(dotHits.length, 3, `expected 3 page dots, got ${dotHits.length}`);
  assert.match(source, /data-carousel-dot="kilima"[^>]*aria-selected="true"/);
  const avatar = source.indexOf('id="profile-avatar"');
  const row = source.indexOf('id="profile-row"');
  assert.ok(avatar !== -1 && row !== -1 && avatar > row, "avatar must open the profile row");
});

test("source index.html keeps the lockup and the six secondaries", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(source, /<h1 class="menu-logo">Scrapline<\/h1>/);
  const matches = source.match(/menu-secondary/g) || [];
  assert.equal(matches.length, 6, `expected 6 menu-secondary hits, got ${matches.length}`);
});

test("static menu.css carries the carousel and avatar boxes on tokens", () => {
  const source = fs.readFileSync(MENU_CSS, "utf8");
  for (const selector of [".carousel-shell", ".carousel-row", ".carousel-arrow", "#carousel-dots", ".carousel-dot", "#profile-avatar"]) {
    assert.ok(source.includes(selector), `expected ${selector} in menu.css`);
  }
  assert.match(source, /\[data-theme="dune"\]/);
  assert.match(source, /\[data-theme="frostbite"\]/);
  assert.doesNotMatch(source, /background-image/, "menu.css must never tile an image");
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}/, "menu.css must consume token variables");
});

test("static tokens.css defines the per-theme scrim veils", () => {
  const source = fs.readFileSync(TOKENS_CSS, "utf8");
  assert.match(source, /--color-scrim-dune\s*:/);
  assert.match(source, /--color-scrim-frostbite\s*:/);
});

test("carousel source cycles, syncs dots, and mirrors the theme", () => {
  const source = fs.readFileSync(CAROUSEL_TS, "utf8");
  assert.match(source, /cycleCarouselMap/);
  assert.match(source, /syncCarouselDots/);
  assert.match(source, /syncMenuTheme/);
  assert.match(source, /setAttribute\("data-theme"/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  const art = fs.readFileSync(ART_TS, "utf8");
  assert.match(art, /menu-art-ready/);
  assert.match(art, /assets\/ui\/wordmark\.png/);
});

test("combined server source serves the /assets/* route", () => {
  const source = fs.readFileSync(COMBINED, "utf8");
  assert.match(source, /\/assets\//);
});
