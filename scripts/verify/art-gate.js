// Art gate helpers (issue #352, act A7): offline checks proving the shipped
// visual layer matches its art direction. The atlas phase parses the
// committed `ui/*.png` + `icons/*.png` file literals out of
// packages/client/src/ui/chrome.ts (CHROME_FILES) and
// packages/client/src/ui/icons.ts (ICON_FILES), bans the legacy
// `ui/tile_*` files (a reverted key fails here, pre-browser), and asserts
// every plate exists under packages/client/assets/atlas/, decodes via the
// vendored decodePng from tools/slice-sheet.js, and is non-blank (more than
// one distinct RGB triplet over all pixels). The comparison phase scores each of the
// 16 captures against its view mockup in docs/ui-prompts/results/ with a
// coarse structural metric — both images area-average down to a 32x18
// luminance grid plus 3x2 region means, and the score is
// max(cellMeanAbs, regionMeanAbs) on a 0-255 scale — failing above the
// ART_THRESHOLD of 60. Coarse on purpose: the mockups are AI art with
// invented text and backdrops, so pixel equality can never pass. Non-blank
// means more than one distinct RGB triplet over all pixels: transparent
// pixels vote their stored RGB, so a single-stroke outline glyph on
// transparency (one visible colour plus its transparent ground) passes
// while a truly flat fill — the blank-plate failure mode — fails. Pure CJS
// with no new dependencies (slice-sheet reuse only); required by
// scripts/verify-ui.js, unit-tested by tests/art-gate.test.js.
const fs = require("node:fs");
const path = require("node:path");
const { decodePng, decodeImage } = require("../../tools/slice-sheet");

const HERE = __dirname;
const ROOT = path.join(HERE, "..", "..");
const CHROME_TS = path.join(ROOT, "packages", "client", "src", "ui", "chrome.ts");
const ICONS_TS = path.join(ROOT, "packages", "client", "src", "ui", "icons.ts");
const ATLAS_DIR = path.join(ROOT, "packages", "client", "assets", "atlas");
const RESULTS_DIR = path.join(ROOT, "docs", "ui-prompts", "results");

// Coarse structural grid: 32x18 cells plus 3x2 region means.
const GRID_W = 32;
const GRID_H = 18;
// Score ceiling on the 0-255 mean-absolute-difference scale. Calibrated
// against the current captures (worst real view scores ~53, margin ~7),
// so a blank or flat frame fails by a wide margin while legitimate views
// pass.
const ART_THRESHOLD = 60;

// One mockup per PRD view; after-menu-return reuses the menu mockup (no
// dedicated mockup exists).
const VIEW_MOCKUPS = {
  menu: "ME-01-menu-v1.jpg",
  setup: "SC-02-v1.jpg",
  "how-to": "SC-04-v1.jpg",
  challenges: "SC-05-v1.jpg",
  locker: "SC-06-v1.jpg",
  "midmatch-hud": "HU-01-hud-v1.jpg",
  "end-screen": "SC-07-end-screen-v1.jpg",
  "after-menu-return": "ME-01-menu-v1.jpg",
};

function fail(message) {
  throw new Error(message);
}

/**
 * Parse `[KEY]: "ui/….png"` / `[KEY]: "icons/….png"` entries out of a
 * CHROME_FILES / ICON_FILES source text. Returns [{ key, file }] in
 * source order; the entry shape (brackets, colon, quoted path) keeps
 * template URLs and bare mentions out of the match.
 */
function parseFileEntries(source) {
  const entries = [];
  const re = /\[([^\]]+)\]\s*:\s*"(ui\/[^"]+\.png|icons\/[^"]+\.png)"/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    entries.push({ key: match[1].trim(), file: match[2] });
  }
  return entries;
}

/**
 * Chrome + icon file sets from the committed sources. Pure reads, no
 * decode; optional source overrides exist for unit tests.
 */
