// Icon kit black-box contract tests (issue #351): the committed
// PNG-8 atlas wells, the PWA app icons, and the DOM wiring that proves
// ammo/killfeed/pads/toasts/challenges/locker/rank all ride the set.
// Mirrors tests/menu-art.test.js (freePort + spawned server.js + get()).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ATLAS_DIR = path.join(ROOT, "packages", "client", "assets", "atlas");
const PUBLIC_DIR = path.join(ROOT, "packages", "client", "public");
const SRC_HTML = path.join(ROOT, "packages", "client", "index.html");

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(ATLAS_DIR, "manifest.json"), "utf8"));
}

function iconsAtlas() {
  return JSON.parse(fs.readFileSync(path.join(ATLAS_DIR, "icons.json"), "utf8"));
}

/** PNG signature + IHDR box + color type (3 = PNG-8). */
function pngInfo(file) {
  const buf = fs.readFileSync(file);
  assert.deepEqual(
    Array.from(buf.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${file} must carry the PNG signature`,
  );
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colorType: buf[25] };
}

test("manifest pins 57 icon.* PNG-8 wells in icons.json", () => {
  const doc = manifest();
  const keys = Object.keys(doc).filter((k) => k.startsWith("icon."));
  assert.ok(keys.length >= 57, `expected >=57 icon keys, got ${keys.length}`);
  const atlas = iconsAtlas();
  for (const key of keys) {
    const entry = doc[key];
    assert.match(entry.file, /^icons\//, `${key} must live under icons/`);
    assert.match(entry.file, /\.png$/, `${key} must be a PNG`);
    assert.equal(entry.atlas, "icons.json");
    assert.ok(entry.w > 0 && entry.h > 0, `${key} must have a box`);
    const disk = path.join(ATLAS_DIR, entry.file);
    assert.ok(fs.existsSync(disk), `${entry.file} must exist`);
    const info = pngInfo(disk);
    assert.equal(info.colorType, 3, `${entry.file} must be PNG-8`);
    assert.equal(info.w, entry.w, `${key} w must match IHDR`);
    assert.equal(info.h, entry.h, `${key} h must match IHDR`);
    assert.ok(atlas.frames[key], `${key} must have an icons.json frame`);
    assert.equal(atlas.frames[key].w, entry.w);
  }
});

test("weapon small wells are 16x16 for the under-20px kill feed", () => {
  const doc = manifest();
  for (const id of ["pistol", "smg", "rifle", "shotgun", "sniper", "rocket"]) {
    const key = `icon.weapon.${id}.small`;
    assert.ok(doc[key], `${key} must exist`);
    assert.equal(doc[key].w, 16);
    assert.equal(doc[key].h, 16);
  }
});

test("public app icons ship 512 + 192 maskable as PNG-8", () => {
  for (const [name, size] of [["icon-512.png", 512], ["icon-192-maskable.png", 192]]) {
    const disk = path.join(PUBLIC_DIR, "icons", name);
    assert.ok(fs.existsSync(disk), `${name} must exist`);
    const info = pngInfo(disk);
    assert.equal(info.colorType, 3, `${name} must be PNG-8`);
    assert.equal(info.w, size);
    assert.equal(info.h, size);
  }
});

test("manifest.webmanifest points at the new PNG app icons", () => {
  const doc = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "manifest.webmanifest"), "utf8"));
  assert.equal(doc.name, "Scrapline");
  assert.ok(Array.isArray(doc.icons) && doc.icons.length >= 2);
  const bySize = new Map(doc.icons.map((icon) => [String(icon.sizes), icon]));
  assert.ok(bySize.has("512x512"), "512 icon must exist");
  assert.ok(bySize.has("192x192"), "192 icon must exist");
  for (const icon of doc.icons) {
    assert.match(String(icon.src), /\.png$/, "app icons must be PNG");
    assert.doesNotMatch(String(icon.src), /\.svg$/, "app icons must not be SVG");
  }
  assert.match(String(bySize.get("192x192").purpose), /maskable/, "192 must be maskable");
  assert.match(String(bySize.get("512x512").src), /icon-512\.png/);
});

test("index.html carries no SVG icon refs and no inline SVG", () => {
  const html = fs.readFileSync(SRC_HTML, "utf8");
  assert.doesNotMatch(html, /<svg[\s>]/, "no inline SVG allowed");
  assert.doesNotMatch(html, /src="[^"]*weapon-.*\.svg"/, "no SVG weapon refs");
  assert.doesNotMatch(html, /src="[^"]*pickup-.*\.svg"/, "no SVG pickup refs");
  assert.doesNotMatch(html, /<img[^>]*\ssrc="[^"]*atlas\/icons\//, "static wells must use data-src so Vite never flattens them");
  assert.match(html, /id="ammo-icon"[^>]*data-src="[^"]*weapon-smg\.png"/, "ammo module must use the SMG well");
  assert.match(html, /challenge-icon-img[^>]*challenge-headshot\.png/, "rifle row must use the headshot well");
  assert.match(html, /challenge-icon-img[^>]*challenge-trophy\.png/, "win rows must use the trophy well");
  assert.match(html, /locker-icon[^>]*cosmetic-helmet\.png/, "locker must use the cosmetic set");
  assert.match(html, /carousel-glyph-img[^>]*glyph-chev-left\.png/, "carousel prev must use the glyph set");
  assert.match(html, /carousel-glyph-img[^>]*glyph-chev-right\.png/, "carousel next must use the glyph set");
  assert.match(html, /profile-badge/, "rank badge element must exist");
});

test("index.html keeps the Lv N text inside the rank badge visual", () => {
  const html = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(html, /<span id="profile-badge">Lv 1<\/span>/, "badge text must stay Lv N HTML");
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "components", "icons.css"), "utf8");
  assert.match(css, /#profile-badge/, "rank badge visual must be styled");
  assert.match(css, /rank-badge\.png/, "rank badge must use the IC-06 plate");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}/, "icons.css must consume tokens, not raw hex");
});

test("rank badge plate survives runtime repaints (no shorthand wipe, no chip overpaint)", () => {
  // The badge repaint must tint via the backgroundColor longhand: the
  // `background` shorthand would reset background-image to none and
  // erase the IC-06 plate on every profile refresh.
  const profile = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "meta", "profile.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    profile,
    /setStyle\(badge,\s*"background"/,
    "badge tint must not use the background shorthand",
  );
  assert.match(
    profile,
    /setStyle\(badge,\s*"backgroundColor"/,
    "badge tint must ride the backgroundColor longhand",
  );
  // The sliced chip plate (border-image with fill) paints above
  // backgrounds, so icons.css must neutralize it on the badge with a
  // selector that ties #stage #profile-badge and wins by later order.
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "components", "icons.css"), "utf8");
  assert.match(css, /#stage #profile-badge/, "badge override must beat the chrome chip selector");
  assert.match(css, /border-image-source\s*:\s*none/, "badge must drop the chip border-image");
});

test("sw.js warms the new PNG icons, never the SVG", () => {
  const source = fs.readFileSync(path.join(PUBLIC_DIR, "sw.js"), "utf8");
  assert.match(source, /icons\/icon-512\.png/);
  assert.match(source, /icons\/icon-192-maskable\.png/);
  assert.doesNotMatch(source, /icons\/icon\.svg/);
});
