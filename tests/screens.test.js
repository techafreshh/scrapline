// Overlay screens contract tests (issue #350, Art A5): black-box HTTP
// probes plus static scans proving every panel shares the plate/head/
// body/primary skeleton, settings rides sliders plus toggles with no
// native chrome, how-to carries 11 keycap rows, challenges carries 5
// structured rows with a countdown, locker carries tabs plus a
// scrollable grid with preview and equip, the end screen carries the
// winner banner with local highlight and two actions, the connecting
// card and the self-contained no-JS image serve. Mirrors
// tests/overlays.test.js (freePort + spawned server.js + get()).
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
const PUBLIC = path.join(ROOT, "packages", "client", "public");
const CHROME_CSS = path.join(PUBLIC, "components", "chrome.css");
const OVERLAY_SHEETS = [
  "setup.css",
  "settings.css",
  "howto.css",
  "challenges.css",
  "locker.css",
  "endscreen.css",
  "connecting.css",
];
const UI_DIR = path.join(ROOT, "packages", "client", "assets", "ui");

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

async function getBytes(pathname) {
  const res = await fetch(base + pathname);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

/** Slice the served HTML from an id to the matching close (depth-counted). */
function blockFor(source, id) {
  const open = source.indexOf(`id="${id}"`);
  assert.ok(open !== -1, `expected id="${id}" in /`);
  let depth = 0;
  let i = source.indexOf("<div", open);
  while (i !== -1) {
    if (source.startsWith("</div>", i)) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open, i + "</div>".length);
      }
      i += "</div>".length;
    } else {
      depth += 1;
      i += "<div".length;
    }
    const nextClose = source.indexOf("</div>", i);
    const nextOpen = source.indexOf("<div", i);
    if (nextClose === -1) {
      break;
    }
    i = nextOpen !== -1 && nextOpen < nextClose ? nextOpen : nextClose;
  }
  assert.fail(`unbalanced divs under #${id}`);
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

test("GET / links all seven overlay stylesheets", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  for (const sheet of OVERLAY_SHEETS) {
    assert.match(root.text, new RegExp(`/overlays/${sheet.replace(".", "\\.")}`));
  }
});

test("GET /overlays/*.css returns 200 CSS for all seven panels", async () => {
  for (const sheet of OVERLAY_SHEETS) {
    const res = await get(`/overlays/${sheet}`);
    assert.equal(res.status, 200, `expected 200 for /overlays/${sheet}`);
    assert.match(res.contentType, /text\/css/, `expected CSS for ${sheet}`);
    assert.ok(res.text.length > 0, `expected a body for ${sheet}`);
  }
});

test("every panel shares the plate/head/rows/primary skeleton", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  for (const id of ["setup", "settings", "howto", "challenges", "locker", "end-screen"]) {
    const block = blockFor(root.text, id);
    assert.match(block, /class="sl-panel/, `#${id} must carry the plate`);
    assert.match(block, /panel-head/, `#${id} must carry the head`);
    assert.match(block, /<h2>/, `#${id} must carry a title`);
    assert.match(block, /panel-close/, `#${id} must carry the close`);
    assert.match(block, /panel-rows/, `#${id} must carry the body rows`);
    if (id === "locker") {
      // The locker primary lives in the preview column beside the grid.
      assert.ok(block.includes('id="locker-equip"'), "locker must carry the equip action");
    } else {
      assert.match(block, /panel-actions/, `#${id} must carry the action footer`);
    }
    assert.match(block, /sl-btn/, `#${id} must carry a primary action`);
  }
});

test("GET / mounts the setup five-row skeleton with thumbs and Start", async () => {
  const root = await get("/");
  const block = blockFor(root.text, "setup");
  for (const id of ["bots-minus", "bots-value", "bots-plus", "cosmetics", "cosmetics-preview", "btn-start"]) {
    assert.ok(block.includes(`id="${id}"`), `setup must mount #${id}`);
  }
  const thumbs = block.match(/data-setup-thumb="(kilima|dune|frostbite)"/g) || [];
  assert.equal(thumbs.length, 3, `setup must carry 3 arena thumbs, got ${thumbs.length}`);
  assert.match(block, /menu-cta/, "Start must ride the primary CTA");
});

