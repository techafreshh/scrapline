// No-JS fallback art (issue #350, act A5, SC-11): the single
// self-contained panel image behind the `<noscript>` fallback. The
// whole point of the fallback is that scripting is dead, so the art
// ships as one committed PNG (no atlas lookup, no JS): a dark plate
// with a steel frame, an orange top rail, a broken-plate glyph, two
// placeholder text lines, and a dim hint line — the SC-11 mockup
// composition in the twelve-colour palette.
//
// Procedural (not sliced): the mockup is a full-bleed scene with no
// chroma key, so the panel is drawn pixel-exact at 1x and PNG-8
// encoded through the slice-sheet pipeline (palette lock, fixed
// deflate, deterministic bytes). Zero dependencies (node:fs/path
// plus tools/slice-sheet.js). Invoked two ways: directly to commit
// the art (`node tools/make-noscript.js`), and from
// tools/build-atlas.js after the menu phase so every build
// regenerates the identical bytes.
const fs = require("node:fs");
const path = require("node:path");

const slicer = require("./slice-sheet.js");

const ROOT = path.join(__dirname, "..");
const DEFAULT_UI_DIR = path.join(ROOT, "packages", "client", "assets", "ui");

/** Panel box (SC-11 at half scale: the 720x360 plate at 2x pixel pitch). */
const NOSCRIPT_W = 480;
const NOSCRIPT_H = 240;
const NOSCRIPT_NAME = "noscript";
const NOSCRIPT_FILE = "ui/noscript.png";

/** Twelve-colour palette entries used by the fallback plate. */
const INK = [11, 15, 26];
const STEEL = [42, 53, 80];
const EDGE = [74, 90, 127];
const ORANGE = [255, 107, 53];
const MUTED = [138, 148, 168];

/** Framebuffer: row-major RGBA over the panel box. */
function blankFrame() {
  return {
    w: NOSCRIPT_W,
    h: NOSCRIPT_H,
    rgba: Buffer.alloc(NOSCRIPT_W * NOSCRIPT_H * 4, 255),
  };
}

/** Fill one rectangle with an opaque palette colour. */
function fillRect(img, x, y, w, h, color) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(img.w, x + w);
  const y1 = Math.min(img.h, y + h);
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      const i = (yy * img.w + xx) * 4;
      img.rgba[i] = color[0];
      img.rgba[i + 1] = color[1];
      img.rgba[i + 2] = color[2];
      img.rgba[i + 3] = 255;
    }
  }
}

/**
 * Draw the SC-11 plate into a framebuffer: ink field, steel frame,
 * orange top rail, broken-plate glyph, two placeholder lines, and the
 * dim hint line. Pure (no fs); returns the image for encodePng8.
 */
function drawNoscript() {
  const img = blankFrame();
  // Ink field.
  fillRect(img, 0, 0, img.w, img.h, INK);
  // Steel frame: 4px border.
  fillRect(img, 0, 0, img.w, 4, STEEL);
  fillRect(img, 0, img.h - 4, img.w, 4, STEEL);
  fillRect(img, 0, 0, 4, img.h, STEEL);
  fillRect(img, img.w - 4, 0, 4, img.h, STEEL);
  // Orange top rail under the frame.
  fillRect(img, 4, 4, img.w - 8, 6, ORANGE);
  // Broken-plate glyph: a 48px ring with a diagonal crack plus two
  // offset shards, centred at (240, 72).
  const gx = 240 - 24;
  const gy = 72 - 24;
  const s = 48;
  const t = 6;
  // Ring (top, bottom, left, right bars).
  fillRect(img, gx, gy, s, t, ORANGE);
  fillRect(img, gx, gy + s - t, s, t, ORANGE);
  fillRect(img, gx, gy, t, s, ORANGE);
  fillRect(img, gx + s - t, gy, t, s, ORANGE);
  // Crack: a diagonal ink gap across the ring.
  for (let i = 0; i < s; i += 1) {
    const cx = gx + i;
    const cy = gy + s - 1 - i;
    fillRect(img, cx - 2, cy - 2, 6, 6, INK);
  }
  // Shards: two small orange chips knocked loose below-right.
  fillRect(img, gx + s + 6, gy + s - 14, 10, 8, ORANGE);
  fillRect(img, gx + s + 20, gy + s - 8, 6, 6, ORANGE);
  // Placeholder text lines (muted bars, centred).
  fillRect(img, 240 - 140, 140, 280, 12, MUTED);
  fillRect(img, 240 - 100, 160, 200, 12, MUTED);
  // Dim hint line (edge tone).
  fillRect(img, 240 - 80, 196, 160, 8, EDGE);
  return img;
}

/**
 * Render the fallback plate and write `noscript.png` plus its manifest
 * entry into the ui dir. Returns the written records. Throws on
 * failure naming the `noscript` stage.
 */
function makeNoscript(uiDir = DEFAULT_UI_DIR) {
  let img;
  try {
    img = drawNoscript();
  } catch (err) {
    throw new Error(`noscript:draw: ${err && err.message ? err.message : err}`, { cause: err });
  }
  let buf;
  try {
    buf = slicer.encodePng8(img);
  } catch (err) {
    throw new Error(`noscript:encode: ${err && err.message ? err.message : err}`, { cause: err });
  }
  try {
    fs.mkdirSync(uiDir, { recursive: true });
  } catch (err) {
    throw new Error(`noscript:mkdir: ${err && err.message ? err.message : err}`, { cause: err });
  }
  try {
    fs.writeFileSync(path.join(uiDir, "noscript.png"), buf);
  } catch (err) {
    throw new Error(`noscript:write: ${err && err.message ? err.message : err}`, { cause: err });
  }
  // Manifest sidecar: keep every existing entry, then (re)set ours so
  // re-runs stay byte-identical and slice-menu order is preserved.
  const manifestPath = path.join(uiDir, "manifest.json");
  let manifest = {};
  try {
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    }
  } catch (err) {
    throw new Error(`noscript:manifest-read: ${err && err.message ? err.message : err}`, { cause: err });
  }
  manifest[NOSCRIPT_NAME] = { file: NOSCRIPT_FILE, w: NOSCRIPT_W, h: NOSCRIPT_H };
  try {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (err) {
    throw new Error(`noscript:manifest-write: ${err && err.message ? err.message : err}`, { cause: err });
  }
  return [{ name: NOSCRIPT_NAME, file: "noscript.png", w: NOSCRIPT_W, h: NOSCRIPT_H }];
}

if (require.main === module) {
  try {
    const written = makeNoscript();
    console.log(`make-noscript: noscript kit -> ${written.length} ui files`);
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

module.exports = { makeNoscript, drawNoscript, NOSCRIPT_W, NOSCRIPT_H };
