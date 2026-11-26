// Art gate unit tests (issue #352, act A7): offline node:test proofs for
// scripts/verify/art-gate.js on synthetic fixtures (no server, no
// browser). Mirrors tests/verify-ui.test.js (node:test +
// node:assert/strict); synthetic PNGs round-trip through the repo's own
// encodePng8/decodePng path from tools/slice-sheet.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { encodePng8, decodePng } = require("../tools/slice-sheet");
const artGate = require("../scripts/verify/art-gate");

const {
  ART_THRESHOLD,
  GRID_W,
  GRID_H,
  VIEW_MOCKUPS,
  parseFileEntries,
  chromeIconFiles,
  distinctRgb,
  assertNonBlank,
  assertAtlasGate,
  luminanceGrid,
  artScore,
  decodeMockupGrid,
  assertCaptureVsGrid,
  assertCaptureVsMockup,
} = artGate;

const VIEWS = [
  "menu",
  "setup",
  "how-to",
  "challenges",
  "locker",
  "midmatch-hud",
  "end-screen",
  "after-menu-return",
];

/** Build a w*h RGBA image from an (x, y) -> [r, g, b, a] function. */
function makeImage(w, h, fn) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * w + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { w, h, rgba };
}

/** Round-trip an image through the repo PNG writer + decoder. */
function pngRoundTrip(img) {
  return decodePng(encodePng8(img));
}

// Half-bright structured plate: bright top half, dark bottom half —
// stands in for a real view with distinct title/content bands.
function structuredImage() {
  return makeImage(64, 36, (x, y) => (y < 18 ? [220, 220, 220, 255] : [20, 20, 20, 255]));
}

test("pins the contract constants (grid, threshold, view table)", () => {
  assert.equal(GRID_W, 32);
  assert.equal(GRID_H, 18);
  assert.equal(ART_THRESHOLD, 60);
  assert.deepEqual(Object.keys(VIEW_MOCKUPS).sort(), [...VIEWS].sort());
  assert.equal(VIEW_MOCKUPS.menu, "ME-01-menu-v1.jpg");
  assert.equal(VIEW_MOCKUPS.setup, "SC-02-v1.jpg");
  assert.equal(VIEW_MOCKUPS["how-to"], "SC-04-v1.jpg");
  assert.equal(VIEW_MOCKUPS.challenges, "SC-05-v1.jpg");
  assert.equal(VIEW_MOCKUPS.locker, "SC-06-v1.jpg");
  assert.equal(VIEW_MOCKUPS["midmatch-hud"], "HU-01-hud-v1.jpg");
  assert.equal(VIEW_MOCKUPS["end-screen"], "SC-07-end-screen-v1.jpg");
  // After-menu-return reuses the menu mockup: no dedicated file exists.
  assert.equal(VIEW_MOCKUPS["after-menu-return"], "ME-01-menu-v1.jpg");
  for (const file of Object.values(VIEW_MOCKUPS)) {
    assert.ok(
      fs.existsSync(path.join(artGate.RESULTS_DIR, file)),
      `expected mockup ${file} in docs/ui-prompts/results/`,
    );
  }
});

