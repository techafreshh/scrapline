// Menu art slicer (issue #348, act A3): the menu restyle act of the
// slice-sheet pipeline (issue #346). Turns the ME-* reference sheets in
// docs/ui-prompts/results/ into shippable 1x pixel-art PNG-8 files under
// packages/client/assets/ui/ (NOT the atlas: the wordmark contract ships
// as assets/ui/wordmark.png, served at /assets/ui/* after the
// build-atlas menu phase stages it into dist).
//
// Stages mirror tools/slice-chrome.js (chroma key, pitch-4 detect,
// downscale, quantise, gutter-split, pad, PNG-8 encode); every stage is
// a pure exported helper and every failure throws (and the CLI prints)
// `slice-menu:<stage>: <detail>` with a nonzero exit. Zero dependencies
// (node:fs/path only).
//
// Sources and geometry (verified against the committed JPEGs):
// - ME-02 wordmark: chroma sheet, pitch 4, single bbox crop.
// - ME-04 arena card frame: chroma sheet, pitch 4, single bbox crop
//   (the well stays dark: border-image `fill` keeps it, the opaque
//   thumbnail canvas covers it at runtime).
// - ME-05 carousel controls: chroma sheet, pitch 4, x-gutter split
//   into exactly 5 cells (left arrow, right arrow, dot-on, dot-off,
//   dot-off spare); arrows pad to one common box, dots to another.
// - ME-06 tip strip: full-bleed band (no usable pitch: the band is a
//   1024px render, not pitched art), so the plate is an explicit
//   48x48 native dither-patch crop from the band interior (x 300..348,
//   y 200..248: clear of the nub, the well, and the 256px panel seams).
// - ME-07 profile row: no chroma anywhere (dark wall scene), so the
//   avatar plate and the name-field plate are explicit native crops
//   (avatar x 42..192 y 201..365; field x 228..508 y 252..316).
const fs = require("node:fs");
const path = require("node:path");

const slicer = require("./slice-sheet.js");

const ROOT = path.join(__dirname, "..");
const RESULTS = path.join(ROOT, "docs", "ui-prompts", "results");
const DEFAULT_UI_DIR = path.join(ROOT, "packages", "client", "assets", "ui");

function fail(stage, detail) {
  throw new Error(`slice-menu:${stage}: ${detail}`);
}

// Decode one result JPEG through the chroma pipeline and return the
// quantised image plus its opaque bounding box.
function loadQuant(source) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(RESULTS, source));
  } catch (err) {
    fail("decode", `cannot read ${source}: ${err.message}`);
  }
  const decoded = slicer.decodeImage(raw);
  const keyed = slicer.erodeAlpha(slicer.chromaKey(decoded));
  const found = slicer.detectPitch(keyed);
  const down = slicer.downscaleNearest(keyed, found.pitch, found.phaseX, found.phaseY);
  const quant = slicer.quantiseNearest(down);
  const box = slicer.boundingBox(quant);
  return { quant, box, pitch: found.pitch };
}

// Decode one result JPEG with NO chroma/pitch stages (native pixels,
// for sheets that ship no magenta key). Returns the quantised image.
function loadNative(source) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(RESULTS, source));
  } catch (err) {
    fail("decode", `cannot read ${source}: ${err.message}`);
  }
  const decoded = slicer.decodeImage(raw);
  return slicer.quantiseNearest(decoded);
}

