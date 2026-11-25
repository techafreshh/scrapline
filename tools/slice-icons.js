// Icon slicer (issue #351, act A6): the icon act of the slice-sheet
// pipeline (issue #346). Turns the IC-* reference sheets in
// docs/ui-prompts/results/ into shippable 1x pixel-art PNG-8 assets under
// packages/client/assets/atlas/icons/ plus manifest/icons.json entries,
// plus the PWA app icons under packages/client/public/icons/.
//
// Stages mirror tools/slice-chrome.js (key, pitch detect, downscale,
// quantise, gutter-split, pad, PNG-8 encode); every stage is a pure
// exported helper and every failure throws (and the CLI prints)
// `slice-icons:<stage>: <detail>` with a nonzero exit. Zero dependencies
// (node:fs/path only).
//
// Chroma note: the IC JPEGs ship on flat #FF00FF, but JPEG chroma drift
// pushes some sheets (IC-02, IC-07) beyond the fixed slice-sheet
// tolerance of 24. This slicer samples the background from the four
// image corners (median per channel) and keys with tolerance 24 around
// the measured background, so the cut stays lossless without eating
// artwork. Pitch is still asserted at 4 for every sheet.
//
// Geometry (verified against the committed JPEGs):
// - IC-01 weapons: 3 rows (y-gutter split into 3); row 0 splits x into
//   3 (pistol, smg, rifle), row 1 into 2 (shotgun, sniper), row 2 into
//   2 (spare sniper, rocket). The spare duplicate sniper is refused
//   unless present and non-empty, then discarded; six weapons ship.
//   Each weapon pads to its own 4px box (widths vary 36..116px).
//   A simplified 16px silhouette set (flat #e8ecf4 + 1px #0b0f1a
//   outline) ships alongside as *-small for the kill feed.
// - IC-02 pickups: x-gutter split into 4 (health, grenade, shield,
//   ammo), padded to one common box.
// - IC-03 glyphs: 5x4 grid (global gutters, not per-row) into 20,
//   padded to one common box.
// - IC-04 challenges: 4x2 grid into 8, padded to one common box.
// - IC-05 cosmetics: 3x2 grid into 6; the bottom row ships (helmet,
//   visor, palette with three swatches per the prompt).
// - IC-06 rank: single badge bbox plus three procedural 8x8 star pips
//   (filled, outline, cracked).
// - IC-07 status: x-gutter split into 6, padded to one common box.
// - IC-08 app icon: single plate; 512 (any) via 2x upscale + pad and
//   192 maskable via 2x downscale + pad so the helmet stays inside the
//   central 80%.
const fs = require("node:fs");
const path = require("node:path");

const slicer = require("./slice-sheet.js");

const ROOT = path.join(__dirname, "..");
const RESULTS = path.join(ROOT, "docs", "ui-prompts", "results");
const DEFAULT_ATLAS_DIR = path.join(ROOT, "packages", "client", "assets", "atlas");
const DEFAULT_PUBLIC_ICONS = path.join(ROOT, "packages", "client", "public", "icons");

function fail(stage, detail) {
  throw new Error(`slice-icons:${stage}: ${detail}`);
}