test("GET / mounts settings sliders, kit toggles, reset, and done", async () => {
  const root = await get("/");
  const block = blockFor(root.text, "settings");
  assert.ok(block.includes('id="volume"'), "settings must mount #volume");
  assert.ok(block.includes('id="music-volume"'), "settings must mount #music-volume");
  for (const id of ["btn-fullscreen", "btn-quality", "btn-nametags"]) {
    assert.ok(block.includes(`id="${id}"`), `settings must mount #${id}`);
  }
  const toggles = block.match(/class="sl-toggle[ "]/g) || [];
  assert.ok(toggles.length >= 3, `settings must carry >=3 toggle plates, got ${toggles.length}`);
  const labels = block.match(/class="toggle-text"/g) || [];
  assert.ok(labels.length >= 3, `settings must carry >=3 toggle labels, got ${labels.length}`);
  assert.ok(block.includes('id="settings-reset"'), "settings must mount #settings-reset");
  assert.ok(block.includes('id="settings-done"'), "settings must mount #settings-done");
});

test("GET / mounts 11 how-to rows with a keycap plate each", async () => {
  const root = await get("/");
  const block = blockFor(root.text, "howto");
  const rows = block.match(/<tr><td>/g) || [];
  assert.equal(rows.length, 11, `how-to must carry 11 control rows, got ${rows.length}`);
  const caps = block.match(/sl-keycap/g) || [];
  assert.ok(caps.length >= 11, `how-to must carry >=11 keycaps, got ${caps.length}`);
  assert.ok(block.includes('id="controls-table"'), "how-to must mount #controls-table");
  assert.ok(block.includes('id="howto-done"'), "how-to must mount #howto-done");
});

test("GET / mounts 5 structured challenge rows with countdown and done", async () => {
  const root = await get("/");
  const block = blockFor(root.text, "challenges");
  const rows = block.match(/class="challenge-row"/g) || [];
  assert.equal(rows.length, 5, `challenges must carry 5 rows, got ${rows.length}`);
  for (const cls of ["challenge-icon", "challenge-main", "challenge-bar", "challenge-fill", "challenge-progress", "challenge-reward", "challenge-check"]) {
    const hits = block.match(new RegExp(`class="${cls}"`, "g")) || [];
    assert.equal(hits.length, 5, `challenges must carry 5 .${cls}, got ${hits.length}`);
  }
  assert.ok(block.includes('id="challenges-countdown"'), "challenges must mount the reset chip");
  assert.ok(block.includes('id="challenges-done"'), "challenges must mount #challenges-done");
});

test("GET / mounts the locker tabs, scrollable grid, preview, and equip", async () => {
  const root = await get("/");
  const block = blockFor(root.text, "locker");
  const tabs = block.match(/data-locker-tab="/g) || [];
  assert.equal(tabs.length, 3, `locker must carry 3 tabs, got ${tabs.length}`);
  const items = block.match(/class="locker-item"/g) || [];
  assert.ok(items.length >= 8, `locker must carry >=8 grid items, got ${items.length}`);
  assert.ok(block.includes('id="locker-preview-full"'), "locker must mount the preview");
  assert.ok(block.includes('id="locker-status-full"'), "locker must mount the status");
  assert.ok(block.includes('id="locker-equip"'), "locker must mount #locker-equip");
});

test("GET / mounts the end screen with banner, standings, and two actions", async () => {
  const root = await get("/");
  const block = blockFor(root.text, "end-screen");
  assert.ok(block.includes('id="end-winner"'), "end screen must mount #end-winner");
  assert.ok(block.includes("winner-trophy"), "end screen must mount the trophy well");
  assert.ok(block.includes("winner-text"), "end screen must mount the callout");
  assert.ok(block.includes('id="end-standings"'), "end screen must mount #end-standings");
  assert.ok(block.includes('id="restart"'), "end screen must mount #restart");
  assert.ok(block.includes('id="end-menu"'), "end screen must mount #end-menu");
  assert.match(block, /menu-cta/, "Play again must ride the primary CTA");
});

test("GET / mounts the connecting card and the self-contained no-JS image", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  const card = blockFor(root.text, "net-status");
  assert.match(card, /net-card/, "net-status must carry the card");
  assert.ok(card.includes('id="net-title"'), "net-status must mount #net-title");
  assert.ok(card.includes('id="net-hint"'), "net-status must mount #net-hint");
  assert.ok(card.includes('id="net-cancel"'), "net-status must mount #net-cancel");
  assert.ok(card.includes('id="net-retry"'), "net-status must mount #net-retry");
  assert.match(root.text, /<noscript>/, "page must carry a <noscript> fallback");
  assert.match(root.text, /id="noscript-art"/, "fallback must mount the art hook");
  assert.match(root.text, /role="img"/, "fallback art must stay labelled without JS");
  // The plate ships as one staged kit file (no bundler duplicate):
  // chrome.css paints the hook from `assets/ui/noscript.png`.
  const chrome = fs.readFileSync(CHROME_CSS, "utf8");
  assert.ok(chrome.includes("assets/ui/noscript.png"), "chrome.css must paint the fallback plate");
  assert.ok(chrome.includes("#noscript-art"), "chrome.css must centre the fallback art");
});

