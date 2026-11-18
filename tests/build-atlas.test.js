// Palette-overrun guard (issue #289): decodeSheetPng must fail loudly on a
// palette index beyond the PLTE length instead of mapping it to black, while
// in-bounds sheets still decode to their exact PLTE colors.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const zlib = require("node:zlib");

const { decodeSheetPng } = require("../tools/build-atlas.js");

function makePalettePng(w, h, entries, indices) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  ihdr[12] = 0;
  const chunk = (type, data) =>
    Buffer.concat([
      (() => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        return len;
      })(),
      Buffer.from(type, "latin1"),
      data,
      Buffer.alloc(4),
    ]);
  const plte = Buffer.from(entries.flat());
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      raw[y * (w + 1) + 1 + x] = indices[y * w + x];
    }
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("in-bounds palette index decodes to the exact PLTE color", () => {
  const png = makePalettePng(1, 1, [[17, 34, 51]], [0]);
  const decoded = decodeSheetPng(png, "probe-sheet");
  assert.equal(decoded.w, 1);
  assert.equal(decoded.h, 1);
  assert.deepEqual(Array.from(decoded.rgba), [17, 34, 51, 255]);
});

test("last valid palette index still decodes", () => {
  const png = makePalettePng(2, 1, [[17, 34, 51], [200, 100, 50]], [0, 1]);
  const decoded = decodeSheetPng(png, "probe-sheet");
  assert.deepEqual(Array.from(decoded.rgba), [17, 34, 51, 255, 200, 100, 50, 255]);
});

test("out-of-range palette index fails loudly", () => {
  const png = makePalettePng(2, 1, [[17, 34, 51]], [0, 1]);
  const b64 = png.toString("base64");
  const tool = path.join(__dirname, "..", "tools", "build-atlas.js");
  const script = `const { decodeSheetPng } = require(${JSON.stringify(tool)}); decodeSheetPng(Buffer.from(${JSON.stringify(b64)}, "base64"), "probe-sheet");`;
  const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.notEqual(child.status, 0, "overrun must exit nonzero");
  assert.match(child.stderr, /decodeSheetPng/);
  assert.match(child.stderr, /palette/i);
});