// Sample the sheet background from the four corners (5x5 median per
// channel) and key with tolerance 24 around the measured color. JPEG
// chroma drift shifts #FF00FF by up to ~38 (IC-07), so a fixed key
// misses the background entirely; centering on the measured color
// keeps the cut lossless while the tolerance stays at the 24 contract.
function adaptiveKey(img) {
  const samples = [];
  const corners = [
    [5, 5],
    [img.w - 6, 5],
    [5, img.h - 6],
    [img.w - 6, img.h - 6],
  ];
  for (const [cx, cy] of corners) {
    for (let dy = 0; dy < 5; dy += 1) {
      for (let dx = 0; dx < 5; dx += 1) {
        const i = ((cy + dy) * img.w + cx + dx) * 4;
        samples.push([img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]);
      }
    }
  }
  const median = (vals) => {
    const sorted = vals.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const r = median(samples.map((s) => s[0]));
  const g = median(samples.map((s) => s[1]));
  const b = median(samples.map((s) => s[2]));
  const TOL = 24;
  const TOLSQ = TOL * TOL;
  const rgba = Buffer.from(img.rgba);
  for (let i = 0; i < img.w * img.h; i += 1) {
    const dr = rgba[i * 4] - r;
    const dg = rgba[i * 4 + 1] - g;
    const db = rgba[i * 4 + 2] - b;
    rgba[i * 4 + 3] = dr * dr + dg * dg + db * db <= TOLSQ ? 0 : 255;
  }
  return { w: img.w, h: img.h, rgba };
}

// Decode one result JPEG through the adaptive chroma pipeline and
// return the quantised image plus its opaque bounding box.
function loadQuant(source) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(RESULTS, source));
  } catch (err) {
    fail("decode", `cannot read ${source}: ${err.message}`);
  }
  const decoded = slicer.decodeImage(raw);
  const keyed = adaptiveKey(decoded);
  const eroded = slicer.erodeAlpha(keyed);
  let found;
  try {
    found = slicer.detectPitch(eroded);
  } catch (err) {
    fail("pitch", `${source}: ${err.message}`);
  }
  if (found.pitch !== 4) {
    fail("pitch", `${source} detected pitch ${found.pitch}, expected 4 — refusing to guess.`);
  }
  const down = slicer.downscaleNearest(eroded, found.pitch, found.phaseX, found.phaseY);
  const quant = slicer.quantiseNearest(down);
  let box;
  try {
    box = slicer.boundingBox(quant);
  } catch (err) {
    fail("crop", `${source}: ${err.message}`);
  }
  return { quant, box, pitch: found.pitch };
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

function segmentsFor(len, runs) {
  const segs = [];
  let prev = 0;
  for (const [a, b] of runs) {
    segs.push([prev, a - 1]);
    prev = b + 1;
  }
  segs.push([prev, len - 1]);
  return segs.filter(([a, b]) => b >= a);
}

// Split a box on its gutters into exactly `count` segments along `axis`.
function splitBox(img, box, axis, count, source) {
  const runs = gutterRuns(img, box, axis);
  const kept = segmentsFor(axis === "x" ? box.w : box.h, runs);
  if (kept.length !== count) {
    fail(
      "crop",
      `${source} splits into ${kept.length} ${axis} cells, expected ${count} (runs ${JSON.stringify(runs)}) — refusing to guess.`,
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

// Grid split on the global gutters: columns and rows measured once on
// the full box so narrow glyphs cannot shift the grid per row.
function gridSplit(img, box, cols, rows, source) {
  const xruns = gutterRuns(img, box, "x");
  const yruns = gutterRuns(img, box, "y");
  const xsegs = segmentsFor(box.w, xruns);
  const ysegs = segmentsFor(box.h, yruns);
  if (xsegs.length !== cols) {
    fail("crop", `${source} grid has ${xsegs.length} columns, expected ${cols} — refusing to guess.`);
  }
  if (ysegs.length !== rows) {
    fail("crop", `${source} grid has ${ysegs.length} rows, expected ${rows} — refusing to guess.`);
  }
  const cells = [];
  for (const [ya, yb] of ysegs) {
    for (const [xa, xb] of xsegs) {
      cells.push(
        slicer.cropImage(img, {
          x: box.x + xa,
          y: box.y + ya,
          w: xb - xa + 1,
          h: yb - ya + 1,
        }),
      );
    }
  }
  return cells;
}

// Trim an image to its own opaque bounding box.
function trimBox(img, source, label) {
  let box;
  try {
    box = slicer.boundingBox(img);
  } catch (err) {
    fail("crop", `${source} cell ${label} is fully transparent — refusing to emit.`);
  }
  return slicer.cropImage(img, box);
}

function ceil4(n) {
  return Math.ceil(n / 4) * 4;
}

function pad4(img, w, h) {
  return slicer.padCanvas(img, ceil4(w), ceil4(h), 0);
}

// Pad a group to one common box (max w/h rounded to 4px) so state and
// row swaps never shift layout.
function padGroup(imgs) {
  const maxW = Math.max(...imgs.map((c) => c.w));
  const maxH = Math.max(...imgs.map((c) => c.h));
  return imgs.map((img) => pad4(img, maxW, maxH));
}

// Nearest-neighbor resample to an explicit size (for the 16px weapon
// silhouettes and the app-icon scales).
function resampleNearest(img, tw, th) {
  if (!Number.isInteger(tw) || tw <= 0 || !Number.isInteger(th) || th <= 0) {
    fail("emit", `resample target ${tw}x${th} is unusable.`);
  }
  const rgba = Buffer.alloc(tw * th * 4, 0);
  for (let y = 0; y < th; y += 1) {
    const sy = Math.min(img.h - 1, Math.floor((y * img.h) / th));
    for (let x = 0; x < tw; x += 1) {
      const sx = Math.min(img.w - 1, Math.floor((x * img.w) / tw));
      const src = (sy * img.w + sx) * 4;
      const dst = (y * tw + x) * 4;
      rgba[dst] = img.rgba[src];
      rgba[dst + 1] = img.rgba[src + 1];
      rgba[dst + 2] = img.rgba[src + 2];
      rgba[dst + 3] = img.rgba[src + 3];
    }
  }
  return { w: tw, h: th, rgba };
}

// Simplified 16px weapon silhouette: fit the tight weapon inside 14x14
// (leaving a 1px outline margin in the 16x16 box), flatten to
// #e8ecf4, then paint a 1px #0b0f1a outline around the mask. Single
// flat fill plus outline per the IC-01 small-set spec so the kill feed
// stays readable under 20px.
function makeSmallSilhouette(img) {
  const scale = Math.min(14 / img.w, 14 / img.h);
  const tw = Math.max(1, Math.round(img.w * scale));
  const th = Math.max(1, Math.round(img.h * scale));
  const tiny = resampleNearest(img, tw, th);
  const out = { w: 16, h: 16, rgba: Buffer.alloc(16 * 16 * 4, 0) };
  const dx = Math.floor((16 - tw) / 2);
  const dy = Math.floor((16 - th) / 2);
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const a = tiny.rgba[(y * tw + x) * 4 + 3];
      if (a !== 0) {
        const dst = ((dy + y) * 16 + dx + x) * 4;
        out.rgba[dst] = 0xe8;
        out.rgba[dst + 1] = 0xec;
        out.rgba[dst + 2] = 0xf4;
        out.rgba[dst + 3] = 255;
      }
    }
  }
  // 1px outline: transparent 4-neighbors of the flat fill.
  const fill = Buffer.from(out.rgba);
  const isOpaque = (x, y) => {
    if (x < 0 || y < 0 || x >= 16 || y >= 16) {
      return false;
    }
    return fill[(y * 16 + x) * 4 + 3] !== 0;
  };
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if (!isOpaque(x, y) && (isOpaque(x - 1, y) || isOpaque(x + 1, y) || isOpaque(x, y - 1) || isOpaque(x, y + 1))) {
        const dst = (y * 16 + x) * 4;
        out.rgba[dst] = 0x0b;
        out.rgba[dst + 1] = 0x0f;
        out.rgba[dst + 2] = 0x1a;
        out.rgba[dst + 3] = 255;
      }
    }
  }
  return out;
}