test("parses chrome/icon file entries out of the committed sources", () => {
  const entries = chromeIconFiles();
  assert.ok(entries.length > 50, `expected dozens of entries, got ${entries.length}`);
  for (const entry of entries) {
    assert.match(entry.file, /^(ui|icons)\//);
    assert.doesNotMatch(entry.file, /(^|\/)ui\/tile_/);
  }
  const files = entries.map((entry) => entry.file);
  assert.ok(files.includes("ui/panel.png"), "expected the HUD frame plate");
  assert.ok(files.includes("icons/weapon-pistol.png"), "expected a weapon icon");
});

test("non-blank check rejects a uniform-colour plate", () => {
  const flat = pngRoundTrip(makeImage(8, 8, () => [11, 15, 26, 255]));
  assert.equal(distinctRgb(flat), 1);
  assert.throws(() => assertNonBlank(flat, "flat-test"), /uniform-colour/);
});

test("non-blank check accepts a 2-colour 8x8 glyph", () => {
  const glyph = pngRoundTrip(makeImage(8, 8, (x) => (x < 4 ? [11, 15, 26, 255] : [200, 60, 60, 255])));
  assert.equal(distinctRgb(glyph), 2);
  assertNonBlank(glyph, "glyph-test");
});

test("non-blank check accepts a single-stroke outline on transparency", () => {
  // The committed icons/rank-star-outline.png shape: one visible colour
  // over a transparent ground. Transparent pixels vote their stored RGB,
  // so the plate counts two triplets, not one.
  const outline = pngRoundTrip(makeImage(8, 8, (x, y) => (x === 0 || y === 0 ? [0, 0, 0, 0] : [42, 53, 80, 255])));
  assert.equal(distinctRgb(outline), 2);
  assertNonBlank(outline, "outline-test");
});

test("parses entry-shaped literals while ignoring template urls", () => {
  const entries = parseFileEntries(
    [
      'export const CHROME_FILES: Record<string, string> = {',
      '  [HUD_FRAME_KEY]: "ui/panel.png",',
      '  [PANEL_BANNER_KEY]: "ui/tile_0005.png",',
      "};",
      "`url(\"./assets/atlas/${file}\")`",
    ].join("\n"),
  );
  assert.deepEqual(entries, [
    { key: "HUD_FRAME_KEY", file: "ui/panel.png" },
    { key: "PANEL_BANNER_KEY", file: "ui/tile_0005.png" },
  ]);
});

test("atlas gate rejects a reverted ui/tile_ key naming the key", () => {
  assert.throws(
    () =>
      assertAtlasGate({
        entries: [{ key: "PANEL_BANNER_KEY", file: "ui/tile_0005.png", set: "chrome" }],
      }),
    /PANEL_BANNER_KEY.*ui\/tile_0005\.png/,
  );
});

test("atlas gate rejects a missing atlas file naming the key", () => {
  assert.throws(
    () =>
      assertAtlasGate({
        entries: [{ key: "PANEL_BANNER_KEY", file: "ui/no-such-plate.png", set: "chrome" }],
      }),
    /PANEL_BANNER_KEY.*missing/,
  );
});

test("atlas gate rejects an empty entry set instead of passing vacuously", () => {
  assert.throws(() => assertAtlasGate({ entries: [] }), /no chrome\/icon file entries/);
});

test("atlas gate passes over the committed tree", () => {
  const count = assertAtlasGate();
  assert.ok(count > 50, `expected dozens of plates, got ${count}`);
});

test("artScore passes near-identical grids", () => {
  const base = structuredImage();
  const perturbed = makeImage(64, 36, (x, y) => {
    const bright = y < 18;
    const wobble = (x + y) % 7 === 0 ? 2 : 0;
    const v = (bright ? 220 : 20) - wobble;
    return [v, v, v, 255];
  });
  const diff = artScore(luminanceGrid(base), luminanceGrid(perturbed));
  assert.ok(diff < 5, `expected a near-zero diff, got ${diff}`);
  assert.ok(diff <= ART_THRESHOLD, `near-identical grids must pass: ${diff}`);
});

test("artScore fails a full-flat plate (tiling proxy) beyond the threshold", () => {
  const base = structuredImage();
  const flat = makeImage(64, 36, () => [220, 220, 220, 255]);
  const diff = artScore(luminanceGrid(base), luminanceGrid(flat));
  assert.ok(diff > ART_THRESHOLD, `full-flat plate must fail: ${diff} <= ${ART_THRESHOLD}`);
});

test("artScore fails a top-rows-blanked view (clipped-title proxy) via the region term", () => {
  const base = structuredImage();
  // Blank the top quarter: the whole-frame mean only shifts ~55 (under
  // the threshold) while the top 3x2 regions shift ~110, so the region
  // term — not the cell term — carries the failure.
  const clipped = makeImage(64, 36, (x, y) => (y < 9 ? [0, 0, 0, 255] : y < 18 ? [220, 220, 220, 255] : [20, 20, 20, 255]));
  const diff = artScore(luminanceGrid(base), luminanceGrid(clipped));
  assert.ok(diff > ART_THRESHOLD, `clipped title must fail: ${diff} <= ${ART_THRESHOLD}`);
});

test("assertCaptureVsMockup passes near-identical PNGs and fails flat ones", () => {
  const base = pngRoundTrip(structuredImage());
  const same = encodePng8(structuredImage());
  const diff = assertCaptureVsMockup(encodePng8(base), same, "synthetic-view");
  assert.ok(diff <= ART_THRESHOLD, `near-identical captures must pass: ${diff}`);
  const flat = encodePng8(makeImage(64, 36, () => [220, 220, 220, 255]));
  assert.throws(
    () => assertCaptureVsMockup(flat, same, "synthetic-view"),
    /drifts from mockup.*> 60/,
  );
});

test("assertCaptureVsGrid scores identically to assertCaptureVsMockup on near-identical PNGs", () => {
  const base = pngRoundTrip(structuredImage());
  const same = encodePng8(structuredImage());
  const grid = decodeMockupGrid(same, "synthetic-mockup.png");
  const uncached = assertCaptureVsMockup(encodePng8(base), same, "synthetic-view");
  const cached = assertCaptureVsGrid(encodePng8(base), grid, "synthetic-view", "synthetic-mockup.png");
  assert.equal(cached, uncached);
  assert.ok(cached <= ART_THRESHOLD, `near-identical captures must pass: ${cached}`);
});

test("assertCaptureVsGrid fails flat plates with the same drift error", () => {
  const same = encodePng8(structuredImage());
  const grid = decodeMockupGrid(same, "synthetic-mockup.png");
  const flat = encodePng8(makeImage(64, 36, () => [220, 220, 220, 255]));
  assert.throws(
    () => assertCaptureVsGrid(flat, grid, "synthetic-view", "synthetic-mockup.png"),
    /drifts from mockup.*> 60/,
  );
});

test("one mockup grid reused across two captures yields identical diffs", () => {
  // Two-viewport proxy: the cached grid scores a second capture without
  // re-decoding the mockup, matching the uncached diff both times.
  const same = encodePng8(structuredImage());
  const grid = decodeMockupGrid(same, "synthetic-mockup.png");
  const first = assertCaptureVsGrid(encodePng8(structuredImage()), grid, "synthetic-view-1920x1080");
  const second = assertCaptureVsGrid(encodePng8(structuredImage()), grid, "synthetic-view-1280x720");
  assert.equal(first, second);
  assert.equal(first, assertCaptureVsMockup(encodePng8(structuredImage()), same, "synthetic-view"));
});

test("decodeMockupGrid names the file on decode failure, never skips", () => {
  assert.throws(
    () => decodeMockupGrid(Buffer.from("not an image"), "ME-01-menu-v1.jpg"),
    /ME-01-menu-v1\.jpg.*undecodable/,
  );
  assert.throws(
    () => assertCaptureVsGrid(Buffer.from("not an image"), decodeMockupGrid(encodePng8(structuredImage()), "m.png"), "menu-1920x1080"),
    /menu-1920x1080.*undecodable/,
  );
});

test("assertCaptureVsMockup names the file on decode failure, never skips", () => {
  const base = encodePng8(structuredImage());
  assert.throws(
    () => assertCaptureVsMockup(Buffer.from("not an image"), base, "menu-1920x1080"),
    /menu-1920x1080.*undecodable/,
  );
  assert.throws(
    () => assertCaptureVsMockup(base, Buffer.from("not an image"), "menu-1920x1080"),
    /ME-01-menu-v1\.jpg.*undecodable/,
  );
});
