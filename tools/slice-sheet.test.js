// Unit + CLI tests for the slice-sheet slicer (PRD v8, act A1).
// Synthetic fixtures only (plus one committed results JPEG for decodeImage);
// no art is produced or committed by these tests.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const TOOL = path.join(__dirname, "slice-sheet.js");
const {
  PALETTE_12,
  decodeImage,
  chromaKey,
  erodeAlpha,
  detectPitch,
  downscaleNearest,
  quantiseNearest,
  boundingBox,
  cropImage,
  cropCells,
  padCanvas,
  encodePng8,
} = require(TOOL);

// { w, h, rgba } builder: fill(x, y) returns [r, g, b, a].
function makeImg(w, h, fill) {
  const rgba = Buffer.alloc(w * h * 4, 0);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const px = fill(x, y);
      rgba[(y * w + x) * 4] = px[0];
      rgba[(y * w + x) * 4 + 1] = px[1];
      rgba[(y * w + x) * 4 + 2] = px[2];
      rgba[(y * w + x) * 4 + 3] = px[3];
    }
  }
  return { w, h, rgba };
}

const MAGENTA = [255, 0, 255, 255];
const INK = [0x0b, 0x0f, 0x1a, 255];

// Vertical bars alternating opaque/transparent with the given widths,
// cycling through widths run by run (deterministic, no randomness).
function barsImg(w, h, widths, color = INK) {
  const runs = [];
  let xx = 0;
  let i = 0;
  while (xx < w) {
    const len = widths[i % widths.length];
    runs.push([xx, Math.min(xx + len, w), i % 2 === 0]);
    xx += len;
    i += 1;
  }
  return makeImg(w, h, (x) => {
    for (const [a, b, opaque] of runs) {
      if (x >= a && x < b) {
        return opaque ? color : [0, 0, 0, 0];
      }
    }
    return [0, 0, 0, 0];
  });
}