// 8x8 star pip masks: filled, outline-only, and cracked (filled with a
// 2px #FF6B35 crack). Palette-locked (#eab308 fill, #e8ecf4 top
// highlight, #2a3550 outline, #FF6B35 crack) per the IC-06 spec.
const STAR_MASK = [
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 0, 0, 1, 1, 0],
  [0, 1, 1, 0, 0, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

function makeStarPip(variant) {
  if (variant !== "filled" && variant !== "outline" && variant !== "cracked") {
    fail("crop", `unknown star pip variant ${variant}.`);
  }
  const rgba = Buffer.alloc(8 * 8 * 4, 0);
  const set = (x, y, r, g, b) => {
    const i = (y * 8 + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  };
  const isStar = (x, y) => x >= 0 && y >= 0 && x < 8 && y < 8 && STAR_MASK[y][x] === 1;
  // Crack diagonal for the cracked variant (2px band).
  const isCrack = (x, y) => variant === "cracked" && x - y === 1 && y >= 2 && y <= 5;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (!isStar(x, y)) {
        // Outline variant: 1px #2a3550 rim around the mask.
        if (
          variant === "outline" &&
          (isStar(x - 1, y) || isStar(x + 1, y) || isStar(x, y - 1) || isStar(x, y + 1))
        ) {
          set(x, y, 0x2a, 0x35, 0x50);
        }
        continue;
      }
      if (variant === "outline") {
        // Outline-only: edge pixels paint, interior stays transparent.
        const edge =
          !isStar(x - 1, y) || !isStar(x + 1, y) || !isStar(x, y - 1) || !isStar(x, y + 1);
        if (edge) {
          set(x, y, 0x2a, 0x35, 0x50);
        }
        continue;
      }
      if (isCrack(x, y)) {
        set(x, y, 0xff, 0x6b, 0x35);
        continue;
      }
      // Filled (+ cracked base): gold with a pale top highlight.
      if (y <= 1 && x >= 2 && x <= 5) {
        set(x, y, 0xe8, 0xec, 0xf4);
      } else {
        set(x, y, 0xea, 0xb3, 0x08);
      }
    }
  }
  // 1px #0b0f1a outer stroke for the filled variants.
  if (variant !== "outline") {
    const fill = Buffer.from(rgba);
    const opaque = (x, y) => {
      if (x < 0 || y < 0 || x >= 8 || y >= 8) {
        return false;
      }
      return fill[(y * 8 + x) * 4 + 3] !== 0;
    };
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        if (!opaque(x, y) && (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1))) {
          set(x, y, 0x0b, 0x0f, 0x1a);
        }
      }
    }
  }
  return { w: 8, h: 8, rgba };
}

