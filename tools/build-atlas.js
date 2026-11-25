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

// CRC-32 (ISO 3309) over a buffer: the PNG chunk checksum primitive.
// Table-driven, zero dependencies (zlib covers compression only).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Decode a vendor sheet PNG to RGBA bytes. The Kenney packed sheets are
// 8-bit palette PNGs (color type 3) with PLTE/tRNS and no interlacing;
// anything else fails loudly so a corrupt sheet never crops silently.
function decodeSheetPng(buf, label) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i += 1) {
    if (buf[i] !== sig[i]) {
      fail(`decodeSheetPng: bad PNG signature for ${label}.`);
    }
  }
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let alpha = null;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      alpha = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (colorType !== 3 || bitDepth !== 8 || interlace !== 0) {
    fail(`decodeSheetPng: ${label} must be an 8-bit non-interlaced palette PNG.`);
  }
  if (palette === null) {
    fail(`decodeSheetPng: ${label} is missing its PLTE chunk.`);
  }
  let raw;
  try {
    raw = require("node:zlib").inflateSync(Buffer.concat(idat));
  } catch {
    fail(`decodeSheetPng: ${label} has unreadable IDAT data.`);
  }
  const stride = w + 1;
  if (raw.length !== stride * h) {
    fail(`decodeSheetPng: ${label} has an unexpected scanline size.`);
  }
  // Unfilter scanlines (bpp 1: palette indices) into a flat index plane.
  const indices = Buffer.alloc(w * h);
  let prev = Buffer.alloc(w, 0);
  for (let y = 0; y < h; y += 1) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const filter = row[0];
    const cur = Buffer.alloc(w, 0);
    for (let x = 0; x < w; x += 1) {
      const a = x > 0 ? cur[x - 1] : 0;
      const b = prev[x];
      const c = x > 0 ? prev[x - 1] : 0;
      let v = row[x + 1];
      if (filter === 1) {
        v = (v + a) & 0xff;
      } else if (filter === 2) {
        v = (v + b) & 0xff;
      } else if (filter === 3) {
        v = (v + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      } else if (filter !== 0) {
        fail(`decodeSheetPng: ${label} uses an unknown filter ${filter}.`);
      }
      cur[x] = v;
    }
    cur.copy(indices, y * w);
    prev = cur;
  }
  const entries = palette.length / 3;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const idx = indices[i];
    if (idx >= entries) {
      fail(`decodeSheetPng: ${label} has a palette index ${idx} beyond its PLTE length.`);
    }
    rgba[i * 4] = palette[idx * 3];
    rgba[i * 4 + 1] = palette[idx * 3 + 1];
    rgba[i * 4 + 2] = palette[idx * 3 + 2];
    rgba[i * 4 + 3] = alpha !== null && idx < alpha.length ? alpha[idx] : 255;
  }
  return { w, h, rgba };
}