test("GET /assets/ui/noscript.png serves the 480x240 fallback", async () => {
  const res = await getBytes("/assets/ui/noscript.png");
  assert.equal(res.status, 200);
  assert.match(res.contentType, /image\/png/);
  assert.deepEqual(
    Array.from(res.buffer.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "noscript.png must carry the PNG signature",
  );
  assert.equal(res.buffer.readUInt32BE(16), 480, "noscript.png width must be 480");
  assert.equal(res.buffer.readUInt32BE(20), 240, "noscript.png height must be 240");
});

test("static chrome.css skins every screen from the kit", () => {
  const source = fs.readFileSync(CHROME_CSS, "utf8");
  for (const art of [
    "bar.fill.png",
    "bar.track.png",
    "slider.track.png",
    "slider.thumb.png",
    "toggle.off.png",
    "toggle.on.png",
    "keycap.png",
    "chip.png",
    "row.selected.png",
    "panel.banner.png",
    "panel.hazard.png",
    "panel.inset.png",
    "panel.elevated.png",
    "button.icon.png",
    "panel.inset.png",
  ]) {
    assert.ok(source.includes(art), `chrome.css must reference ${art}`);
  }
  for (const hook of [
    "#loading-bar",
    ".sl-toggle-btn",
    ".sl-keycap",
    ".challenge-icon",
    ".challenge-bar",
    ".challenge-fill",
    ".challenge-reward",
    ".challenge-check",
    ".locker-swatch",
    ".locker-grid",
    "#locker-equip",
    "#end-winner",
    ".winner-trophy",
    ".standings-row.local",
    ".net-card",
    ".net-track",
    ".net-fill",
    "#noscript-art",
  ]) {
    assert.ok(source.includes(hook), `chrome.css must skin ${hook}`);
  }
  assert.match(source, /appearance\s*:\s*none/, "chrome.css must kill native control chrome");
  assert.match(source, /-webkit-appearance\s*:\s*none/, "chrome.css must kill WebKit native chrome");
  assert.doesNotMatch(source, /background-repeat\s*:\s*repeat\b/, "chrome.css must never tile");
});

test("static overlay sheets stay token-clean with the shared skeleton", () => {
  for (const sheet of OVERLAY_SHEETS) {
    const source = fs.readFileSync(path.join(PUBLIC, "overlays", sheet), "utf8");
    assert.match(source, /\.panel-head/, `${sheet} must carry the shared header`);
    assert.match(source, /\.panel-close/, `${sheet} must carry the close hook`);
    assert.match(source, /\.panel-rows/, `${sheet} must carry the body rows`);
    assert.match(source, /var\(--spacing-/, `${sheet} must space from the token scale`);
    assert.doesNotMatch(source, /background-image/, `${sheet} must never tile an image`);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{6}/, `${sheet} must consume tokens, not raw hex`);
    assert.doesNotMatch(source, /z-index/, `${sheet} stacking stays owned by layers.css`);
  }
});

test("static kit ships the fallback image beside the menu plates", () => {
  assert.ok(fs.existsSync(path.join(UI_DIR, "noscript.png")), "noscript.png must be committed");
  const manifest = JSON.parse(fs.readFileSync(path.join(UI_DIR, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.noscript, { file: "ui/noscript.png", w: 480, h: 240 });
});