// Encode a { w, h, rgba } image as an RGBA PNG (filter 0) for CLI inputs.
function encodeRgbaPng(img) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[12] = 0;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y += 1) {
    raw[y * (img.w * 4 + 1)] = 0;
    img.rgba.copy(raw, y * (img.w * 4 + 1) + 1, y * img.w * 4, (y + 1) * img.w * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function alphaAt(img, x, y) {
  return img.rgba[(y * img.w + x) * 4 + 3];
}

test("chroma key: magenta goes transparent, everything else opaque", () => {
  const img = makeImg(4, 1, (x) => {
    if (x === 0) {
      return MAGENTA;
    }
    if (x === 1) {
      return [255, 0, 255, 255];
    }
    if (x === 2) {
      return [10, 20, 30, 255];
    }
    return [0, 0, 0, 255];
  });
  const keyed = chromaKey(img);
  assert.equal(alphaAt(keyed, 0, 0), 0);
  assert.equal(alphaAt(keyed, 1, 0), 0);
  assert.equal(alphaAt(keyed, 2, 0), 255);
  assert.equal(alphaAt(keyed, 3, 0), 255);
});

test("chroma key: tolerance edge (distance 24 keyed, 25 kept)", () => {
  // Squared distance from #FF00FF: dz=24 -> 576 <= 576 keyed;
  // dz=25 -> 625 > 576 kept.
  const img = makeImg(2, 1, (x) => (x === 0 ? [255, 0, 231, 255] : [255, 0, 230, 255]));
  const keyed = chromaKey(img);
  assert.equal(alphaAt(keyed, 0, 0), 0);
  assert.equal(alphaAt(keyed, 1, 0), 255);
});

test("chroma key: alpha is only ever 0 or 255", () => {
  const img = makeImg(16, 16, (x, y) => [(x * 13 + y * 7) % 256, (x * 5 + y * 11) % 256, (x + y * 3) % 256, 255]);
  const keyed = chromaKey(img);
  for (let i = 0; i < 16 * 16; i += 1) {
    assert.ok(keyed.rgba[i * 4 + 3] === 0 || keyed.rgba[i * 4 + 3] === 255);
  }
});

test("erode: isolated pixel is removed, 3px bar keeps its middle", () => {
  const img = makeImg(9, 3, (x, y) => {
    if (x === 1 && y === 1) {
      return INK;
    }
    if (x >= 4 && x <= 6) {
      return INK;
    }
    return [0, 0, 0, 0];
  });
  const out = erodeAlpha(img);
  assert.equal(alphaAt(out, 1, 1), 0);
  assert.equal(alphaAt(out, 4, 1), 0);
  assert.equal(alphaAt(out, 5, 1), 255);
  assert.equal(alphaAt(out, 6, 1), 0);
});

test("erode: only touches the alpha plane", () => {
  const img = makeImg(5, 5, () => [17, 34, 51, 255]);
  const out = erodeAlpha(img);
  assert.equal(alphaAt(out, 2, 2), 255);
  assert.deepEqual(Array.from(out.rgba.subarray((2 * 5 + 2) * 4, (2 * 5 + 2) * 4 + 3)), [17, 34, 51]);
  assert.equal(alphaAt(out, 0, 0), 0);
});

test("pitch: uniform 8px bars detect pitch 8 at phase 0", () => {
  const found = detectPitch(barsImg(64, 32, [8, 8]));
  assert.equal(found.pitch, 8);
  assert.equal(found.phaseX, 0);
});

test("pitch: 7/8/9 mix around 8 still detects 8", () => {
  // Run pairs sum to 16 so edges stay on the 8-grid within +-1px.
  const found = detectPitch(barsImg(64, 32, [8, 8, 7, 9]));
  assert.equal(found.pitch, 8);
});

test("pitch: shifted bars report the grid phase", () => {
  const img = makeImg(72, 32, (x) => (Math.floor((x - 3) / 8) % 2 === 0 && x >= 3 ? INK : [0, 0, 0, 0]));
  const found = detectPitch(img);
  assert.equal(found.pitch, 8);
  assert.equal(found.phaseX, 3);
});

test("pitch: random widths refuse naming the pitch stage", () => {
  // Deterministic LCG — no randomness in the suite.
  let seed = 20260811;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  const widths = Array.from({ length: 120 }, () => 4 + (rnd() % 9));
  assert.throws(() => detectPitch(barsImg(1024, 64, widths)), /slice-sheet:pitch/);
});

test("pitch: spliced halves with different grids refuse", () => {
  const left = barsImg(200, 64, [5, 5]);
  const right = barsImg(200, 64, [9, 9]);
  const rgba = Buffer.alloc(400 * 64 * 4, 0);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 400; x += 1) {
      const src = x < 200 ? left : right;
      const sx = x < 200 ? x : x - 200;
      rgba[(y * 400 + x) * 4 + 3] = src.rgba[(y * 200 + sx) * 4 + 3];
    }
  }
  assert.throws(() => detectPitch({ w: 400, h: 64, rgba }), /slice-sheet:pitch/);
});

test("pitch: empty image refuses", () => {
  assert.throws(() => detectPitch(makeImg(16, 16, () => [0, 0, 0, 0])), /slice-sheet:pitch/);
});

test("downscale: top-left sample of each pitch block", () => {
  const colors = [
    [10, 0, 0, 255],
    [0, 20, 0, 255],
    [0, 0, 30, 255],
    [40, 40, 0, 255],
  ];
  const img = makeImg(16, 16, (x, y) => colors[Math.floor(y / 8) * 2 + Math.floor(x / 8)]);
  const down = downscaleNearest(img, 8, 0, 0);
  assert.equal(down.w, 2);
  assert.equal(down.h, 2);
  for (let i = 0; i < 4; i += 1) {
    assert.deepEqual(Array.from(down.rgba.subarray(i * 4, i * 4 + 4)), colors[i]);
  }
});

test("downscale: phase offset shifts the sampling grid", () => {
  const img = makeImg(16, 4, (x) => (x >= 4 && x < 12 ? [9, 9, 9, 255] : [0, 0, 0, 0]));
  const down = downscaleNearest(img, 8, 4, 0);
  assert.equal(down.w, 2);
  assert.equal(alphaAt(down, 0, 0), 255);
  assert.equal(alphaAt(down, 1, 0), 0);
});

