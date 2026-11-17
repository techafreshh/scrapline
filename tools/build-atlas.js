// Ingest the CC0 vector sprites into the web bundle's Pixi atlas index.
//
// Zero dependencies (node:fs/path only, like server.js): resolves
// packages/client/assets, copies the hand-authored *.svg sources into
// packages/client/dist/assets/, writes packages/client/dist/assets/atlas.json
// (a multi-sprite index of { meta, frames } the client preloads behind the
// loading screen), then enforces the 6 MB total-asset budget. Anything over
// budget exits nonzero so the build fails loudly instead of shipping bloat.
//
// Vendor phase (issue #261): curates the committed CC0 vendor PNG packs
// (platformer-characters, simplified-platformer-pack, particle-pack,
// ui-pack-pixel-adventure) into per-family PixiJS atlases under
// packages/client/assets/atlas/ plus a flat manifest.json mapping logical
// dot-names (soldier.run.3, tile.kilima.solid, fx.smoke.2) to frames.
// The build fails on any missing source file, any renderer-referenced key
// absent from the manifest, or total atlas weight over the same 6 MB cap.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "packages", "client", "assets");
const SRC_FONTS = path.join(SRC, "fonts");
const DEST = path.join(ROOT, "packages", "client", "dist", "assets");
const DEST_FONTS = path.join(DEST, "fonts");
const ATLAS = path.join(DEST, "atlas.json");

// Committed vendor-atlas output (probed directly) plus its staged copy
// under dist/assets (served by the existing server.js /assets/* route).
const VENDOR = path.join(SRC, "vendor");
const ATLAS_SRC = path.join(SRC, "atlas");
const ATLAS_DEST = path.join(DEST, "atlas");
const ATLAS_MANIFEST = path.join(ATLAS_SRC, "manifest.json");

// Total built assets must stay at or under 6 MB (the presentation-v2
// bundle-risk cap); the check sums every byte under dist/assets.
const BUDGET_BYTES = 6291456;

function fail(message) {
  console.error(`build-atlas: ${message}`);
  process.exit(1);
}

// Frame box in px, parsed from the svg root width/height (or viewBox when
// the pixel attrs are absent). Unknown shapes fall back to 32x32.
function frameSize(svg) {
  const attr = (name) => {
    const match = new RegExp(`${name}\\s*=\\s*"([\\d.]+)"`).exec(svg);
    return match !== null ? Number(match[1]) : NaN;
  };
  const w = attr("width");
  const h = attr("height");
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { w: Math.floor(w), h: Math.floor(h) };
  }
  const viewBox = /viewBox\s*=\s*"([\d.\s-]+)"/.exec(svg);
  if (viewBox !== null) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { w: Math.floor(parts[2]), h: Math.floor(parts[3]) };
    }
  }
  return { w: 32, h: 32 };
}

// Frame box in px, parsed from the PNG IHDR header (8-byte signature
// plus width/height as big-endian UInt32 at offsets 16/20). Every vendor
// source is a standard PNG, so anything else fails the build loudly
// instead of indexing a corrupt frame.
function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!Buffer.isBuffer(buf) || buf.length < 24) {
    fail("pngSize: short read — refusing to index a corrupt PNG.");
  }
  for (let i = 0; i < sig.length; i += 1) {
    if (buf[i] !== sig[i]) {
      fail("pngSize: bad PNG signature — refusing to index a non-PNG file.");
    }
  }
  if (buf.toString("latin1", 12, 16) !== "IHDR") {
    fail("pngSize: missing IHDR chunk — refusing to index a corrupt PNG.");
  }
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    fail("pngSize: unusable IHDR dimensions — refusing to index a corrupt PNG.");
  }
  return { w, h };
}

function sizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sizeBytes(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

// Curated vendor allowlist: logical dot-name plus the vendor PNG it
// copies (relative to packages/client/assets/vendor). The curated set
// stays near ~1.2 MB; a full vendor-tree ingest (~6.9 MB) would bust the
// gate on its own, so full-tree ingest is out by design.
const SOLDIER_POSES = "platformer-characters/PNG/Soldier/Poses";
const SOLDIER_LIMBS = "platformer-characters/PNG/Soldier/Limbs";
const PLATFORMER_TILES = "simplified-platformer-pack/PNG/Tiles";
const PARTICLES = "particle-pack/PNG";
const UI_SMALL = "ui-pack-pixel-adventure/Tiles/Small tiles/Thick outline";
const UI_SHEETS = "ui-pack-pixel-adventure/Tilesheets";

const ATLAS_ALLOWLIST = [
  // Characters: every Soldier pose plus the limb kit. The run cycle
  // maps walk1/walk2/stand/skid so soldier.run.3 always resolves.
  { name: "soldier.idle", from: `${SOLDIER_POSES}/soldier_idle.png` },
  { name: "soldier.run.0", from: `${SOLDIER_POSES}/soldier_walk1.png` },
  { name: "soldier.run.1", from: `${SOLDIER_POSES}/soldier_walk2.png` },
  { name: "soldier.run.2", from: `${SOLDIER_POSES}/soldier_stand.png` },
  { name: "soldier.run.3", from: `${SOLDIER_POSES}/soldier_skid.png` },
  { name: "soldier.jet", from: `${SOLDIER_POSES}/soldier_jump.png` },
  { name: "soldier.crouch", from: `${SOLDIER_POSES}/soldier_duck.png` },
  { name: "soldier.dead", from: `${SOLDIER_POSES}/soldier_hurt.png` },
  { name: "soldier.action.0", from: `${SOLDIER_POSES}/soldier_action1.png` },
  { name: "soldier.action.1", from: `${SOLDIER_POSES}/soldier_action2.png` },
  { name: "soldier.back", from: `${SOLDIER_POSES}/soldier_back.png` },
  { name: "soldier.cheer.0", from: `${SOLDIER_POSES}/soldier_cheer1.png` },
  { name: "soldier.cheer.1", from: `${SOLDIER_POSES}/soldier_cheer2.png` },
  { name: "soldier.climb.0", from: `${SOLDIER_POSES}/soldier_climb1.png` },
  { name: "soldier.climb.1", from: `${SOLDIER_POSES}/soldier_climb2.png` },
  { name: "soldier.fall", from: `${SOLDIER_POSES}/soldier_fall.png` },
  { name: "soldier.hang", from: `${SOLDIER_POSES}/soldier_hang.png` },
  { name: "soldier.hold.0", from: `${SOLDIER_POSES}/soldier_hold1.png` },
  { name: "soldier.hold.1", from: `${SOLDIER_POSES}/soldier_hold2.png` },
  { name: "soldier.kick", from: `${SOLDIER_POSES}/soldier_kick.png` },
  { name: "soldier.slide", from: `${SOLDIER_POSES}/soldier_slide.png` },
  { name: "soldier.swim.0", from: `${SOLDIER_POSES}/soldier_swim1.png` },
  { name: "soldier.swim.1", from: `${SOLDIER_POSES}/soldier_swim2.png` },
  { name: "soldier.talk", from: `${SOLDIER_POSES}/soldier_talk.png` },
  { name: "soldier.limb.arm", from: `${SOLDIER_LIMBS}/arm.png` },
  { name: "soldier.limb.body.back", from: `${SOLDIER_LIMBS}/body_back.png` },
  { name: "soldier.limb.body.front", from: `${SOLDIER_LIMBS}/body_front.png` },
  { name: "soldier.limb.hand", from: `${SOLDIER_LIMBS}/hand.png` },
  { name: "soldier.limb.head", from: `${SOLDIER_LIMBS}/head.png` },
  { name: "soldier.limb.head.back", from: `${SOLDIER_LIMBS}/head_back.png` },
  { name: "soldier.limb.head.focus", from: `${SOLDIER_LIMBS}/head_focus.png` },
  { name: "soldier.limb.head.hurt", from: `${SOLDIER_LIMBS}/head_hurt.png` },
  { name: "soldier.limb.leg", from: `${SOLDIER_LIMBS}/leg.png` },
  // Tiles: four kinds per theme (tile.kilima.solid first), each theme on
  // its own tile run so kilima/dune/frostbite stay visually distinct.
  { name: "tile.kilima.solid", from: `${PLATFORMER_TILES}/platformPack_tile001.png` },
  { name: "tile.kilima.oneway", from: `${PLATFORMER_TILES}/platformPack_tile002.png` },
  { name: "tile.kilima.bounce", from: `${PLATFORMER_TILES}/platformPack_tile003.png` },
  { name: "tile.kilima.backwall", from: `${PLATFORMER_TILES}/platformPack_tile004.png` },
  { name: "tile.dune.solid", from: `${PLATFORMER_TILES}/platformPack_tile005.png` },
  { name: "tile.dune.oneway", from: `${PLATFORMER_TILES}/platformPack_tile006.png` },
  { name: "tile.dune.bounce", from: `${PLATFORMER_TILES}/platformPack_tile007.png` },
  { name: "tile.dune.backwall", from: `${PLATFORMER_TILES}/platformPack_tile008.png` },
  { name: "tile.frostbite.solid", from: `${PLATFORMER_TILES}/platformPack_tile009.png` },
  { name: "tile.frostbite.oneway", from: `${PLATFORMER_TILES}/platformPack_tile010.png` },
  { name: "tile.frostbite.bounce", from: `${PLATFORMER_TILES}/platformPack_tile011.png` },
  { name: "tile.frostbite.backwall", from: `${PLATFORMER_TILES}/platformPack_tile012.png` },
  // Particles: smoke/muzzle/spark/fire runs plus one flame head.
  { name: "fx.smoke.0", from: `${PARTICLES}/smoke_01.png` },
  { name: "fx.smoke.1", from: `${PARTICLES}/smoke_02.png` },
  { name: "fx.smoke.2", from: `${PARTICLES}/smoke_03.png` },
  { name: "fx.smoke.3", from: `${PARTICLES}/smoke_04.png` },
  { name: "fx.muzzle.0", from: `${PARTICLES}/muzzle_01.png` },
  { name: "fx.muzzle.1", from: `${PARTICLES}/muzzle_02.png` },
  { name: "fx.muzzle.2", from: `${PARTICLES}/muzzle_03.png` },
  { name: "fx.spark.0", from: `${PARTICLES}/spark_01.png` },
  { name: "fx.spark.1", from: `${PARTICLES}/spark_02.png` },
  { name: "fx.fire.0", from: `${PARTICLES}/fire_01.png` },
  { name: "fx.fire.1", from: `${PARTICLES}/fire_02.png` },
  { name: "fx.flame.0", from: `${PARTICLES}/flame_01.png` },
  // UI: nine small-tile widgets plus both packed tilesheets, so the
  // Tilesheets dir ships a frame too instead of raw PNGs only.
  { name: "ui.panel", from: `${UI_SMALL}/tile_0000.png` },
  { name: "ui.button", from: `${UI_SMALL}/tile_0001.png` },
  { name: "ui.button.hover", from: `${UI_SMALL}/tile_0002.png` },
  { name: "ui.slot", from: `${UI_SMALL}/tile_0003.png` },
  { name: "ui.bar", from: `${UI_SMALL}/tile_0004.png` },
  { name: "ui.icon.0", from: `${UI_SMALL}/tile_0005.png` },
  { name: "ui.icon.1", from: `${UI_SMALL}/tile_0006.png` },
  { name: "ui.icon.2", from: `${UI_SMALL}/tile_0007.png` },
  { name: "ui.corner.0", from: `${UI_SMALL}/tile_0008.png` },
  { name: "ui.tilesheet.small", from: `${UI_SHEETS}/Small tiles/Thick outline/tilemap.png`, to: "ui/tilemap-small.png" },
  { name: "ui.tilesheet.large", from: `${UI_SHEETS}/Large tiles/Thick outline/tilemap.png`, to: "ui/tilemap-large.png" },
];

// Per-family PixiJS atlas file plus the on-disk subdir for one logical
// name. Tiles fan out per theme; everything else is one file per family.
function familyOf(name) {
  if (name.startsWith("soldier.")) {
    return { dir: "characters", json: "characters.json" };
  }
  if (name.startsWith("tile.")) {
    const theme = name.split(".")[1];
    if (theme !== "kilima" && theme !== "dune" && theme !== "frostbite") {
      fail(`atlas allowlist name ${name} has an unknown tile theme.`);
    }
    return { dir: "tiles", json: `tiles-${theme}.json` };
  }
  if (name.startsWith("fx.")) {
    return { dir: "particles", json: "particles.json" };
  }
  if (name.startsWith("ui.")) {
    return { dir: "ui", json: "ui.json" };
  }
  fail(`atlas allowlist name ${name} matches no family (soldier/tile/fx/ui).`);
}

const SRC_CLIENT = path.join(ROOT, "packages", "client", "src");

// Renderer frame references are quoted string literals only: bare
// property access (fx.muzzle, soldier.style) and prose (theme tile) also
// match a raw dot pattern but are not frame names, so only a quoted
// dotted token counts as a manifest reference.
const REF_PATTERN = /["'`](soldier|tile|fx)\.[A-Za-z0-9_.-]+["'`]/g;

// Every quoted soldier./tile./fx. token under packages/client/src.
function collectRendererRefs(dir) {
  const refs = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        const body = fs.readFileSync(full, "utf8");
        for (const match of body.matchAll(REF_PATTERN)) {
          refs.push({ file: path.relative(ROOT, full), ref: match[0].slice(1, -1) });
        }
      }
    }
  };
  walk(dir);
  return refs;
}

