// Chrome slicer driver (issue #347, act A2): the second act of the
// slice-sheet pipeline (issue #346). Turns the curated chrome sources in
// docs/ui-prompts/results/ into shippable 1x pixel-art PNG-8 assets plus
// manifest/atlas entries: key -> pitch -> downscale -> quantise ->
// gap-split -> pad -> emit. Every stage reuses the pure slice-sheet
// helpers (chroma key, pitch detect, quantise, crop, pad, PNG-8 encode)
// so the kit inherits the palette lock, the 6 MB budget gate, and the
// dependency-free build; this file only owns the per-source split plan.
//
// Split rule: pieces separate on fully-transparent gutters (the sheets
// ship isolated objects on flat chroma, so the keyed alpha carries real
// zero runs between cells). A source whose cells touch is refused loudly
// naming the source and the expected count, exactly like the slice-sheet
// stage errors. Multi-cell groups normalise to one common canvas
// (rounded up to a multiple of 4px) so state swaps never shift layout:
// idle and hover share one box by construction.
//
// Naming: manifest keys use the issue vocabulary directly (ui.panel,
// ui.button.hover, ui.bar.track, ...) so probes and the chrome sync test
// read them without a translation table. The five legacy keys (ui.panel,
// ui.button, ui.button.hover, ui.slot, ui.bar) keep their names and only
// change files; ui.slot aliases the inset well and ui.bar aliases the
// bar fill, patched after emit. SH-01a (the curated 12-piece primary)
// ships as ui.sh-01a.00..11 alongside the CH singles. SH-01 is skipped
// on purpose: its pieces lack separating gutters (single 2px runs with
// otherwise adjacent art), so gap-splitting cannot separate it without
// guessing; SH-01a plus the CH singles cover the whole required kit.
//
// Zero dependencies (node:fs/path only). Invoked two ways: directly to
// commit the kit (`node tools/slice-chrome.js`), and from
// tools/build-atlas.js after the vendor phase so every build
// regenerates the identical bytes (deterministic palette order plus
// fixed deflate settings make output byte-stable).
const fs = require("node:fs");
const path = require("node:path");

const slicer = require("./slice-sheet.js");

const ROOT = path.join(__dirname, "..");
const RESULTS = path.join(ROOT, "docs", "ui-prompts", "results");
const DEFAULT_ATLAS_DIR = path.join(ROOT, "packages", "client", "assets", "atlas");

// Five stretched 16x16 tiles this kit replaces (kept in the vendor
// allowlist output, deleted here after the manifest overwrite).
const STALE_TILES = [
  "ui/tile_0000.png",
  "ui/tile_0001.png",
  "ui/tile_0002.png",
  "ui/tile_0003.png",
  "ui/tile_0004.png",
];

function fail(stage, detail) {
  throw new Error(`slice-chrome:${stage}: ${detail}`);
}

// Decode one result JPEG/PNG through the full single-asset pipeline and
// return the quantised image plus its opaque bounding box.
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