// Slice every icon sheet into { key, file, img } cells. Pure apart from
// reading the committed result JPEGs.
function sliceCells() {
  const cells = [];
  // IC-01 weapons: 3 rows, then per-row columns. Six ship; the spare
  // duplicate sniper must exist (guards model drift) and is discarded.
  {
    const { quant, box } = loadQuant("IC-01-weapons-v1.jpg");
    const rows = splitBox(quant, box, "y", 3, "IC-01-weapons-v1.jpg");
    const rowCells = rows.map((row, r) => {
      const want = r === 0 ? 3 : 2;
      const band = { x: 0, y: 0, w: row.w, h: row.h };
      return splitBox(row, band, "x", want, `IC-01-weapons-v1.jpg row${r}`);
    });
    if (rowCells[2].length !== 2) {
      fail("crop", "IC-01-weapons-v1.jpg bottom row must hold the spare plus the rocket.");
    }
    const trimmed = rowCells.flat().map((cell, i) => trimBox(cell, "IC-01-weapons-v1.jpg", `cell${i}`));
    // Order: pistol, smg, rifle, shotgun, sniper, spare, rocket.
    const names = [
      "weapon-pistol",
      "weapon-smg",
      "weapon-rifle",
      "weapon-shotgun",
      "weapon-sniper",
      "weapon-spare",
      "weapon-rocket",
    ];
    const full = trimmed.map((img, i) => ({ name: names[i], img: pad4(img, img.w, img.h) }));
    const keep = full.filter((c) => c.name !== "weapon-spare");
    if (keep.length !== 6) {
      fail("crop", "IC-01-weapons-v1.jpg must yield six shippable weapons after dropping the spare.");
    }
    for (const c of keep) {
      cells.push({ key: `icon.weapon.${c.name.slice("weapon-".length)}`, file: `icons/${c.name}.png`, img: c.img });
      cells.push({
        key: `icon.weapon.${c.name.slice("weapon-".length)}.small`,
        file: `icons/${c.name}-small.png`,
        img: makeSmallSilhouette(trimmed[names.indexOf(c.name)]),
      });
    }
  }
  // IC-02 pickups: four in a row.
  {
    const { quant, box } = loadQuant("IC-02-v1.jpg");
    const parts = splitBox(quant, box, "x", 4, "IC-02-v1.jpg").map((cell, i) =>
      trimBox(cell, "IC-02-v1.jpg", `cell${i}`),
    );
    const names = ["pickup-health", "pickup-grenade", "pickup-shield", "pickup-ammo"];
    const padded = padGroup(parts);
    padded.forEach((img, i) => {
      const short = names[i].slice("pickup-".length);
      cells.push({ key: `icon.pickup.${short}`, file: `icons/${names[i]}.png`, img });
    });
  }
  // IC-03 glyphs: 5x4 grid.
  {
    const { quant, box } = loadQuant("IC-03-v1.jpg");
    const parts = gridSplit(quant, box, 5, 4, "IC-03-v1.jpg").map((cell, i) =>
      trimBox(cell, "IC-03-v1.jpg", `cell${i}`),
    );
    const names = [
      "glyph-close",
      "glyph-chev-left",
      "glyph-chev-right",
      "glyph-chev-up",
      "glyph-chev-down",
      "glyph-check",
      "glyph-lock",
      "glyph-speaker",
      "glyph-note",
      "glyph-expand",
      "glyph-contract",
      "glyph-monitor",
      "glyph-rank-tag",
      "glyph-magnifier",
      "glyph-menu",
      "glyph-gamepad",
      "glyph-refresh",
      "glyph-clipboard",
      "glyph-star",
      "glyph-info",
    ];
    const padded = padGroup(parts);
    padded.forEach((img, i) => {
      const short = names[i].slice("glyph-".length);
      cells.push({ key: `icon.glyph.${short}`, file: `icons/${names[i]}.png`, img });
    });
  }
  // IC-04 challenges: 4x2 grid.
  {
    const { quant, box } = loadQuant("IC-04-v1.jpg");
    const parts = gridSplit(quant, box, 4, 2, "IC-04-v1.jpg").map((cell, i) =>
      trimBox(cell, "IC-04-v1.jpg", `cell${i}`),
    );
    const names = [
      "challenge-headshot",
      "challenge-streak",
      "challenge-jetpack",
      "challenge-trophy",
      "challenge-grenade-arc",
      "challenge-damage",
      "challenge-target",
      "challenge-stopwatch",
    ];
    const padded = padGroup(parts);
    padded.forEach((img, i) => {
      const short = names[i].slice("challenge-".length);
      cells.push({ key: `icon.challenge.${short}`, file: `icons/${names[i]}.png`, img });
    });
  }
  // IC-05 cosmetics: 3x2 grid, bottom row ships.
  {
    const { quant, box } = loadQuant("IC-05-v1.jpg");
    const parts = gridSplit(quant, box, 3, 2, "IC-05-v1.jpg").map((cell, i) =>
      trimBox(cell, "IC-05-v1.jpg", `cell${i}`),
    );
    const bottom = [parts[3], parts[4], parts[5]];
    const names = ["cosmetic-helmet", "cosmetic-visor", "cosmetic-palette"];
    const padded = padGroup(bottom);
    padded.forEach((img, i) => {
      const short = names[i].slice("cosmetic-".length);
      cells.push({ key: `icon.cosmetic.${short}`, file: `icons/${names[i]}.png`, img });
    });
  }
  // IC-06 rank badge plus procedural star pips.
  {
    const { quant, box } = loadQuant("IC-06-v1.jpg");
    const badge = pad4(trimBox(slicer.cropImage(quant, box), "IC-06-v1.jpg", "badge"), box.w, box.h);
    cells.push({ key: "icon.rank.badge", file: "icons/rank-badge.png", img: badge });
    cells.push({ key: "icon.rank.star-filled", file: "icons/rank-star-filled.png", img: makeStarPip("filled") });
    cells.push({ key: "icon.rank.star-outline", file: "icons/rank-star-outline.png", img: makeStarPip("outline") });
    cells.push({ key: "icon.rank.star-cracked", file: "icons/rank-star-cracked.png", img: makeStarPip("cracked") });
  }
  // IC-07 status: six in a row.
  {
    const { quant, box } = loadQuant("IC-07-v1.jpg");
    const parts = splitBox(quant, box, "x", 6, "IC-07-v1.jpg").map((cell, i) =>
      trimBox(cell, "IC-07-v1.jpg", `cell${i}`),
    );
    const names = [
      "status-skull",
      "status-shield-check",
      "status-bolt",
      "status-shield-broken",
      "status-crown",
      "status-crosshair",
    ];
    const padded = padGroup(parts);
    padded.forEach((img, i) => {
      const short = names[i].slice("status-".length);
      cells.push({ key: `icon.status.${short}`, file: `icons/${names[i]}.png`, img });
    });
  }
  return cells;
}