test("downscale: rejects a non-positive pitch", () => {
  const img = makeImg(8, 8, () => INK);
  assert.throws(() => downscaleNearest(img, 0, 0, 0), /slice-sheet:downscale/);
});

test("quantise: nearest palette colour, transparent stays transparent", () => {
  const nearCyan = [5, 230, 250, 255];
  const nearRed = [240, 70, 70, 255];
  const img = makeImg(3, 1, (x) => (x === 0 ? nearCyan : x === 1 ? nearRed : [0, 0, 0, 0]));
  const out = quantiseNearest(img);
  assert.deepEqual(Array.from(out.rgba.subarray(0, 4)), [0x00, 0xe5, 0xff, 255]);
  assert.deepEqual(Array.from(out.rgba.subarray(4, 8)), [0xef, 0x44, 0x44, 255]);
  assert.deepEqual(Array.from(out.rgba.subarray(8, 12)), [0, 0, 0, 0]);
});

test("quantise: uniform region maps uniformly (dithering off)", () => {
  const img = makeImg(8, 8, () => [100, 140, 200, 255]);
  const out = quantiseNearest(img);
  const first = Array.from(out.rgba.subarray(0, 4));
  for (let i = 0; i < 64; i += 1) {
    assert.deepEqual(Array.from(out.rgba.subarray(i * 4, i * 4 + 4)), first);
  }
  assert.ok(PALETTE_12.some((c) => c[0] === first[0] && c[1] === first[1] && c[2] === first[2]));
});

test("crop: bounding box of opaque pixels", () => {
  const img = makeImg(10, 10, (x, y) => (x >= 2 && x < 7 && y >= 3 && y < 8 ? INK : [0, 0, 0, 0]));
  const box = boundingBox(img);
  assert.deepEqual(box, { x: 2, y: 3, w: 5, h: 5 });
  const cropped = cropImage(img, box);
  assert.equal(cropped.w, 5);
  assert.equal(cropped.h, 5);
  assert.equal(alphaAt(cropped, 0, 0), 255);
});

test("crop: empty image refuses", () => {
  assert.throws(() => boundingBox(makeImg(8, 8, () => [0, 0, 0, 0])), /slice-sheet:crop/);
});

test("crop: 3x2 cells split row-major into equal rectangles", () => {
  const img = makeImg(12, 10, (x) => (x < 6 ? INK : [0, 0, 0, 0]));
  const cells = cropCells(img, 3, 2);
  assert.equal(cells.length, 6);
  for (const c of cells) {
    assert.equal(c.img.w, 4);
    assert.equal(c.img.h, 5);
  }
  assert.deepEqual(cells.map((c) => [c.x, c.y]), [[0, 0], [4, 0], [8, 0], [0, 5], [4, 5], [8, 5]]);
});

test("crop: uneven split refuses", () => {
  const img = makeImg(10, 10, () => INK);
  assert.throws(() => cropCells(img, 3, 2), /slice-sheet:crop/);
});

test("pad: content is centred on the requested size", () => {
  const img = makeImg(2, 2, () => INK);
  const out = padCanvas(img, 6, 6, 0);
  assert.equal(out.w, 6);
  assert.equal(out.h, 6);
  assert.equal(alphaAt(out, 0, 0), 0);
  assert.equal(alphaAt(out, 2, 2), 255);
  assert.equal(alphaAt(out, 3, 3), 255);
  assert.equal(alphaAt(out, 4, 4), 0);
});

test("pad: never scales — smaller content keeps its pixels", () => {
  const img = makeImg(2, 4, () => INK);
  const out = padCanvas(img, 8, 8, 0);
  assert.equal(out.w, 8);
  assert.equal(out.h, 8);
  assert.equal(alphaAt(out, 3, 2), 255);
  assert.equal(alphaAt(out, 4, 5), 255);
  assert.equal(alphaAt(out, 0, 0), 0);
});