// Crop one cell out of a decoded sheet and encode it as an RGBA PNG.
// `darken` multiplies RGB (backwalls pre-darken to 0.6); alpha passes
// through untouched so platform silhouettes keep their cutouts.
function cropCellPng(sheet, crop, darken) {
  if (!Number.isInteger(crop.x) || !Number.isInteger(crop.y) ||
    !Number.isInteger(crop.w) || !Number.isInteger(crop.h) ||
    crop.w <= 0 || crop.h <= 0 ||
    crop.x < 0 || crop.y < 0 ||
    crop.x + crop.w > sheet.w || crop.y + crop.h > sheet.h) {
    fail(`cropCellPng: crop ${JSON.stringify(crop)} is outside the ${sheet.w}x${sheet.h} sheet.`);
  }
  const factor = darken === undefined ? 1 : darken;
  if (!(factor > 0) || factor > 1) {
    fail(`cropCellPng: darken ${darken} must be in (0, 1].`);
  }
  const out = Buffer.alloc(crop.w * crop.h * 4);
  for (let y = 0; y < crop.h; y += 1) {
    for (let x = 0; x < crop.w; x += 1) {
      const src = ((crop.y + y) * sheet.w + (crop.x + x)) * 4;
      const dst = (y * crop.w + x) * 4;
      out[dst] = Math.round(sheet.rgba[src] * factor);
      out[dst + 1] = Math.round(sheet.rgba[src + 1] * factor);
      out[dst + 2] = Math.round(sheet.rgba[src + 2] * factor);
      out[dst + 3] = sheet.rgba[src + 3];
    }
  }
  const rawRows = Buffer.alloc((crop.w * 4 + 1) * crop.h);
  for (let y = 0; y < crop.h; y += 1) {
    rawRows[y * (crop.w * 4 + 1)] = 0;
    out.copy(rawRows, y * (crop.w * 4 + 1) + 1, y * crop.w * 4, (y + 1) * crop.w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(crop.w, 0);
  ihdr.writeUInt32BE(crop.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = require("node:zlib").deflateSync(rawRows);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
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
// Bot silhouette sets (issue #265): one Poses dir per
// `platformer-characters` family backing the bot roster order.
const ADVENTURER_POSES = "platformer-characters/PNG/Adventurer/Poses";
const ZOMBIE_POSES = "platformer-characters/PNG/Zombie/Poses";
const FEMALE_POSES = "platformer-characters/PNG/Female/Poses";
const PLAYER_POSES = "platformer-characters/PNG/Player/Poses";
// Themed tileset sheets (issue #266): Kenney `pixel-platformer` plus the
// `pixel-platformer-industrial-expansion` for dune/frostbite. Both packed
// sheets are 18px grids with no spacing (360x162 = 20x9, 288x126 = 16x7).
const PIXEL_SHEET = "pixel-platformer/Tilemap/tilemap_packed.png";
const INDUSTRIAL_SHEET = "pixel-platformer-industrial-expansion/Tilemap/tilemap_packed.png";
/** Vendor sheet cell in px (both packed sheets share the 18px grid). */
const VENDOR_CELL = 18;
const PARTICLES = "particle-pack/PNG";
const SIMPLIFIED_TILES = "simplified-platformer-pack/PNG/Tiles";
const SIMPLIFIED_ITEMS = "simplified-platformer-pack/PNG/Items";
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
  // Bots (issue #265): idle plus the walk1/walk2/stand/skid run cycle
  // (run.0..run.3), jump (jet), duck (crouch), fall (hurt), and hurt
  // (dead) per silhouette set, mirroring the soldier pose mapping.
  { name: "adventurer.idle", from: `${ADVENTURER_POSES}/adventurer_idle.png` },
  { name: "adventurer.run.0", from: `${ADVENTURER_POSES}/adventurer_walk1.png` },
  { name: "adventurer.run.1", from: `${ADVENTURER_POSES}/adventurer_walk2.png` },
  { name: "adventurer.run.2", from: `${ADVENTURER_POSES}/adventurer_stand.png` },
  { name: "adventurer.run.3", from: `${ADVENTURER_POSES}/adventurer_skid.png` },
  { name: "adventurer.jet", from: `${ADVENTURER_POSES}/adventurer_jump.png` },
  { name: "adventurer.crouch", from: `${ADVENTURER_POSES}/adventurer_duck.png` },
  { name: "adventurer.fall", from: `${ADVENTURER_POSES}/adventurer_fall.png` },
  { name: "adventurer.dead", from: `${ADVENTURER_POSES}/adventurer_hurt.png` },
  { name: "zombie.idle", from: `${ZOMBIE_POSES}/zombie_idle.png` },
  { name: "zombie.run.0", from: `${ZOMBIE_POSES}/zombie_walk1.png` },
  { name: "zombie.run.1", from: `${ZOMBIE_POSES}/zombie_walk2.png` },
  { name: "zombie.run.2", from: `${ZOMBIE_POSES}/zombie_stand.png` },
  { name: "zombie.run.3", from: `${ZOMBIE_POSES}/zombie_skid.png` },
  { name: "zombie.jet", from: `${ZOMBIE_POSES}/zombie_jump.png` },
  { name: "zombie.crouch", from: `${ZOMBIE_POSES}/zombie_duck.png` },
  { name: "zombie.fall", from: `${ZOMBIE_POSES}/zombie_fall.png` },
  { name: "zombie.dead", from: `${ZOMBIE_POSES}/zombie_hurt.png` },
  { name: "female.idle", from: `${FEMALE_POSES}/female_idle.png` },
  { name: "female.run.0", from: `${FEMALE_POSES}/female_walk1.png` },
  { name: "female.run.1", from: `${FEMALE_POSES}/female_walk2.png` },
  { name: "female.run.2", from: `${FEMALE_POSES}/female_stand.png` },
  { name: "female.run.3", from: `${FEMALE_POSES}/female_skid.png` },
  { name: "female.jet", from: `${FEMALE_POSES}/female_jump.png` },
  { name: "female.crouch", from: `${FEMALE_POSES}/female_duck.png` },
  { name: "female.fall", from: `${FEMALE_POSES}/female_fall.png` },
  { name: "female.dead", from: `${FEMALE_POSES}/female_hurt.png` },
  { name: "player.idle", from: `${PLAYER_POSES}/player_idle.png` },
  { name: "player.run.0", from: `${PLAYER_POSES}/player_walk1.png` },
  { name: "player.run.1", from: `${PLAYER_POSES}/player_walk2.png` },
  { name: "player.run.2", from: `${PLAYER_POSES}/player_stand.png` },
  { name: "player.run.3", from: `${PLAYER_POSES}/player_skid.png` },
  { name: "player.jet", from: `${PLAYER_POSES}/player_jump.png` },
  { name: "player.crouch", from: `${PLAYER_POSES}/player_duck.png` },
  { name: "player.fall", from: `${PLAYER_POSES}/player_fall.png` },
  { name: "player.dead", from: `${PLAYER_POSES}/player_hurt.png` },
  // Tiles (issue #266): four kinds per theme (tile.kilima.solid first),
  // cropped 1:1 from the vendor sheets at 18px per cell and painted at
  // 32px per ASCII cell. kilima draws only on `pixel-platformer`;
  // dune/frostbite draw solids/backwalls on the industrial expansion
  // sheet and one-way/bounce cells on `pixel-platformer`, so every theme
  // stays visually distinct. Solids come from each sheet's ground-block
  // cluster (the heavily-used GIDs in the Tiled example map); one-way
  // and bounce come from distinct non-ground runs so the three shapes
  // never alias. Backwalls reuse the theme solid cell pre-darkened to
  // 60% (the BACKWALL_BRIGHTNESS contract) for the behind-playfield read.
  { name: "tile.kilima.solid", from: PIXEL_SHEET, crop: { x: 36, y: 108, w: 18, h: 18 }, to: "tiles/tile-kilima-solid.png" },
  { name: "tile.kilima.oneway", from: PIXEL_SHEET, crop: { x: 54, y: 18, w: 18, h: 18 }, to: "tiles/tile-kilima-oneway.png" },
  { name: "tile.kilima.bounce", from: PIXEL_SHEET, crop: { x: 126, y: 54, w: 18, h: 18 }, to: "tiles/tile-kilima-bounce.png" },
  { name: "tile.kilima.backwall", from: PIXEL_SHEET, crop: { x: 36, y: 108, w: 18, h: 18 }, darken: 0.6, to: "tiles/tile-kilima-backwall.png" },
  { name: "tile.dune.solid", from: INDUSTRIAL_SHEET, crop: { x: 54, y: 54, w: 18, h: 18 }, to: "tiles/tile-dune-solid.png" },
  { name: "tile.dune.oneway", from: PIXEL_SHEET, crop: { x: 144, y: 18, w: 18, h: 18 }, to: "tiles/tile-dune-oneway.png" },
  { name: "tile.dune.bounce", from: PIXEL_SHEET, crop: { x: 216, y: 72, w: 18, h: 18 }, to: "tiles/tile-dune-bounce.png" },
  { name: "tile.dune.backwall", from: INDUSTRIAL_SHEET, crop: { x: 54, y: 54, w: 18, h: 18 }, darken: 0.6, to: "tiles/tile-dune-backwall.png" },
  { name: "tile.frostbite.solid", from: INDUSTRIAL_SHEET, crop: { x: 162, y: 36, w: 18, h: 18 }, to: "tiles/tile-frostbite-solid.png" },
  { name: "tile.frostbite.oneway", from: PIXEL_SHEET, crop: { x: 90, y: 18, w: 18, h: 18 }, to: "tiles/tile-frostbite-oneway.png" },
  { name: "tile.frostbite.bounce", from: PIXEL_SHEET, crop: { x: 252, y: 90, w: 18, h: 18 }, to: "tiles/tile-frostbite-bounce.png" },
  { name: "tile.frostbite.backwall", from: INDUSTRIAL_SHEET, crop: { x: 162, y: 36, w: 18, h: 18 }, darken: 0.6, to: "tiles/tile-frostbite-backwall.png" },
  // Particles: smoke/muzzle/spark/fire runs plus one flame head, plus
  // the issue #269 flash/trail/sparkle runs (explosion flash,
  // jet exhaust trail, pickup sparkle) from the same particle-pack
  // so every pixi-v8-particle-emitter texture resolves in-manifest.
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
  { name: "fx.flash.0", from: `${PARTICLES}/flare_01.png` },
  { name: "fx.flash.1", from: `${PARTICLES}/light_01.png` },
  { name: "fx.trail.0", from: `${PARTICLES}/trace_01.png` },
  { name: "fx.trail.1", from: `${PARTICLES}/trace_02.png` },
  { name: "fx.sparkle.0", from: `${PARTICLES}/star_01.png` },
  { name: "fx.sparkle.1", from: `${PARTICLES}/star_02.png` },
  // Props + pads (issue #267): crates/barrels plus weapon/health/
  // grenade/bounce pads from the simplified-platformer-pack tiles/items
  // (64x64, byte-distinct) with the barrel explosion scorch from the
  // particle-pack, so every prop/pad state paints distinct pack art.
  // Cracked stages and the bounce squash own distinct keys so probes
  // read state changes without guessing paint internals.
  { name: "prop.crate.intact", from: `${SIMPLIFIED_TILES}/platformPack_tile036.png`, to: "props/prop-crate-intact.png" },
  { name: "prop.crate.crack", from: `${SIMPLIFIED_TILES}/platformPack_tile037.png`, to: "props/prop-crate-crack.png" },
  { name: "prop.barrel.intact", from: `${SIMPLIFIED_TILES}/platformPack_tile038.png`, to: "props/prop-barrel-intact.png" },
  { name: "prop.barrel.crack", from: `${SIMPLIFIED_TILES}/platformPack_tile039.png`, to: "props/prop-barrel-crack.png" },
  { name: "prop.barrel.explode", from: `${PARTICLES}/scorch_01.png`, to: "props/prop-barrel-explode.png" },
  { name: "pad.weapon", from: `${SIMPLIFIED_ITEMS}/platformPack_item001.png`, to: "pads/pad-weapon.png" },
  { name: "pad.health", from: `${SIMPLIFIED_ITEMS}/platformPack_item002.png`, to: "pads/pad-health.png" },
  { name: "pad.grenades", from: `${SIMPLIFIED_ITEMS}/platformPack_item003.png`, to: "pads/pad-grenades.png" },
  { name: "pad.bounce", from: `${SIMPLIFIED_TILES}/platformPack_tile040.png`, to: "pads/pad-bounce.png" },
  { name: "pad.bounce.squash", from: `${SIMPLIFIED_TILES}/platformPack_tile041.png`, to: "pads/pad-bounce-squash.png" },
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

// Per-weapon muzzle offsets in pivot-relative world px at rest aim
// (issue #264). Source of truth is render/weapons.ts WEAPON_MUZZLES:
// each x duplicates the WEAPON_DEFS gun length for that id so the
// drawn gun tip, the muzzle flash, and the tracer origin coincide by
// construction. Emitted as flat data-only weapon.<id>.muzzle keys (no
// image file, no atlas family), so familyOf stays untouched.
const WEAPON_MUZZLES = {
  pistol: { x: 14, y: 0 },
  smg: { x: 16, y: 0 },
  rifle: { x: 18, y: 0 },
  shotgun: { x: 19, y: 0 },
  sniper: { x: 22, y: 0 },
  rocket: { x: 21, y: 0 },
};

// Per-family PixiJS atlas file plus the on-disk subdir for one logical
// name. Tiles fan out per theme; everything else is one file per family.
function familyOf(name) {
  if (
    name.startsWith("soldier.") ||
    name.startsWith("adventurer.") ||
    name.startsWith("zombie.") ||
    name.startsWith("female.") ||
    name.startsWith("player.")
  ) {
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
  if (name.startsWith("prop.")) {
    return { dir: "props", json: "props.json" };
  }
  if (name.startsWith("pad.")) {
    return { dir: "pads", json: "pads.json" };
  }
  if (name.startsWith("ui.")) {
    return { dir: "ui", json: "ui.json" };
  }
  fail(`atlas allowlist name ${name} matches no family (characters/tile/fx/prop/pad/ui).`);
}

// Decoded-sheet cache for cropped entries: one decode per vendor sheet
// no matter how many tile cells it contributes.
const sheetCache = new Map();

function decodedSheetFor(absPath, label) {
  const hit = sheetCache.get(absPath);
  if (hit !== undefined) {
    return hit;
  }
  let buf;
  try {
    buf = fs.readFileSync(absPath);
  } catch {
    fail(`atlas source missing: ${label}.`);
  }
  const decoded = decodeSheetPng(buf, label);
  sheetCache.set(absPath, decoded);
  return decoded;
}

const SRC_CLIENT = path.join(ROOT, "packages", "client", "src");

// Renderer frame references are quoted string literals only: bare
// property access (fx.muzzle, soldier.style) and prose (theme tile) also
// match a raw dot pattern but are not frame names, so only a quoted
// dotted token counts as a manifest reference.
const REF_PATTERN = /["'`](soldier|adventurer|zombie|female|player|tile|fx|prop|pad)\.[A-Za-z0-9_.-]+["'`]/g;

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
    // Cropped entries (issue #266 tiles): one 18px cell out of a vendor
    // sheet, optionally pre-darkened, encoded as its own RGBA PNG so the
    // manifest box always matches the file IHDR. Sheets decode once and
    // are shared across entries. Everything else copies through verbatim.
    let w;
    let h;
    const { dir, json } = familyOf(entry.name);
    // Per-entry dest override (the two UI tilesheets share a vendor
    // basename, so they pin distinct files instead of overwriting; every
    // cropped tile pins its own file since sheets would otherwise collide).
    const file = entry.to ?? `${dir}/${path.basename(entry.from)}`;
    fs.mkdirSync(path.join(ATLAS_SRC, dir), { recursive: true });
    if (entry.crop !== undefined && entry.crop !== null) {
      const decoded = decodedSheetFor(from, entry.from);
      const cell = cropCellPng(decoded, entry.crop, entry.darken);
      const box = pngSize(cell);
      w = box.w;
      h = box.h;
      fs.writeFileSync(path.join(ATLAS_SRC, file), cell);
    } else {
      const box = pngSize(buf);
      w = box.w;
      h = box.h;
      fs.copyFileSync(from, path.join(ATLAS_SRC, file));
    }
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
  // In-hand weapon muzzle points (issue #264): flat data-only
  // weapon.<id>.muzzle keys with pivot-relative {x, y} offsets. Keyed
  // with concatenation (never a quoted dotted literal) so the
  // renderer-reference scanner below keeps reporting no weapon refs.
  for (const [id, offset] of Object.entries(WEAPON_MUZZLES)) {
    manifest["weapon." + id + ".muzzle"] = { x: offset.x, y: offset.y };
  }
  fs.writeFileSync(ATLAS_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  // Chrome kit phase (issue #347): slice the curated SH-01a kit plus
  // the CH singles into ui.* art, overwrite the five stretched 16x16
  // tiles with the sliced files, and merge the full control library
  // (panels, buttons, bars, inputs, rows, ornaments) into the manifest
  // and ui.json. Runs after the vendor phase so the replacements win;
  // the stale tiles are dropped here, before the weight gate and the
  // dist staging below, so neither the tree nor the bundle falls back.
  // Deterministic (palette order plus fixed deflate), so committed
  // bytes equal rebuilt bytes; failures name slice-chrome, never this.
  try {
    const { sliceChrome } = require("./slice-chrome.js");
    const chromeWritten = sliceChrome(ATLAS_SRC);
    console.log(`build-atlas: chrome kit -> ${chromeWritten.length} ui frames`);
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }

  // Renderer-reference validation: every quoted
  // soldier./adventurer./zombie./female./player./tile./fx. token in
  // runtime sources must resolve to a manifest key, so later sprite
  // swaps paint only frames the atlas actually ships.
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

module.exports = { frameSize, pngSize, sizeBytes, collectRendererRefs, findMissingRefs, BUDGET_BYTES, ATLAS_ALLOWLIST, WEAPON_MUZZLES, decodeSheetPng, cropCellPng, VENDOR_CELL };
