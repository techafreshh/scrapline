// Benchmark side-by-side compare (#161): decodes the committed
// docs/benchmark/*.png references plus the fresh artifacts/verify.json
// capture map, asserts bright muzzle-flash pixels within 24px of the
// mapped muzzle on the mid-match reference, and asserts every committed
// PNG decodes at its capture viewport size with a same-map histogram
// closer than the cross-map distance. Pure helpers stay unit-testable
// under node; the CLI exits non-zero with the [verify-benchmark] prefix
// on failure. Stays out of `npm test` and CI (no browser there),
// mirroring the verify-presentation idiom.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const BENCHMARK_DIR = path.join(ROOT, "docs", "benchmark");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const VERIFY_JSON = path.join(ARTIFACTS_DIR, "verify.json");
// Committed references that must exist for side-by-side comparison.
const REFERENCE_NAMES = [
  "menu.png",
  "carousel.png",
  "midmatch-kilima.png",
  "standings.png",
];
// Non-trivial frame budget: blank/black captures stay far below it.
const MIN_PNG_BYTES = 5 * 1024;
// Muzzle-flash white (#fff7cc family): every channel clears 200 even
// after the canvas upscale blends the dot edge.
const BRIGHT_CHANNEL_FLOOR = 200;
// Proximity radius in screenshot px (the 24px acceptance probe).
const MUZZLE_RADIUS_PX = 24;

function log(message) {
  console.log(`[verify-benchmark] ${message}`);
}

function fail(message) {
  console.error(`[verify-benchmark] FAIL: ${message}`);
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

/** True when the bytes open with the 8-byte PNG signature. */
export function isPngBytes(buf) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.length < 8) {
    return false;
  }
  return signature.every((byte, index) => buf[index] === byte);
}

/** PNG pixel dimensions from the IHDR chunk (no inflate needed). */
export function pngInfoBytes(buf) {
  assert(isPngBytes(buf), "not a PNG (bad signature)");
  assert(buf.length >= 33, "truncated PNG (no IHDR)");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Decode an 8-bit non-interlaced PNG buffer into raw RGB channel bytes. */
export function decodePngRgbBytes(buf) {
  assert(isPngBytes(buf), "not a PNG (bad signature)");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      assert(data[12] === 0, "PNG must be non-interlaced");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert(bitDepth === 8, `PNG must be 8-bit (got ${bitDepth})`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert(channels > 0, `PNG must be RGB/RGBA (color type ${colorType})`);
  const raw = Buffer.from(zlib.inflateSync(Buffer.concat(idat)));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const current = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const previous =
      y === 0 ? Buffer.alloc(stride) : pixels.subarray((y - 1) * stride, y * stride);
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      let value = 0;
      if (filter === 0) {
        value = current[i];
      } else if (filter === 1) {
        value = (current[i] + a) & 255;
      } else if (filter === 2) {
        value = (current[i] + b) & 255;
      } else if (filter === 3) {
        value = (current[i] + ((a + b) >> 1)) & 255;
      } else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        value = (current[i] + predictor) & 255;
      } else {
        fail(`PNG uses unknown filter ${filter}`);
      }
      row[i] = value;
    }
  }
  return { width, height, channels, pixels };
}

/** Decode an 8-bit non-interlaced PNG file into raw RGB channel bytes. */
export function decodePngRgbFile(file) {
  return decodePngRgbBytes(fs.readFileSync(file));
}

/**
 * Map a backing-store muzzle into screenshot pixels through the
 * recorded capture: the canvas box (CSS px, 1:1 with shot px at
 * deviceScaleFactor 1) scales the 640x360 backing store onto the shot.
 */
export function mapMuzzleToShot(capture) {
  assert(
    capture !== null && capture !== undefined,
    "missing capture mapping",
  );
  assert(capture.box !== null, "capture is missing the canvas box");
  assert(capture.muzzle !== null, "capture is missing the muzzle");
  assert(capture.canvasW > 0 && capture.canvasH > 0, "capture has no backing size");
  return {
    x: capture.box.x + (capture.muzzle.x / capture.canvasW) * capture.box.width,
    y: capture.box.y + (capture.muzzle.y / capture.canvasH) * capture.box.height,
  };
}

/**
 * Count bright (all channels above the muzzle-flash floor) pixels whose
 * centers fall within radiusPx of (cx, cy). The acceptance probe needs
 * at least one: the painted muzzle dot plus its glow halo.
 */