// App icons from the IC-08 plate: 512 (any) via 2x upscale + pad, 192
// maskable via 2x downscale + pad so the helmet stays inside the
// central 80% (118/192 = 61%).
function sliceAppIcons() {
  const { quant, box } = loadQuant("IC-08-v1.jpg");
  const plate = trimBox(slicer.cropImage(quant, box), "IC-08-v1.jpg", "plate");
  const big = resampleNearest(plate, plate.w * 2, plate.h * 2);
  const bigPadded = slicer.padCanvas(big, 512, 512, 0);
  const smallW = Math.max(1, Math.floor(plate.w / 2));
  const smallH = Math.max(1, Math.floor(plate.h / 2));
  const small = resampleNearest(plate, smallW, smallH);
  const smallPadded = slicer.padCanvas(small, 192, 192, 0);
  // Maskable guard: art must stay inside the central 80% (153px of 192).
  if (small.w > 154 || small.h > 154) {
    fail("crop", `IC-08 maskable art is ${small.w}x${small.h}, must fit 154x154 for the 80% safe area.`);
  }
  return [
    { name: "icon-512", w: 512, h: 512, img: bigPadded },
    { name: "icon-192-maskable", w: 192, h: 192, img: smallPadded },
  ];
}

// Emit the icon kit into an atlas dir: one PNG-8 per cell plus manifest
// and icons.json frame entries. Budget-gated like emitAssets. Returns
// the written asset summaries.
function sliceIcons(atlasDir = DEFAULT_ATLAS_DIR, publicIconsDir = DEFAULT_PUBLIC_ICONS) {
  const cells = sliceCells();
  const files = cells.map((cell) => ({
    key: cell.key,
    file: cell.file,
    buf: slicer.encodePng8(cell.img),
    w: cell.img.w,
    h: cell.img.h,
  }));
  let current = 0;
  try {
    current = slicer.sizeBytes(atlasDir);
  } catch {
    current = 0;
  }
  for (const f of files) {
    try {
      if (fs.existsSync(path.join(atlasDir, f.file))) {
        current -= fs.statSync(path.join(atlasDir, f.file)).size;
      }
    } catch {
      // Stat failure: keep the conservative (larger) total.
    }
  }
  const added = files.reduce((a, f) => a + f.buf.length, 0);
  if (current + added > slicer.BUDGET_BYTES) {
    fail(
      "emit",
      `icon budget exceeded: ${current + added} bytes > ${slicer.BUDGET_BYTES} bytes — refusing to write.`,
    );
  }
  fs.mkdirSync(path.join(atlasDir, "icons"), { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(atlasDir, f.file), f.buf);
  }
  const manifestPath = path.join(atlasDir, "manifest.json");
  let manifest = {};
  try {
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
        fail("emit", `${manifestPath} does not hold a JSON object — refusing to merge.`);
      }
    }
  } catch (err) {
    if (err && typeof err.message === "string" && err.message.startsWith("slice-icons:")) {
      throw err;
    }
    fail("emit", `cannot parse ${manifestPath}: ${err.message}`);
  }
  for (const f of files) {
    manifest[f.key] = { file: f.file, atlas: "icons.json", w: f.w, h: f.h };
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const atlasPath = path.join(atlasDir, "icons.json");
  let atlas = { meta: { app: "scrapline", version: 1, family: "icons" }, frames: {} };
  try {
    if (fs.existsSync(atlasPath)) {
      atlas = JSON.parse(fs.readFileSync(atlasPath, "utf8"));
      if (atlas.frames === null || typeof atlas.frames !== "object" || Array.isArray(atlas.frames)) {
        fail("emit", `${atlasPath} has no frames object — refusing to merge.`);
      }
    }
  } catch (err) {
    if (err && typeof err.message === "string" && err.message.startsWith("slice-icons:")) {
      throw err;
    }
    fail("emit", `cannot parse ${atlasPath}: ${err.message}`);
  }
  for (const f of files) {
    atlas.frames[f.key] = { file: f.file, x: 0, y: 0, w: f.w, h: f.h };
  }
  fs.writeFileSync(atlasPath, `${JSON.stringify(atlas, null, 2)}\n`);

  // App icons: PNG-8 into the public icons dir (served at /icons/*).
  const apps = sliceAppIcons();
  fs.mkdirSync(publicIconsDir, { recursive: true });
  const appFiles = [];
  for (const app of apps) {
    const buf = slicer.encodePng8(app.img);
    const file = `${app.name}.png`;
    fs.writeFileSync(path.join(publicIconsDir, file), buf);
    appFiles.push({ key: app.name, file, w: app.w, h: app.h, bytes: buf.length });
  }
  return { icons: files.map((f) => ({ key: f.key, file: f.file, w: f.w, h: f.h })), apps: appFiles };
}

if (require.main === module) {
  try {
    const atlasDir = process.env.SLICE_ICONS_ATLAS_DIR || DEFAULT_ATLAS_DIR;
    const publicDir = process.env.SLICE_ICONS_PUBLIC_DIR || DEFAULT_PUBLIC_ICONS;
    const written = sliceIcons(atlasDir, publicDir);
    for (const w of written.icons) {
      console.log(`slice-icons: ${w.key} -> ${w.file} (${w.w}x${w.h})`);
    }
    for (const w of written.apps) {
      console.log(`slice-icons: ${w.key} -> ${w.file} (${w.w}x${w.h})`);
    }
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

module.exports = { sliceIcons, sliceCells, sliceAppIcons, makeSmallSilhouette, makeStarPip, adaptiveKey };