// Zero-alpha runs along one axis of a box: the cell gutters.
function gutterRuns(quant, box, axis) {
  const runs = [];
  const len = axis === "x" ? box.w : box.h;
  const isEmpty = (i) => {
    if (axis === "x") {
      for (let cy = 0; cy < box.h; cy += 1) {
        if (quant.rgba[((box.y + cy) * quant.w + box.x + i) * 4 + 3] !== 0) {
          return false;
        }
      }
      return true;
    }
    for (let cx = 0; cx < box.w; cx += 1) {
      if (quant.rgba[((box.y + i) * quant.w + box.x + cx) * 4 + 3] !== 0) {
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
// Refuses loudly when the gutter count disagrees with the plan.
function splitBox(quant, box, axis, count, source) {
  const runs = gutterRuns(quant, box, axis);
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
    return slicer.cropImage(quant, rect);
  });
}

// Round up to a multiple of 4px (the 9-slice slices below are all
// multiples of 4, and pixelated backgrounds only ever scale by ints).
function ceil4(n) {
  return Math.ceil(n / 4) * 4;
}

// Pad one cell to w/h centred (never scales).
function pad4(img, w, h) {
  return slicer.padCanvas(img, ceil4(w), ceil4(h), 0);
}

// Pad a split group to its common max canvas (rounded to 4px).
function padGroup(cells) {
  const w = Math.max(...cells.map((c) => c.w));
  const h = Math.max(...cells.map((c) => c.h));
  return cells.map((c) => pad4(c, w, h));
}

// Centre crop of w/h out of an image (the knob/thumb extractions).
function centerCrop(img, w, h, source) {
  if (w > img.w || h > img.h) {
    fail("crop", `${source} ${img.w}x${img.h} cannot yield a ${w}x${h} crop.`);
  }
  const x = Math.floor((img.w - w) / 2);
  const y = Math.floor((img.h - h) / 2);
  return slicer.cropImage(img, { x, y, w, h });
}

// One slice plan entry: source file plus a splitter returning labelled
// quantised cells in manifest order.
function single(source) {
  return () => {
    const { quant, box } = loadQuant(source);
    return [{ suffix: "", img: pad4(slicer.cropImage(quant, box), box.w, box.h) }];
  };
}

const PLAN = [
  // Panel base (CH-01 single plate).
  { id: "panel", source: "CH-01-v1.jpg", run: single("CH-01-v1.jpg") },
  // Panel variants: elevated, inset well, hazard (CH-02 three-up).
  {
    id: "panel",
    source: "CH-02-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-02-v1.jpg");
      const cells = padGroup(splitBox(quant, box, "x", 3, "CH-02-v1.jpg"));
      const names = ["elevated", "inset", "hazard"];
      return cells.map((img, i) => ({ suffix: names[i], img }));
    },
  },
  // Banner plate (CH-03 large single plate, ships as the wide panel).
  {
    id: "panel",
    source: "CH-03-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-03-v1.jpg");
      return [{ suffix: "banner", img: pad4(slicer.cropImage(quant, box), box.w, box.h) }];
    },
  },
  // Button states (SH-04 six-state strip, 2 cols x 3 rows, prompt order
  // idle/hover/pressed/focus/disabled/danger). One strip means one
  // silhouette, so state swaps change lighting only, never the box.
  {
    id: "button",
    source: "SH-04-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("SH-04-v1.jpg");
      const rows = splitBox(quant, box, "y", 3, "SH-04-v1.jpg");
      const names = [
        ["", "hover"],
        ["pressed", "focus"],
        ["disabled", "danger"],
      ];
      const cells = [];
      rows.forEach((rowImg, r) => {
        // Re-split this band's columns: gutters span the full sheet,
        // but splitting per band keeps each knob centred on its own box.
        const band = { x: 0, y: 0, w: rowImg.w, h: rowImg.h };
        const cols = splitBox(rowImg, band, "x", 2, "SH-04-v1.jpg");
        cols.forEach((img, c) => cells.push({ suffix: names[r][c], img }));
      });
      const maxW = Math.max(...cells.map((c) => c.img.w));
      const maxH = Math.max(...cells.map((c) => c.img.h));
      return cells.map((c) => ({ suffix: c.suffix, img: pad4(c.img, maxW, maxH) }));
    },
  },
  // Primary CTA (CH-04 single plate; hover is a CSS glow over the same
  // silhouette, so the hero never shifts).
  { id: "button", source: "CH-04-v1.jpg", extra: "cta", run: single("CH-04-v1.jpg") },
  // Secondary button (CH-06 recessed row plate).
  { id: "button", source: "CH-06-v1.jpg", extra: "secondary", run: single("CH-06-v1.jpg") },
  // Icon button frame (CH-05 square plate; glyphs come from the icon set).
  { id: "button", source: "CH-05-v1.jpg", extra: "icon", run: single("CH-05-v1.jpg") },
  // Chip (CH-07 single pill; accent nub variants tint in CSS).
  { id: "chip", source: "CH-07-v1.jpg", run: single("CH-07-v1.jpg") },
  // Bar track plus fill (CH-08 two-up: track above, fill below).
  {
    id: "bar",
    source: "CH-08-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-08-v1.jpg");
      const cells = padGroup(splitBox(quant, box, "y", 2, "CH-08-v1.jpg"));
      return [
        { suffix: "track", img: cells[0] },
        { suffix: "fill", img: cells[1] },
      ];
    },
  },
  // Slider groove plus thumb (CH-09 assembled slider; the thumb is the
  // centred knob crop of the same plate, so both share one palette).
  {
    id: "slider",
    source: "CH-09-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-09-v1.jpg");
      const full = slicer.cropImage(quant, box);
      return [
        { suffix: "track", img: pad4(full, box.w, box.h) },
        { suffix: "thumb", img: centerCrop(full, 48, 48, "CH-09-v1.jpg") },
      ];
    },
  },
  // Toggle off/on (CH-10 two-up).
  {
    id: "toggle",
    source: "CH-10-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-10-v1.jpg");
      const cells = padGroup(splitBox(quant, box, "x", 2, "CH-10-v1.jpg"));
      return [
        { suffix: "off", img: cells[0] },
        { suffix: "on", img: cells[1] },
      ];
    },
  },
  // Checkbox empty/hover/checked (CH-11 three-up).
  {
    id: "checkbox",
    source: "CH-11-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-11-v1.jpg");
      const cells = padGroup(splitBox(quant, box, "x", 3, "CH-11-v1.jpg"));
      return [
        { suffix: "", img: cells[0] },
        { suffix: "hover", img: cells[1] },
        { suffix: "checked", img: cells[2] },
      ];
    },
  },
  // Text field plus select (CH-12 single recessed plate; the select
  // variant shares the plate while CSS draws the chevron cavity).
  {
    id: "field",
    source: "CH-12-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-12-v1.jpg");
      const plate = pad4(slicer.cropImage(quant, box), box.w, box.h);
      return [
        { suffix: "", img: plate },
        { suffix: "select", img: plate },
      ];
    },
  },
  // Scrollbar (CH-13 single recessed track with thumb).
  { id: "scrollbar", source: "CH-13-v1.jpg", run: single("CH-13-v1.jpg") },
  // List rows default/hover/selected (CH-14 three-up).
  {
    id: "row",
    source: "CH-14-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-14-v1.jpg");
      const cells = padGroup(splitBox(quant, box, "y", 3, "CH-14-v1.jpg"));
      return [
        { suffix: "", img: cells[0] },
        { suffix: "hover", img: cells[1] },
        { suffix: "selected", img: cells[2] },
      ];
    },
  },
  // Keycap (CH-15 single cap; sparse art detects a coarse pitch, which
  // the pipeline measures directly instead of forcing 4px).
  { id: "keycap", source: "CH-15-v1.jpg", run: single("CH-15-v1.jpg") },
  // Divider, corner bracket, header strip (CH-16: rule above, bracket
  // plus header side by side below).
  {
    id: "ornaments",
    source: "CH-16-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("CH-16-v1.jpg");
      const [top, bottom] = splitBox(quant, box, "y", 2, "CH-16-v1.jpg");
      const band = { x: 0, y: 0, w: bottom.w, h: bottom.h };
      const [left, right] = splitBox(bottom, band, "x", 2, "CH-16-v1.jpg");
      return [
        { id: "divider", suffix: "", img: pad4(top, top.w, top.h) },
        { id: "bracket", suffix: "", img: pad4(left, left.w, left.h) },
        { id: "header", suffix: "", img: pad4(right, right.w, right.h) },
      ];
    },
  },
  // Tooltip bubble (CH-17 single with tail).
  { id: "tooltip", source: "CH-17-v1.jpg", run: single("CH-17-v1.jpg") },
  // Toast strip (CH-18 single with status block).
  { id: "toast", source: "CH-18-v1.jpg", run: single("CH-18-v1.jpg") },
  // Curated primary kit (SH-01a 12 cells, 3 cols x 4 rows via gutters).
  {
    id: "sh-01a",
    source: "SH-01a-chrome-v1.jpg",
    run: () => {
      const { quant, box } = loadQuant("SH-01a-chrome-v1.jpg");
      const rows = splitBox(quant, box, "y", 4, "SH-01a-chrome-v1.jpg");
      const out = [];
      rows.forEach((rowImg) => {
        const band = { x: 0, y: 0, w: rowImg.w, h: rowImg.h };
        for (const cell of splitBox(rowImg, band, "x", 3, "SH-01a-chrome-v1.jpg")) {
          out.push(cell);
        }
      });
      return out.map((img, i) => ({
        suffix: String(i).padStart(2, "0"),
        img: pad4(img, img.w, img.h),
      }));
    },
  },
];