// Zero-alpha runs along one axis of a box: the cell gutters.
function gutterRuns(img, box, axis) {
  const runs = [];
  const len = axis === "x" ? box.w : box.h;
  const isEmpty = (i) => {
    if (axis === "x") {
      for (let cy = 0; cy < box.h; cy += 1) {
        if (img.rgba[((box.y + cy) * img.w + box.x + i) * 4 + 3] !== 0) {
          return false;
        }
      }
      return true;
    }
    for (let cx = 0; cx < box.w; cx += 1) {
      if (img.rgba[((box.y + i) * img.w + box.x + cx) * 4 + 3] !== 0) {
        return false;
      }
    }
    return true;
  };
  let start = -1;
  for (let i = 0; i < len; i += 1) {
    if (isEmpty(i)) {
      if (start < 0) {
        start = i;
      }
    } else if (start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) {
    runs.push([start, len - 1]);
  }
  return runs;
}

// Split a box on its gutters into exactly `count` segments along `axis`.
function splitBox(img, box, axis, count, source) {
  const runs = gutterRuns(img, box, axis);
  const segments = [];
  let prev = 0;
  for (const [a, b] of runs) {
    segments.push([prev, a - 1]);
    prev = b + 1;
  }
  segments.push([prev, (axis === "x" ? box.w : box.h) - 1]);
  const kept = segments.filter(([a, b]) => b >= a);
  if (kept.length !== count) {
    fail(
      "crop",
      `${source} splits into ${kept.length} ${axis} cells, expected ${count} — refusing to guess.`,
    );
  }
  return kept.map(([a, b]) => {
    const rect =
      axis === "x"
        ? { x: box.x + a, y: box.y, w: b - a + 1, h: box.h }
        : { x: box.x, y: box.y + a, w: box.w, h: b - a + 1 };
    return slicer.cropImage(img, rect);
  });
}

// Trim an image to its own opaque bounding box (cells that share a
// split band keep transparent margins; dots must not).
function trimBox(img, source, label) {
  const box = slicer.boundingBox(img);
  if (box.w <= 0 || box.h <= 0) {
    fail("crop", `${source} cell ${label} is fully transparent — refusing to emit.`);
  }
  return slicer.cropImage(img, box);
}

// Round up to a multiple of 4px (whole-pixel display boxes only).
function ceil4(n) {
  return Math.ceil(n / 4) * 4;
}

// Pad one image to w/h (never scales).
function pad4(img, w, h) {
  return slicer.padCanvas(img, ceil4(w), ceil4(h), 0);
}

// Assert an explicit native rect lies inside the image.
function checkRect(img, rect, source, label) {
  if (
    !Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    !Number.isInteger(rect.w) ||
    !Number.isInteger(rect.h) ||
    rect.w <= 0 ||
    rect.h <= 0 ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.w > img.w ||
    rect.y + rect.h > img.h
  ) {
    fail("crop", `${source} ${label} rect is out of bounds — refusing to guess.`);
  }
}

// Slice every menu asset into { name, img } cells. Pure apart from
// reading the committed result JPEGs.
function sliceCells() {
  const cells = [];
  // Wordmark (ME-02 single lockup).
  {
    const { quant, box, pitch } = loadQuant("ME-02-v1.jpg");
    if (pitch !== 4) {
      fail("pitch", `ME-02-v1.jpg detected pitch ${pitch}, expected 4 — refusing to guess.`);
    }
    cells.push({ name: "wordmark", img: slicer.cropImage(quant, box) });
  }
  // Arena card frame (ME-04 single plate).
  {
    const { quant, box, pitch } = loadQuant("ME-04-v1.jpg");
    if (pitch !== 4) {
      fail("pitch", `ME-04-v1.jpg detected pitch ${pitch}, expected 4 — refusing to guess.`);
    }
    cells.push({ name: "menu-card", img: slicer.cropImage(quant, box) });
  }
  // Carousel controls (ME-05 five-up: two arrows plus three dots).
  {
    const { quant, box, pitch } = loadQuant("ME-05-v1.jpg");
    if (pitch !== 4) {
      fail("pitch", `ME-05-v1.jpg detected pitch ${pitch}, expected 4 — refusing to guess.`);
    }
    const parts = splitBox(quant, box, "x", 5, "ME-05-v1.jpg").map((cell, i) =>
      trimBox(cell, "ME-05-v1.jpg", `cell${i}`),
    );
    const arrows = [parts[0], parts[1]];
    const dots = [parts[2], parts[3], parts[4]];
    const arrowW = Math.max(...arrows.map((c) => c.w));
    const arrowH = Math.max(...arrows.map((c) => c.h));
    const dotW = Math.max(...dots.map((c) => c.w));
    const dotH = Math.max(...dots.map((c) => c.h));
    cells.push({ name: "menu-arrow-left", img: pad4(arrows[0], arrowW, arrowH) });
    cells.push({ name: "menu-arrow-right", img: pad4(arrows[1], arrowW, arrowH) });
    cells.push({ name: "menu-dot-on", img: pad4(dots[0], dotW, dotH) });
    cells.push({ name: "menu-dot-off", img: pad4(dots[1], dotW, dotH) });
    // The spare off dot must match the shipped one within a pixel
    // (JPEG wobble); a larger mismatch means the gutter split drifted.
    if (
      Math.abs(dots[2].w - dots[1].w) > 1 ||
      Math.abs(dots[2].h - dots[1].h) > 1
    ) {
      fail(
        "crop",
        `ME-05-v1.jpg spare dot is ${dots[2].w}x${dots[2].h}, expected ${dots[1].w}x${dots[1].h}.`,
      );
    }
  }
  // Tip plate patch (ME-06 explicit native dither crop).
  {
    const quant = loadNative("ME-06-v1.jpg");
    const rect = { x: 300, y: 200, w: 48, h: 48 };
    checkRect(quant, rect, "ME-06-v1.jpg", "tip patch");
    const patch = slicer.cropImage(quant, rect);
    // The patch must be pure two-tone dither (no nub cyan, no seams):
    // every pixel dark-navy or mid-navy, both present.
    let dark = 0;
    let mid = 0;
    let other = 0;
    for (let i = 0; i < patch.w * patch.h; i++) {
      const r = patch.rgba[i * 4];
      const g = patch.rgba[i * 4 + 1];
      const b = patch.rgba[i * 4 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (g > 150 && b > 180 && r < 120) {
        other += 1;
      } else if (lum < 30) {
        dark += 1;
      } else if (lum < 90) {
        mid += 1;
      } else {
        other += 1;
      }
    }
    if (other > 0 || dark === 0 || mid === 0) {
      fail(
        "crop",
        `ME-06-v1.jpg tip patch is not pure dither (dark=${dark} mid=${mid} other=${other}).`,
      );
    }
    cells.push({ name: "menu-tip", img: patch });
  }
  // Avatar plate + field plate (ME-07 explicit native crops).
  {
    const quant = loadNative("ME-07-v1.jpg");
    const avatarRect = { x: 42, y: 201, w: 150, h: 164 };
    const fieldRect = { x: 228, y: 252, w: 280, h: 64 };
    checkRect(quant, avatarRect, "ME-07-v1.jpg", "avatar");
    checkRect(quant, fieldRect, "ME-07-v1.jpg", "field");
    cells.push({ name: "menu-avatar", img: slicer.cropImage(quant, avatarRect) });
    cells.push({ name: "menu-field", img: slicer.cropImage(quant, fieldRect) });
  }
  return cells;
}

// Emit the menu kit into a ui dir: one PNG-8 per cell plus a JSON sidecar
// pinning names to pixel boxes (the stylesheets size from these boxes).
// Budget-gated like emitAssets: existing ui bytes plus the new PNGs must
// fit the cap. Returns the written summaries.
function sliceMenu(uiDir = DEFAULT_UI_DIR) {
  const cells = sliceCells();
  const files = cells.map((cell) => ({
    name: cell.name,
    file: `${cell.name}.png`,
    buf: slicer.encodePng8(cell.img),
    w: cell.img.w,
    h: cell.img.h,
  }));
  let current;
  try {
    current = slicer.sizeBytes(uiDir);
  } catch {
    current = 0;
  }
  for (const f of files) {
    try {
      if (fs.existsSync(path.join(uiDir, f.file))) {
        current -= fs.statSync(path.join(uiDir, f.file)).size;
      }
    } catch {
      // Stat failure: keep the conservative (larger) total.
    }
  }
  const added = files.reduce((a, f) => a + f.buf.length, 0);
  if (current + added > slicer.BUDGET_BYTES) {
    fail(
      "emit",
      `menu budget exceeded: ${current + added} bytes > ${slicer.BUDGET_BYTES} bytes — refusing to write.`,
    );
  }
  fs.mkdirSync(uiDir, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(uiDir, f.file), f.buf);
  }
  const manifest = {};
  for (const f of files) {
    manifest[f.name] = { file: `ui/${f.file}`, w: f.w, h: f.h };
  }
  fs.writeFileSync(path.join(uiDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return files;
}

if (require.main === module) {
  try {
    const dir = process.env.SLICE_MENU_UI_DIR || DEFAULT_UI_DIR;
    const written = sliceMenu(dir);
    for (const w of written) {
      console.log(`slice-menu: ${w.name} -> ${w.file} (${w.w}x${w.h})`);
    }
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

module.exports = { sliceMenu, sliceCells };