function chromeIconFiles(chromeSrc, iconsSrc) {
  const chromeText = chromeSrc !== undefined ? chromeSrc : fs.readFileSync(CHROME_TS, "utf8");
  const iconsText = iconsSrc !== undefined ? iconsSrc : fs.readFileSync(ICONS_TS, "utf8");
  return [
    ...parseFileEntries(chromeText).map((entry) => ({ ...entry, set: "chrome" })),
    ...parseFileEntries(iconsText).map((entry) => ({ ...entry, set: "icon" })),
  ];
}

/**
 * Count distinct RGB triplets over every pixel, ignoring alpha.
 * Transparent pixels vote their stored RGB (palette index 0 for the
 * repo's PNG-8 plates), so a single-stroke outline glyph on transparency
 * counts two while a flat fill counts one. Pure.
 */
function distinctRgb(img) {
  const seen = new Set();
  for (let i = 0; i < img.w * img.h; i += 1) {
    seen.add((img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2]);
    if (seen.size > 1) {
      return seen.size;
    }
  }
  return seen.size;
}

/**
 * Non-blank proof: a uniform-colour plate (a single RGB triplet across
 * every pixel — tiny 8x8 glyphs legitimately hold only 2-3 colours, so
 * the bar is exactly "uniform", nothing stricter) fails naming label.
 */
function assertNonBlank(img, label) {
  if (distinctRgb(img) <= 1) {
    fail(`art: ${label} is a uniform-colour image — blank atlas plate`);
  }
}

/**
 * Atlas gate: every chrome/icon key resolves under ui/ or icons/ (never
 * the legacy ui/tile_* files a revert would restore), exists under the
 * atlas dir, decodes as PNG, and is non-blank. The prefix ban runs
 * before any fs read so a reverted key fails fast with no browser.
 * Returns the checked entry count. Optional overrides exist for tests.
 */
function assertAtlasGate({ entries, atlasDir } = {}) {
  const list = entries !== undefined ? entries : chromeIconFiles();
  const dir = atlasDir !== undefined ? atlasDir : ATLAS_DIR;
  if (list.length === 0) {
    fail("art: no chrome/icon file entries parsed from chrome.ts / icons.ts");
  }
  for (const entry of list) {
    if (/(^|\/)ui\/tile_/.test(entry.file)) {
      fail(
        `art: ${entry.key} points at legacy tile ${entry.file} — reverted chrome key, expected a sliced ui/*.png or icons/*.png plate`,
      );
    }
  }
  for (const entry of list) {
    const abs = path.join(dir, entry.file);
    let buf = null;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      fail(`art: ${entry.key} atlas file missing: ${entry.file}`);
    }
    let img = null;
    try {
      img = decodePng(buf);
    } catch (err) {
      fail(`art: ${entry.key} atlas file undecodable: ${entry.file} (${err && err.message ? err.message : err})`);
    }
    assertNonBlank(img, `${entry.key} (${entry.file})`);
  }
  return list.length;
}

/**
 * Area-averaged luminance grid (GRID_W x GRID_H): every source pixel
 * votes its Rec.709 luminance into one cell. Pure.
 */
function luminanceGrid(img) {
  const grid = new Float64Array(GRID_W * GRID_H);
  const counts = new Float64Array(GRID_W * GRID_H);
  let total = 0;
  for (let y = 0; y < img.h; y += 1) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / img.h));
    for (let x = 0; x < img.w; x += 1) {
      const gx = Math.min(GRID_W - 1, Math.floor((x * GRID_W) / img.w));
      const i = (y * img.w + x) * 4;
      const lum = 0.2126 * img.rgba[i] + 0.7152 * img.rgba[i + 1] + 0.0722 * img.rgba[i + 2];
      grid[gy * GRID_W + gx] += lum;
      counts[gy * GRID_W + gx] += 1;
      total += lum;
    }
  }
  // Cells no source pixel lands in (only possible for images smaller
  // than the grid, i.e. unit fixtures) read the global mean so the
  // grid never carries NaN — NaN must never slip past the threshold.
  const mean = total / (img.w * img.h);
  for (let i = 0; i < grid.length; i += 1) {
    grid[i] = counts[i] > 0 ? grid[i] / counts[i] : mean;
  }
  return grid;
}