// Slice every plan entry into { id, suffix, img } cells. Pure apart from
// reading the committed result JPEGs.
function sliceCells() {
  const cells = [];
  for (const entry of PLAN) {
    const parts = entry.run();
    for (const part of parts) {
      cells.push({
        id: part.id || entry.id,
        // Single-plate extras (cta/secondary/icon) reuse the shared
        // single() runner and carry their suffix on the plan entry.
        suffix: part.suffix || entry.extra || "",
        img: part.img,
        source: entry.source,
      });
    }
  }
  return cells;
}

// Emit the kit into an atlas dir: one emitAssets call per id group (the
// helper names files ui.<id>[.<suffix>].png), then alias the two legacy
// housing keys onto their new art and drop the replaced 16x16 tiles.
// Returns the written asset summaries.
function sliceChrome(atlasDir = DEFAULT_ATLAS_DIR) {
  const byId = new Map();
  for (const cell of sliceCells()) {
    if (!byId.has(cell.id)) {
      byId.set(cell.id, []);
    }
    byId.get(cell.id).push({ suffix: cell.suffix, img: cell.img });
  }
  // Deterministic id order: plan order, then alphabetical overflow.
  const ordered = [...byId.entries()].sort(([a], [b]) => {
    const order = PLAN.map((p) => p.id);
    return order.indexOf(a) - order.indexOf(b);
  });
  const written = [];
  for (const [id, items] of ordered) {
    // The field select shares its plate: same bytes, distinct file, so
    // each key owns a file while the manifest pins both (the sync test
    // compares file fields, never bytes).
    const emitted = slicer.emitAssets({ id, items, atlasDir });
    written.push(...emitted);
  }
  // Legacy housing aliases: ui.slot is the inset well, ui.bar is the bar
  // fill (the key historically names the fill, not the housing).
  const manifestPath = path.join(atlasDir, "manifest.json");
  const atlasPath = path.join(atlasDir, "ui.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const atlas = JSON.parse(fs.readFileSync(atlasPath, "utf8"));
  for (const [alias, target] of [
    ["ui.slot", "ui.panel.inset"],
    ["ui.bar", "ui.bar.fill"],
  ]) {
    if (!manifest[target]) {
      fail("emit", `alias target ${target} missing from the manifest.`);
    }
    manifest[alias] = { ...manifest[target] };
    if (atlas.frames && atlas.frames[target]) {
      atlas.frames[alias] = { ...atlas.frames[target] };
    }
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(atlasPath, `${JSON.stringify(atlas, null, 2)}\n`);
  // Drop the five replaced stretched tiles so no surface can fall back.
  // build-atlas recopies them every vendor phase; this step runs after
  // it, so the tree (and the staged dist copy) stays replaced.
  for (const stale of STALE_TILES) {
    try {
      fs.rmSync(path.join(atlasDir, stale), { force: true });
    } catch {
      // Already absent: the manifest overwrite above already replaced it.
    }
  }
  return written;
}

if (require.main === module) {
  try {
    const dir = process.env.SLICE_CHROME_ATLAS_DIR || DEFAULT_ATLAS_DIR;
    const written = sliceChrome(dir);
    for (const w of written) {
      console.log(`slice-chrome: ${w.key} -> ${w.file} (${w.w}x${w.h})`);
    }
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

module.exports = { sliceChrome, sliceCells, PLAN, STALE_TILES };