// Pure subset check: renderer refs with no manifest entry, if any.
function findMissingRefs(refs, manifest) {
  return refs.filter(({ ref }) => !Object.hasOwn(manifest, ref));
}

function main() {
  let names;
  try {
    names = fs.readdirSync(SRC).filter((name) => name.endsWith(".svg"));
  } catch {
    fail(`missing ${SRC} — add the CC0 *.svg sources first.`);
  }
  if (names.length === 0) {
    fail(`no *.svg sources in ${SRC} — nothing to ingest.`);
  }
  fs.mkdirSync(DEST, { recursive: true });
  const frames = {};
  for (const name of names.sort()) {
    const body = fs.readFileSync(path.join(SRC, name), "utf8");
    if (!/<svg[\s>]/.test(body)) {
      fail(`${name} is not a valid SVG root — refusing to index it.`);
    }
    fs.copyFileSync(path.join(SRC, name), path.join(DEST, name));
    const base = name.slice(0, -".svg".length);
    const { w, h } = frameSize(body);
    frames[base] = { file: name, w, h };
  }
  const index = { meta: { app: "scrapline", version: 1 }, frames };
  fs.writeFileSync(ATLAS, JSON.stringify(index, null, 2) + "\n");
  // Display webfont plus bitmap manifest (issue #151): copy the OFL
  // woff2 and fonts.json verbatim so /assets/fonts/* serves offline.
  // Missing fonts dir fails loudly like the missing-svg case above.
  let fontNames;
  try {
    fontNames = fs.readdirSync(SRC_FONTS).filter((name) => {
      const lower = name.toLowerCase();
      return (
        lower.endsWith(".woff2") ||
        lower.endsWith(".woff") ||
        lower.endsWith(".ttf") ||
        lower.endsWith(".otf") ||
        lower.endsWith(".json")
      );
    });
  } catch {
    fail(`missing ${SRC_FONTS} — add the OFL display webfont first.`);
  }
  if (fontNames.length === 0) {
    fail(`no font files in ${SRC_FONTS} — nothing to ingest.`);
  }
  fs.mkdirSync(DEST_FONTS, { recursive: true });
  for (const name of fontNames.sort()) {
    fs.copyFileSync(path.join(SRC_FONTS, name), path.join(DEST_FONTS, name));
  }
  const bytes = sizeBytes(DEST);
  console.log(
    `build-atlas: ingested ${names.length} sprites + ${fontNames.length} fonts -> ${ATLAS} (${(bytes / 1048576).toFixed(2)} MB)`,
  );
  if (bytes > BUDGET_BYTES) {
    fail(`asset budget exceeded: ${bytes} bytes > ${BUDGET_BYTES} bytes.`);
  }

  // Vendor atlas phase: copy the allowlist into per-family subdirs of
  // packages/client/assets/atlas/, size each PNG from IHDR, and emit
  // the per-family PixiJS frame maps plus the flat manifest.json.
  // A missing source file fails here, never ships a partial atlas.
  // The output dir is cleared first so shrinking the allowlist cannot
  // leave orphan PNG/JSON bytes behind to phantom-count the 6 MB gate.
  fs.rmSync(ATLAS_SRC, { recursive: true, force: true });
  fs.mkdirSync(ATLAS_SRC, { recursive: true });
  const manifest = {};
  const families = {};
  for (const entry of ATLAS_ALLOWLIST) {
    const from = path.join(VENDOR, entry.from);
    let buf;
    try {
      buf = fs.readFileSync(from);
    } catch {
      fail(`atlas source missing: ${entry.from} for ${entry.name}.`);
    }
    const { w, h } = pngSize(buf);
    const { dir, json } = familyOf(entry.name);
    // Per-entry dest override (the two UI tilesheets share a vendor
    // basename, so they pin distinct files instead of overwriting).
    const file = entry.to ?? `${dir}/${path.basename(entry.from)}`;
    fs.mkdirSync(path.join(ATLAS_SRC, dir), { recursive: true });
    fs.copyFileSync(from, path.join(ATLAS_SRC, file));
    manifest[entry.name] = { file, atlas: json, w, h };
    if (!families[json]) {
      families[json] = { dir, frames: {} };
    }
    families[json].frames[entry.name] = { file, x: 0, y: 0, w, h };
  }
  for (const [json, family] of Object.entries(families).sort()) {
    const doc = {
      meta: { app: "scrapline", version: 1, family: json.replace(/\.json$/, "") },
      frames: family.frames,
    };
    fs.writeFileSync(path.join(ATLAS_SRC, json), JSON.stringify(doc, null, 2) + "\n");
  }
  fs.writeFileSync(ATLAS_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  // Renderer-reference validation: every quoted soldier./tile./fx.
  // token in runtime sources must resolve to a manifest key, so later
  // sprite swaps paint only frames the atlas actually ships.
  const refs = collectRendererRefs(SRC_CLIENT);
  const missing = findMissingRefs(refs, manifest);
  if (missing.length > 0) {
    const lines = missing.map(({ file, ref }) => `  ${ref} (${file})`).join("\n");
    fail(`renderer references missing from the atlas manifest:\n${lines}`);
  }

  // 6 MB weight gate on the committed atlas dir, then stage the atlas
  // into dist/assets so the existing /assets/* route serves it with no
  // server change. Padding the dir over budget fails the build.
  const atlasBytes = sizeBytes(ATLAS_SRC);
  console.log(
    `build-atlas: atlas ${ATLAS_ALLOWLIST.length} frames (${refs.length} renderer refs) -> ${ATLAS_SRC} (${(atlasBytes / 1048576).toFixed(2)} MB)`,
  );
  if (atlasBytes > BUDGET_BYTES) {
    fail(`atlas budget exceeded: ${atlasBytes} bytes > ${BUDGET_BYTES} bytes.`);
  }
  copyTree(ATLAS_SRC, ATLAS_DEST);
  const stagedBytes = sizeBytes(DEST);
  console.log(
    `build-atlas: staged -> ${ATLAS_DEST} (${(stagedBytes / 1048576).toFixed(2)} MB)`,
  );
  if (stagedBytes > BUDGET_BYTES) {
    fail(`asset budget exceeded: ${stagedBytes} bytes > ${BUDGET_BYTES} bytes.`);
  }
}

// Guarded so tests can require this file for frameSize/pngSize and the
// reference scanner without ingesting: requiring it only defines helpers,
// running it copies and indexes.
if (require.main === module) {
  main();
}

module.exports = { frameSize, pngSize, sizeBytes, collectRendererRefs, findMissingRefs, BUDGET_BYTES };