/**
 * Structural score between two luminance grids: max(cellMeanAbs,
 * regionMeanAbs) on the 0-255 scale, where regionMeanAbs is the worst of
 * the 3x2 region means. The region term amplifies top-band drift (top
 * regions shift while the whole-frame mean dilutes it), reinforcing the
 * title asserts that catch title clipping. Pure.
 */
function artScore(a, b) {
  if (a.length !== GRID_W * GRID_H || b.length !== GRID_W * GRID_H) {
    fail(`art: grids must each hold ${GRID_W * GRID_H} cells`);
  }
  let cellSum = 0;
  for (let i = 0; i < a.length; i += 1) {
    cellSum += Math.abs(a[i] - b[i]);
  }
  const cellMean = cellSum / a.length;
  let regionMax = 0;
  for (let ry = 0; ry < 2; ry += 1) {
    for (let rx = 0; rx < 3; rx += 1) {
      let sum = 0;
      let n = 0;
      for (let y = 0; y < GRID_H; y += 1) {
        for (let x = 0; x < GRID_W; x += 1) {
          if (Math.floor((x * 3) / GRID_W) === rx && Math.floor((y * 2) / GRID_H) === ry) {
            sum += Math.abs(a[y * GRID_W + x] - b[y * GRID_W + x]);
            n += 1;
          }
        }
      }
      const mean = sum / n;
      if (mean > regionMax) {
        regionMax = mean;
      }
    }
  }
  return Math.max(cellMean, regionMax);
}

/**
 * Capture-vs-mockup proof: decode the PNG capture plus the mockup
 * (JPEG on disk; decodeImage dispatches so PNG fixtures work in tests —
 * any decode failure names the file, never skips) and fail above
 * ART_THRESHOLD naming the view and its diff. Returns the diff.
 */
function assertCaptureVsMockup(captureBuf, mockupBuf, view) {
  let capture = null;
  try {
    capture = decodePng(captureBuf);
  } catch (err) {
    fail(`art: ${view} capture undecodable (${err && err.message ? err.message : err})`);
  }
  const mockupName =
    VIEW_MOCKUPS[view] || VIEW_MOCKUPS[String(view).replace(/-\d+x\d+$/, "")] || view;
  let mockup = null;
  try {
    mockup = decodeImage(mockupBuf);
  } catch (err) {
    fail(`art: ${view} mockup ${mockupName} undecodable (${err && err.message ? err.message : err})`);
  }
  const diff = artScore(luminanceGrid(capture), luminanceGrid(mockup));
  if (!Number.isFinite(diff) || diff > ART_THRESHOLD) {
    fail(
      `art: ${view} drifts from mockup ${mockupName} (diff=${diff.toFixed(1)} > ${ART_THRESHOLD}) — tiling or layout regression`,
    );
  }
  return diff;
}

// Guarded so tests can require the pure helpers without running the
// gate (the tools/slice-sheet.js require.main idiom); run directly it
// proves the committed atlas offline, no browser needed.
if (require.main === module) {
  try {
    const count = assertAtlasGate();
    console.log(`[art-gate] atlas ok (${count} chrome/icon plates decoded, non-blank, no legacy tiles)`);
  } catch (err) {
    console.error(`[art-gate] FAIL: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CHROME_TS,
  ICONS_TS,
  ATLAS_DIR,
  RESULTS_DIR,
  VIEW_MOCKUPS,
  GRID_W,
  GRID_H,
  ART_THRESHOLD,
  parseFileEntries,
  chromeIconFiles,
  distinctRgb,
  assertNonBlank,
  assertAtlasGate,
  luminanceGrid,
  artScore,
  assertCaptureVsMockup,
};