test("pad: overflow and border violations refuse", () => {
  const img = makeImg(8, 8, () => INK);
  assert.throws(() => padCanvas(img, 4, 4, 0), /slice-sheet:pad/);
  assert.throws(() => padCanvas(img, 8, 8, 1), /slice-sheet:pad/);
  assert.throws(() => padCanvas(img, 0, 8, 0), /slice-sheet:pad/);
});

test("encodePng8: color type 3 with at most 13 palette entries", () => {
  const img = quantiseNearest(makeImg(4, 4, (x) => (x < 2 ? [0, 229, 255, 255] : [0, 0, 0, 0])));
  const png = encodePng8(img);
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  assert.equal(png[25], 3);
  const decoded = decodeImage(png);
  assert.equal(decoded.w, 4);
  assert.equal(decoded.h, 4);
  assert.deepEqual(Array.from(decoded.rgba), Array.from(img.rgba));
});

test("decodeImage: committed reference JPEG decodes to RGBA", () => {
  const buf = fs.readFileSync(path.join(__dirname, "..", "docs", "ui-prompts", "results", "CH-01-v1.jpg"));
  const img = decodeImage(buf);
  assert.ok(img.w > 0 && img.h > 0);
  assert.equal(img.rgba.length, img.w * img.h * 4);
  const keyed = chromaKey(img);
  let transparent = 0;
  let opaque = 0;
  for (let i = 0; i < img.w * img.h; i += 1) {
    if (keyed.rgba[i * 4 + 3] === 0) {
      transparent += 1;
    } else {
      opaque += 1;
    }
  }
  assert.ok(transparent > 0, "magenta background keys out");
  assert.ok(opaque > 0, "artwork survives the key");
});

test("decodeImage: unknown magic refuses naming decode", () => {
  assert.throws(() => decodeImage(Buffer.from([1, 2, 3, 4])), /slice-sheet:decode/);
});

// ---------------------------------------------------------------------------
// CLI integration (hermetic: outputs go to a temp atlas dir).
// ---------------------------------------------------------------------------

function runCli(args, atlasDir) {
  return spawnSync(process.execPath, [TOOL, ...args], {
    encoding: "utf8",
    env: { ...process.env, SLICE_SHEET_ATLAS_DIR: atlasDir },
  });
}

// 64x64 sheet: left half 8px bars, right half 8px bars offset by one full
// bar so every quadrant votes the same pitch-8 grid.
function cliFixturePng() {
  const img = makeImg(64, 64, (x, y) => {
    const inLeft = x < 32;
    const lx = inLeft ? x : x - 32;
    const bar = Math.floor(lx / 8) % 2 === 0;
    if (!bar) {
      return [0, 0, 0, 0];
    }
    return y < 32 ? [0, 229, 255, 255] : [255, 107, 53, 255];
  });
  return encodeRgbaPng(img);
}

test("CLI: slices a sheet into manifest + atlas entries", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slice-sheet-"));
  const input = path.join(tmp, "in.png");
  fs.writeFileSync(input, cliFixturePng());
  const atlasDir = path.join(tmp, "atlas");
  const child = runCli(["--input", input, "--id", "CH-99", "--size", "8x8"], atlasDir);
  assert.equal(child.status, 0, child.stderr);
  const pngPath = path.join(atlasDir, "ui", "ch-99.png");
  assert.ok(fs.existsSync(pngPath), "emitted PNG exists");
  const manifest = JSON.parse(fs.readFileSync(path.join(atlasDir, "manifest.json"), "utf8"));
  assert.deepEqual(manifest["ui.ch-99"], { file: "ui/ch-99.png", atlas: "ui.json", w: 8, h: 8 });
  const atlas = JSON.parse(fs.readFileSync(path.join(atlasDir, "ui.json"), "utf8"));
  assert.deepEqual(atlas.frames["ui.ch-99"], { file: "ui/ch-99.png", x: 0, y: 0, w: 8, h: 8 });
});

