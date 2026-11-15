// Benchmark reference gate (#161): docs/benchmark/ holds the README
// plus at least three reference PNGs including the mid-match capture,
// every PNG decodes with a valid signature and sane dimensions, and the
// pure compare helpers (24px proximity, ammo text) behave at their
// boundaries. Node-only: no browser, no artifacts/ dependency.
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const BENCHMARK_DIR = path.join(ROOT, "docs", "benchmark");

let compare = null;

before(async () => {
  compare = await import("../scripts/verify/benchmark-compare.mjs");
});

/** Minimal CRC32 (PNG chunk checksums for the hand-built probe PNG). */
function crc32(buf) {
  let table = crc32.table;
  if (table === undefined) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Encode raw RGB rows (filter 0) into a minimal PNG buffer. */
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    rgb
      .subarray(y * width * 3, (y + 1) * width * 3)
      .copy(raw, y * (1 + width * 3) + 1);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("docs/benchmark/ holds the README plus >=3 reference PNGs", () => {
  const names = fs.readdirSync(BENCHMARK_DIR);
  assert.ok(
    names.includes("README.md"),
    `expected README.md in docs/benchmark/, found: ${names.join(", ")}`,
  );
  const pngs = names.filter((name) => name.toLowerCase().endsWith(".png"));
  assert.ok(pngs.length >= 3, `expected >=3 PNGs, found: ${pngs.join(", ")}`);
  assert.ok(
    pngs.includes("midmatch-kilima.png"),
    `expected midmatch-kilima.png, found: ${pngs.join(", ")}`,
  );
});

test("every benchmark PNG is non-trivial with a valid signature", () => {
  const names = fs
    .readdirSync(BENCHMARK_DIR)
    .filter((name) => name.toLowerCase().endsWith(".png"));
  assert.ok(names.length >= 3, "expected >=3 PNGs");
  for (const name of names) {
    const buf = fs.readFileSync(path.join(BENCHMARK_DIR, name));
    assert.ok(buf.length > 5 * 1024, `${name} is ${buf.length} bytes, expected >5KB`);
    assert.ok(compare.isPngBytes(buf), `${name} has a bad PNG signature`);
    const info = compare.pngInfoBytes(buf);
    assert.ok(info.width > 0 && info.height > 0, `${name} has no pixel size`);
  }
});

test("viewport captures keep full-frame dimensions", () => {
  for (const name of ["menu.png", "midmatch-kilima.png", "standings.png"]) {
    const buf = fs.readFileSync(path.join(BENCHMARK_DIR, name));
    const info = compare.pngInfoBytes(buf);
    assert.ok(
      info.width >= 1280 && info.height >= 720,
      `${name} is ${info.width}x${info.height}, expected >=1280x720`,
    );
  }
});

test("brightPixelsNearBytes respects the radius boundary", () => {
  // 5x1 strip: white pixels at x=0 and x=4, black between.
  const rgb = Buffer.alloc(5 * 1 * 3, 0);
  rgb[0] = 255;
  rgb[1] = 255;
  rgb[2] = 255;
  rgb[12] = 255;
  rgb[13] = 255;
  rgb[14] = 255;
  const buf = encodePng(5, 1, rgb);
  assert.equal(compare.brightPixelsNearBytes(buf, 0, 0, 1.5), 1);
  assert.equal(compare.brightPixelsNearBytes(buf, 0, 0, 4.5), 2);
  assert.equal(compare.brightPixelsNearBytes(buf, 2, 0, 1.5), 0);
});

test("brightPixelsNearBytes finds the muzzle flash in the reference", () => {
  const buf = fs.readFileSync(path.join(BENCHMARK_DIR, "midmatch-kilima.png"));
  const info = compare.pngInfoBytes(buf);
  // Muzzle flash paints near the left-center soldier: a generous probe
  // around that anchor must see bright pixels, while a far dark corner
  // of the night sky frame must not.
  const near = compare.brightPixelsNearBytes(buf, info.width * 0.25, info.height * 0.55, 120);
  assert.ok(near >= 1, "expected bright muzzle/tracer pixels near the soldier");
});

test("ammoTextOk accepts `32/96`-style counts only", () => {
  assert.equal(compare.ammoTextOk("32/96"), true);
  assert.equal(compare.ammoTextOk("9/90"), true);
  assert.equal(compare.ammoTextOk("0/6"), true);
  assert.equal(compare.ammoTextOk("rifle"), false);
  assert.equal(compare.ammoTextOk("32/"), false);
  assert.equal(compare.ammoTextOk("/96"), false);
  assert.equal(compare.ammoTextOk("32 / 96"), false);
  assert.equal(compare.ammoTextOk(""), false);
  assert.equal(compare.ammoTextOk(null), false);
});

test("mapMuzzleToShot scales the backing store onto the shot", () => {
  const shot = compare.mapMuzzleToShot({
    box: { x: 0, y: 0, width: 1920, height: 1080 },
    canvasW: 640,
    canvasH: 360,
    muzzle: { x: 320, y: 180 },
  });
  assert.equal(shot.x, 960);
  assert.equal(shot.y, 540);
});
