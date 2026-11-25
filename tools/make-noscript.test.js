// No-JS fallback art tests (issue #350, SC-11): the procedural panel
// encodes deterministically, parses as a 480x240 PNG inside the
// twelve-colour palette, and lands beside its manifest entry. Mirrors
// tools/slice-menu.test.js (node:test, temp-dir seam, never touches the
// committed kit).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TOOL = path.join(__dirname, "make-noscript.js");
const { makeNoscript, NOSCRIPT_W, NOSCRIPT_H } = require(TOOL);
const slicer = require("./slice-sheet.js");

/** PNG IHDR dimensions (no decode needed). */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.deepEqual(
    Array.from(buf.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${file} must carry the PNG signature`,
  );
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Distinct opaque RGB entries in the decoded file. */
function paletteOf(file) {
  const img = slicer.decodePng(fs.readFileSync(file));
  const colors = new Set();
  for (let i = 0; i < img.w * img.h; i += 1) {
    if (img.rgba[i * 4 + 3] !== 0) {
      colors.add(
        (img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2],
      );
    }
  }
  return colors;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("makeNoscript emits the 480x240 panel plus its manifest entry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-noscript-"));
  try {
    const written = makeNoscript(dir);
    assert.equal(written.length, 1);
    assert.equal(written[0].name, "noscript");
    const file = path.join(dir, "noscript.png");
    assert.deepEqual(pngSize(file), { w: NOSCRIPT_W, h: NOSCRIPT_H });
    assert.deepEqual([NOSCRIPT_W, NOSCRIPT_H], [480, 240]);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert.deepEqual(manifest.noscript, {
      file: "ui/noscript.png",
      w: NOSCRIPT_W,
      h: NOSCRIPT_H,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("makeNoscript is byte-identical across runs (deterministic deflate)", () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-noscript-a-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-noscript-b-"));
  try {
    makeNoscript(first);
    makeNoscript(second);
    assert.equal(
      sha256(path.join(first, "noscript.png")),
      sha256(path.join(second, "noscript.png")),
    );
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("makeNoscript stays inside the twelve-colour palette", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-noscript-c-"));
  try {
    makeNoscript(dir);
    const colors = paletteOf(path.join(dir, "noscript.png"));
    assert.ok(colors.size >= 4, `expected plate detail, got ${colors.size} colors`);
    assert.ok(colors.size <= 12, `expected <=12 palette colors, got ${colors.size}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