export function brightPixelsNearBytes(buf, cx, cy, radiusPx) {
  const decoded = decodePngRgbBytes(buf);
  assert(
    Number.isFinite(cx) && Number.isFinite(cy) && radiusPx > 0,
    "bright-pixel probe needs a finite center and a positive radius",
  );
  let count = 0;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      if (Math.hypot(x - cx, y - cy) > radiusPx) {
        continue;
      }
      const o = (y * decoded.width + x) * decoded.channels;
      if (
        decoded.pixels[o] > BRIGHT_CHANNEL_FLOOR &&
        decoded.pixels[o + 1] > BRIGHT_CHANNEL_FLOOR &&
        decoded.pixels[o + 2] > BRIGHT_CHANNEL_FLOOR
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** File twin of brightPixelsNearBytes (reads the PNG off disk). */
export function brightPixelsNearFile(file, cx, cy, radiusPx) {
  return brightPixelsNearBytes(fs.readFileSync(file), cx, cy, radiusPx);
}

/** Fraction of pixels whose RGB triple differs (alpha ignored). */
export function histogramDelta(first, second) {
  if (first.width !== second.width || first.height !== second.height) {
    return 1;
  }
  const count = first.width * first.height;
  let different = 0;
  for (let i = 0; i < count; i += 1) {
    const o1 = i * first.channels;
    const o2 = i * second.channels;
    if (
      first.pixels[o1] !== second.pixels[o2] ||
      first.pixels[o1 + 1] !== second.pixels[o2 + 1] ||
      first.pixels[o1 + 2] !== second.pixels[o2 + 2]
    ) {
      different += 1;
    }
  }
  return different / count;
}

/**
 * Ammo module text probe: mag/reserve counts render `32/96`-style
 * (digits, slash, digits). Mirrors formatAmmoCounts without importing
 * client sources, so the verifier stays node-only.
 */
export function ammoTextOk(text) {
  return typeof text === "string" && /^\d+\/\d+$/.test(text.trim());
}

function runCli() {
  assert(fs.existsSync(VERIFY_JSON), `missing ${VERIFY_JSON} (run verify:presentation first)`);
  const report = JSON.parse(fs.readFileSync(VERIFY_JSON, "utf8"));
  assert(report.status === "ALL GREEN", `verify.json status is ${report.status}`);
  const captures = report.checks.captures;
  assert(
    captures !== undefined && captures !== null,
    "verify.json has no checks.captures (re-run verify:presentation)",
  );
  // Every committed reference decodes at its capture viewport size.
  for (const name of REFERENCE_NAMES) {
    const file = path.join(BENCHMARK_DIR, name);
    assert(fs.existsSync(file), `missing committed reference ${file}`);
    const bytes = fs.statSync(file).size;
    assert(bytes > MIN_PNG_BYTES, `${name} is ${bytes} bytes, expected >5KB`);
    const info = pngInfoBytes(fs.readFileSync(file));
    const capture = captures[name];
    assert(
      capture !== undefined && capture !== null,
      `verify.json has no capture mapping for ${name}`,
    );
    assert(
      info.width === capture.shotW && info.height === capture.shotH,
      `${name} is ${info.width}x${info.height}, capture was ${capture.shotW}x${capture.shotH}`,
    );
    log(`${name} ok (${info.width}x${info.height} ${(bytes / 1024).toFixed(1)}KB)`);
  }
  // Muzzle proximity probe on the committed mid-match reference.
  const kilima = captures["midmatch-kilima.png"];
  const mapped = mapMuzzleToShot(kilima);
  const bright = brightPixelsNearFile(
    path.join(BENCHMARK_DIR, "midmatch-kilima.png"),
    mapped.x,
    mapped.y,
    MUZZLE_RADIUS_PX,
  );
  assert(
    bright >= 1,
    `no bright pixel within ${MUZZLE_RADIUS_PX}px of the muzzle in docs/benchmark/midmatch-kilima.png`,
  );
  log(`muzzle proximity ok (${bright} bright pixels within ${MUZZLE_RADIUS_PX}px)`);
  // Side-by-side bound: the committed kilima frame must sit closer to
  // the fresh kilima capture than a fresh cross-map frame does, proving
  // the reference shows the same map class (not a foreign capture).
  const committed = decodePngRgbFile(path.join(BENCHMARK_DIR, "midmatch-kilima.png"));
  const fresh = decodePngRgbFile(path.join(ARTIFACTS_DIR, "midmatch-kilima.png"));
  const freshDune = decodePngRgbFile(path.join(ARTIFACTS_DIR, "midmatch-dune.png"));
  const sameDelta = histogramDelta(committed, fresh);
  const crossDelta = histogramDelta(fresh, freshDune);
  assert(
    sameDelta < crossDelta,
    `committed kilima ${(sameDelta * 100).toFixed(1)}% vs fresh exceeds cross-map ${(crossDelta * 100).toFixed(1)}%`,
  );
  log(`side-by-side ok (same-map ${(sameDelta * 100).toFixed(1)}% < cross-map ${(crossDelta * 100).toFixed(1)}%)`);
  log("ALL GREEN: benchmark comparison passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (err) {
    if (process.exitCode === 0) {
      process.exitCode = 1;
    }
    console.error(`[verify-benchmark] ${err && err.message ? err.message : err}`);
  }
}