test("CLI: two runs on the same input are byte-identical", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slice-sheet-"));
  const input = path.join(tmp, "in.png");
  fs.writeFileSync(input, cliFixturePng());
  const atlasDir = path.join(tmp, "atlas");
  const args = ["--input", input, "--id", "CH-99", "--size", "8x8"];
  assert.equal(runCli(args, atlasDir).status, 0);
  const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const first = {
    png: sha(path.join(atlasDir, "ui", "ch-99.png")),
    manifest: sha(path.join(atlasDir, "manifest.json")),
    atlas: sha(path.join(atlasDir, "ui.json")),
  };
  assert.equal(runCli(args, atlasDir).status, 0);
  assert.equal(sha(path.join(atlasDir, "ui", "ch-99.png")), first.png);
  assert.equal(sha(path.join(atlasDir, "manifest.json")), first.manifest);
  assert.equal(sha(path.join(atlasDir, "ui.json")), first.atlas);
});

// 96x64 sheet: downscales by the 8-grid to 12x8, divisible into 3x2 cells.
function cliCellsFixturePng() {
  const img = makeImg(96, 64, (x, y) => {
    const bar = Math.floor(x / 8) % 2 === 0;
    if (!bar) {
      return [0, 0, 0, 0];
    }
    return y < 32 ? [0, 229, 255, 255] : [255, 107, 53, 255];
  });
  return encodeRgbaPng(img);
}

test("CLI: --cells emits one asset per cell", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slice-sheet-"));
  const input = path.join(tmp, "in.png");
  fs.writeFileSync(input, cliCellsFixturePng());
  const atlasDir = path.join(tmp, "atlas");
  const child = runCli(["--input", input, "--id", "SH-99", "--cells", "3x2"], atlasDir);
  assert.equal(child.status, 0, child.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(atlasDir, "manifest.json"), "utf8"));
  const keys = Object.keys(manifest).filter((k) => k.startsWith("ui.sh-99."));
  assert.deepEqual(keys, ["ui.sh-99.00", "ui.sh-99.01", "ui.sh-99.02", "ui.sh-99.03", "ui.sh-99.04", "ui.sh-99.05"]);
  for (const k of keys) {
    assert.ok(fs.existsSync(path.join(atlasDir, manifest[k].file)));
  }
});

test("CLI: non-uniform pitch exits non-zero naming the pitch stage", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slice-sheet-"));
  const left = barsImg(200, 64, [5, 5]);
  const right = barsImg(200, 64, [9, 9]);
  const rgba = Buffer.alloc(400 * 64 * 4, 0);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 400; x += 1) {
      const src = x < 200 ? left : right;
      const sx = x < 200 ? x : x - 200;
      rgba[(y * 400 + x) * 4 + 3] = src.rgba[(y * 200 + sx) * 4 + 3];
      rgba[(y * 400 + x) * 4] = 11;
      rgba[(y * 400 + x) * 4 + 1] = 15;
      rgba[(y * 400 + x) * 4 + 2] = 26;
    }
  }
  const input = path.join(tmp, "bad.png");
  fs.writeFileSync(input, encodeRgbaPng({ w: 400, h: 64, rgba }));
  const child = runCli(["--input", input, "--id", "XX-01"], path.join(tmp, "atlas"));
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /slice-sheet:pitch/);
});

test("CLI: budget refusal exits non-zero naming the emit stage", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slice-sheet-"));
  const input = path.join(tmp, "in.png");
  fs.writeFileSync(input, cliFixturePng());
  const atlasDir = path.join(tmp, "atlas");
  fs.mkdirSync(path.join(atlasDir, "ui"), { recursive: true });
  fs.writeFileSync(path.join(atlasDir, "ui", "junk.bin"), Buffer.alloc(7 * 1024 * 1024, 7));
  const child = runCli(["--input", input, "--id", "CH-99"], atlasDir);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /slice-sheet:emit/);
  assert.ok(!fs.existsSync(path.join(atlasDir, "ui", "ch-99.png")), "refuses before writing");
});

test("CLI: missing --input exits non-zero naming the decode stage", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slice-sheet-"));
  const child = runCli(["--id", "CH-99"], path.join(tmp, "atlas"));
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /slice-sheet:decode/);
});

test("CLI: --help exits 0", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slice-sheet-"));
  const child = runCli(["--help"], path.join(tmp, "atlas"));
  assert.equal(child.status, 0);
  assert.match(child.stdout, /--input/);
});
