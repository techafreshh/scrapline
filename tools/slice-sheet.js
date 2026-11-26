// Slicer for generated UI reference art (PRD v8, act A1).
//
// Turns a flat-`#FF00FF` reference JPEG from `docs/ui-prompts/results/` into
// shippable 1x pixel-art PNG-8 assets plus their manifest and atlas entries:
// key -> pitch -> downscale -> quantise -> crop -> pad -> emit. Every stage
// is a pure exported helper and every failure throws (and the CLI prints)
// `slice-sheet:<stage>: <detail>` with a nonzero exit, so a bad input names
// the stage that rejected it.
//
// Zero dependencies (node:fs/path/zlib only, like build-atlas.js): JPEG
// decoding is vendored as a minimal baseline-DCT decoder (8-bit, 1 or 3
// components, single interleaved scan, H/V sampling factors 1-2; anything
// else fails loudly naming `decode`) because every repo tool is deliberately
// dependency-free and native/sharp binaries would add CI flakiness for no
// behavioral gain. The CLI also accepts PNG input as a documented test seam;
// JPEG remains the contract input.
//
// Pixel pitch is found by block-edge phase coherence: object edges in clean
// pixel art sit on one global pitch grid (plus +-1 px of JPEG wobble), so
// for each candidate pitch 4..32 the tool scores the fraction of
// opaque/transparent transitions sharing a single phase modulo that pitch
// (rows and columns vote with independent phases) and takes the strict
// best (exact ties go to the larger pitch). Run-length voting alone cannot
// work: any small
// pitch (2, 3) is vacuously coherent with every input under a +-1 window,
// and a mixed 6/8 run set is translation-identical to pitch 7 with wobble,
// so multiples-of-p voting provably cannot refuse it while a phase vote can
// (alternating 6/8 splits across two phases). Pitches below 4 are excluded
// for the same reason: with a +-1 window coherence over modulus <= 3 covers
// every residue and carries no signal. Downscale then samples the top-left
// pixel of each cell of the detected grid (origin shifted by the detected
// phase), nearest-neighbour only.
//
// Usage:
//   node tools/slice-sheet.js --input <jpg> --id <prompt-id>
//     [--cells WxH] [--size WxH] [--border N]
//
// `--cells CxR` slices one asset per equal cell named `ui.<id>.<nn>`
// (row-major, zero-padded); without it the single asset is `ui.<id>`.
// Output filename and manifest key use the lowercased id:
// `ui/<id-lower>[.<nn>].png`. `--size` defaults to the cropped size and
// `--border` defaults to 0; content plus `2*border` must fit `--size` (the
// tool never scales). `SLICE_SHEET_ATLAS_DIR` overrides the destination
// atlas dir (test seam; defaults to `packages/client/assets/atlas`).
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const DEFAULT_ATLAS_DIR = path.join(ROOT, "packages", "client", "assets", "atlas");

// Total committed atlas weight must stay at or under 6 MB. Twin of the
// BUDGET_BYTES constant in tools/check-budget.js (duplicated, not imported,
// exactly like tools/build-atlas.js does).
const BUDGET_BYTES = 6291456;

// Palette lock (docs/ui-prompts/README.md section 2): the only twelve
// colours shipped art may use.
const PALETTE_12 = [
  [0x0b, 0x0f, 0x1a],
  [0x16, 0x21, 0x3a],
  [0x2a, 0x35, 0x50],
  [0x4a, 0x5a, 0x7f],
  [0x00, 0xe5, 0xff],
  [0xa5, 0xf3, 0xfc],
  [0xff, 0x6b, 0x35],
  [0xea, 0xb3, 0x08],
  [0xa3, 0xe6, 0x35],
  [0xef, 0x44, 0x44],
  [0xe8, 0xec, 0xf4],
  [0x8a, 0x94, 0xa8],
];

const CHROMA = [255, 0, 255];
const KEY_TOLERANCE = 24;
const KEY_TOLERANCE_SQ = KEY_TOLERANCE * KEY_TOLERANCE;

// Pitch search covers block sizes 4..32 and requires >=86% of transitions
// to share one phase. See the header comment for why pitches below 4 are
// excluded (a +-1 window over modulus <= 3 is vacuous). The 86% line sits
// between the noisiest committed reference art (IC-04 at 88%, ME-08 at 90%)
// and structureless input (random block widths peak near 85% at pitch 4,
// where the +-1 window already covers three of four residues blind); grids
// that disagree across quadrants are refused separately below.
const PITCH_MIN = 4;
const PITCH_MAX = 32;
const PITCH_SUPPORT = 0.86;
// A quadrant only votes when it holds enough structure to judge: otherwise
// sparse corners would cast junk votes and false-veto real sheets.
const PITCH_QUAD_MIN_TRANSITIONS = 32;
const PITCH_QUAD_MIN_SUPPORT = 0.9;
// Quadrants with fewer distinct edge positions than this cannot meaningfully
// vote: a handful of positions fits every large pitch, so the argmax lands
// on degenerate values (26, 32, ...) that would false-veto real sheets.
const PITCH_QUAD_MIN_DISTINCT = 20;
// Too few transitions to measure a grid: refuse instead of guessing.
const PITCH_MIN_TRANSITIONS = 8;

function stageError(stage, detail) {
  return new Error(`slice-sheet:${stage}: ${detail}`);
}

// CRC-32 (ISO 3309) over a buffer: the PNG chunk checksum primitive.
// Table-driven, zero dependencies (zlib covers compression only).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// ---------------------------------------------------------------------------
// PNG decode (test seam input path + encodePng8 round-trip).
// ---------------------------------------------------------------------------

// Decode an 8-bit non-interlaced PNG (color types 0, 2, 3, 4, 6) to RGBA.
// Anything else fails loudly naming `decode`.
function decodePng(buf) {
  const err = (detail) => {
    throw stageError("decode", detail);
  };
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!Buffer.isBuffer(buf) || buf.length < 24) {
    err("not a PNG (short read) — expected a JPEG or PNG input.");
  }
  for (let i = 0; i < sig.length; i += 1) {
    if (buf[i] !== sig[i]) {
      err("unknown image magic — expected a JPEG or PNG input.");
    }
  }
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let alpha = null;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    if (off + 12 + len > buf.length) {
      err("truncated PNG chunk — refusing a corrupt input.");
    }
    const data = buf.subarray(off + 8, off + 8 + len);
    const stored = buf.readUInt32BE(off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== stored) {
      err(`PNG chunk ${type} fails its CRC check — refusing a corrupt input.`);
    }
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      alpha = Buffer.from(data);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (w <= 0 || h <= 0) {
    err("PNG is missing its IHDR dimensions — refusing a corrupt input.");
  }
  if (bitDepth !== 8 || interlace !== 0) {
    err("only 8-bit non-interlaced PNG input is supported.");
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) {
    err(`unsupported PNG color type ${colorType} — expected 0, 2, 3, 4 or 6.`);
  }
  if (colorType === 3 && palette === null) {
    err("palette PNG is missing its PLTE chunk — refusing a corrupt input.");
  }
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    err("PNG has unreadable IDAT data — refusing a corrupt input.");
  }
  const bpp = channels;
  const stride = w * bpp;
  if (raw.length !== (stride + 1) * h) {
    err("PNG has an unexpected scanline size — refusing a corrupt input.");
  }
  const rgba = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride, 0);
  for (let y = 0; y < h; y += 1) {
    const row = raw.subarray(y * (stride + 1), (y + 1) * (stride + 1));
    const filter = row[0];
    const cur = Buffer.alloc(stride, 0);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x + 1];
      if (filter === 0) {
        // None.
      } else if (filter === 1) {
        v = (v + a) & 0xff;
      } else if (filter === 2) {
        v = (v + b) & 0xff;
      } else if (filter === 3) {
        v = (v + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pr) & 0xff;
      } else {
        err(`PNG uses an unknown filter ${filter} — refusing a corrupt input.`);
      }
      cur[x] = v;
    }
    for (let x = 0; x < w; x += 1) {
      const dst = (y * w + x) * 4;
      if (colorType === 0) {
        const g = cur[x];
        rgba[dst] = g;
        rgba[dst + 1] = g;
        rgba[dst + 2] = g;
        rgba[dst + 3] = 255;
      } else if (colorType === 2) {
        rgba[dst] = cur[x * 3];
        rgba[dst + 1] = cur[x * 3 + 1];
        rgba[dst + 2] = cur[x * 3 + 2];
        rgba[dst + 3] = 255;
      } else if (colorType === 3) {
        const idx = cur[x];
        if (idx * 3 + 2 >= palette.length) {
          err(`palette index ${idx} is beyond the PLTE length.`);
        }
        rgba[dst] = palette[idx * 3];
        rgba[dst + 1] = palette[idx * 3 + 1];
        rgba[dst + 2] = palette[idx * 3 + 2];
        rgba[dst + 3] = alpha !== null && idx < alpha.length ? alpha[idx] : 255;
      } else if (colorType === 4) {
        const g = cur[x * 2];
        rgba[dst] = g;
        rgba[dst + 1] = g;
        rgba[dst + 2] = g;
        rgba[dst + 3] = cur[x * 2 + 1];
      } else {
        rgba[dst] = cur[x * 4];
        rgba[dst + 1] = cur[x * 4 + 1];
        rgba[dst + 2] = cur[x * 4 + 2];
        rgba[dst + 3] = cur[x * 4 + 3];
      }
    }
    prev = cur;
  }
  return { w, h, rgba };
}

// ---------------------------------------------------------------------------
// JPEG decode (baseline DCT only).
// ---------------------------------------------------------------------------

const JPEG_ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

// Separable 8x8 inverse DCT matrix: M[u][x] = C(u) cos((2x+1) u pi / 16).
const JPEG_IDCT_M = (() => {
  const m = new Float64Array(64);
  for (let u = 0; u < 8; u += 1) {
    const c = u === 0 ? 1 / Math.SQRT2 : 1;
    for (let x = 0; x < 8; x += 1) {
      m[u * 8 + x] = c * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
    }
  }
  return m;
})();

function jpegIdctBlock(coeff) {
  // coeff: 64 dequantised values in natural (row-major) order.
  const m = JPEG_IDCT_M;
  const tmp = new Float64Array(64);
  for (let u = 0; u < 8; u += 1) {
    for (let y = 0; y < 8; y += 1) {
      let s = 0;
      for (let v = 0; v < 8; v += 1) {
        s += coeff[v * 8 + u] * m[v * 8 + y];
      }
      tmp[u * 8 + y] = s;
    }
  }
  const out = new Float64Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let s = 0;
      for (let u = 0; u < 8; u += 1) {
        s += m[u * 8 + x] * tmp[u * 8 + y];
      }
      out[y * 8 + x] = s / 4;
    }
  }
  return out;
}

function jpegBuildHuffman(counts, symbols) {
  const map = new Map();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    for (let i = 0; i < counts[len - 1]; i += 1) {
      if (k >= symbols.length) {
        throw stageError("decode", "JPEG Huffman table overruns its symbols.");
      }
      map.set(len * 65536 + code, symbols[k]);
      k += 1;
      code += 1;
    }
    code <<= 1;
  }
  return map;
}

function decodeJpeg(buf) {
  const err = (detail) => {
    throw stageError("decode", detail);
  };
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    err("not a JPEG (missing SOI marker).");
  }
  let off = 2;
  const quant = [null, null, null, null];
  const huffDC = [null, null, null, null];
  const huffAC = [null, null, null, null];
  let sof = null;
  let scanComps;
  let restartInterval = 0;

  const need = (n) => {
    if (off + n > buf.length) {
      err("truncated JPEG segment — refusing a corrupt input.");
    }
  };

  const nextMarker = () => {
    need(1);
    let b = buf[off];
    if (b !== 0xff) {
      err("expected a JPEG marker — refusing a corrupt input.");
    }
    do {
      off += 1;
      need(1);
      b = buf[off];
    } while (b === 0xff);
    off += 1;
    return b;
  };

  for (;;) {
    const m = nextMarker();
    if (m === 0xd9) {
      err("unexpected end of JPEG before the scan data.");
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      continue;
    }
    need(2);
    const len = buf.readUInt16BE(off);
    if (len < 2 || off + len > buf.length) {
      err("JPEG segment length runs past the buffer — refusing a corrupt input.");
    }
    const body = off + 2;
    const end = off + len;
    if (m >= 0xe0 && m <= 0xef) {
      // APPn: metadata, skip.
    } else if (m === 0xfe) {
      // COM: skip.
    } else if (m === 0xdb) {
      let p = body;
      while (p < end) {
        const info = buf[p];
        p += 1;
        const is16 = info >> 4 !== 0;
        if ((info >> 4) > 1) {
          err("JPEG quantisation table must be 8- or 16-bit.");
        }
        const tq = info & 0x0f;
        if (tq > 3) {
          err(`JPEG quantisation table id ${tq} is out of range.`);
        }
        const table = new Array(64);
        for (let i = 0; i < 64; i += 1) {
          if (is16) {
            if (p + 2 > end) {
              err("truncated JPEG quantisation table.");
            }
            table[JPEG_ZIGZAG[i]] = buf.readUInt16BE(p);
            p += 2;
          } else {
            if (p + 1 > end) {
              err("truncated JPEG quantisation table.");
            }
            table[JPEG_ZIGZAG[i]] = buf[p];
            p += 1;
          }
        }
        quant[tq] = table;
      }
    } else if (m === 0xc4) {
      let p = body;
      while (p < end) {
        const info = buf[p];
        p += 1;
        const cls = info >> 4;
        const th = info & 0x0f;
        if (cls > 1 || th > 3) {
          err(`JPEG Huffman table class ${cls} id ${th} is out of range.`);
        }
        if (p + 16 > end) {
          err("truncated JPEG Huffman table.");
        }
        const counts = Array.from(buf.subarray(p, p + 16));
        p += 16;
        const total = counts.reduce((a, b) => a + b, 0);
        if (p + total > end) {
          err("truncated JPEG Huffman symbols.");
        }
        const symbols = Array.from(buf.subarray(p, p + total));
        p += total;
        const table = jpegBuildHuffman(counts, symbols);
        if (cls === 0) {
          huffDC[th] = table;
        } else {
          huffAC[th] = table;
        }
      }
    } else if (m === 0xdd) {
      if (len !== 4) {
        err("JPEG restart interval segment has a bad length.");
      }
      restartInterval = buf.readUInt16BE(body);
    } else if (m === 0xc0 || m === 0xc1) {
      if (sof !== null) {
        err("JPEG has more than one frame header.");
      }
      need(8);
      const prec = buf[body];
      if (prec !== 8) {
        err(`JPEG precision ${prec} is unsupported — expected 8-bit baseline.`);
      }
      const h = buf.readUInt16BE(body + 1);
      const w = buf.readUInt16BE(body + 3);
      const nf = buf[body + 5];
      if (w <= 0 || h <= 0) {
        err("JPEG has unusable frame dimensions.");
      }
      if (nf !== 1 && nf !== 3) {
        err(`JPEG with ${nf} components is unsupported — expected 1 or 3.`);
      }
      if (body + 6 + nf * 3 > end) {
        err("truncated JPEG frame header.");
      }
      const comps = [];
      for (let i = 0; i < nf; i += 1) {
        const id = buf[body + 6 + i * 3];
        const samp = buf[body + 6 + i * 3 + 1];
        const tq = buf[body + 6 + i * 3 + 2];
        const hi = samp >> 4;
        const vi = samp & 0x0f;
        if (hi < 1 || hi > 2 || vi < 1 || vi > 2) {
          err(`JPEG sampling ${hi}x${vi} is unsupported — expected factors 1-2.`);
        }
        if (tq > 3 || quant[tq] === null) {
          err(`JPEG component ${id} references a missing quantisation table.`);
        }
        comps.push({ id, hi, vi, tq });
      }
      // Interleaved baseline scans need sampling factors that tile MCUs.
      const maxH = Math.max(...comps.map((c) => c.hi));
      const maxV = Math.max(...comps.map((c) => c.vi));
      void maxH;
      void maxV;
      sof = { h, w, comps };
    } else if (m === 0xc2 || m === 0xc3 || (m >= 0xc5 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      err("only baseline/sequential JPEG is supported — refusing a progressive or arithmetic input.");
    } else if (m === 0xda) {
      if (sof === null) {
        err("JPEG scan data appears before the frame header.");
      }
      const ns = buf[body];
      if (ns !== sof.comps.length) {
        err("only single interleaved-scan JPEG input is supported.");
      }
      if (body + 1 + ns * 2 + 3 > end) {
        err("truncated JPEG scan header.");
      }
      scanComps = [];
      for (let i = 0; i < ns; i += 1) {
        const cs = buf[body + 1 + i * 2];
        const sel = buf[body + 1 + i * 2 + 1];
        const td = sel >> 4;
        const ta = sel & 0x0f;
        const idx = sof.comps.findIndex((c) => c.id === cs);
        if (idx < 0) {
          err(`JPEG scan references unknown component ${cs}.`);
        }
        if (huffDC[td] === null || (sof.comps.length > 1 && huffAC[ta] === null)) {
          err("JPEG scan references a missing Huffman table.");
        }
        scanComps.push({ comp: sof.comps[idx], td, ta });
      }
      const ss = buf[body + 1 + ns * 2];
      const se = buf[body + 1 + ns * 2 + 1];
      const ahAl = buf[body + 1 + ns * 2 + 2];
      if (ss !== 0 || se !== 63 || ahAl !== 0) {
        err("only baseline spectral selection is supported.");
      }
      off = end;
      break;
    } else {
      err(`unsupported JPEG marker 0xFF${m.toString(16).toUpperCase()} — refusing the input.`);
    }
    off = end;
  }

  if (sof === null || scanComps === undefined) {
    err("JPEG has no scan data — refusing an empty input.");
  }

  // Split the entropy-coded bytes: resolve 0xFF00 stuffing, honour restart
  // markers (each starts a fresh segment), stop at EOI.
  const segments = [[]];
  for (;;) {
    if (off >= buf.length) {
      err("JPEG ends before EOI — refusing a truncated input.");
    }
    const b = buf[off];
    off += 1;
    if (b !== 0xff) {
      segments[segments.length - 1].push(b);
      continue;
    }
    let c = 0xff;
    while (c === 0xff) {
      if (off >= buf.length) {
        err("JPEG ends before EOI — refusing a truncated input.");
      }
      c = buf[off];
      off += 1;
    }
    if (c === 0x00) {
      segments[segments.length - 1].push(0xff);
    } else if (c >= 0xd0 && c <= 0xd7) {
      segments.push([]);
    } else if (c === 0xd9) {
      break;
    } else {
      err(`unexpected JPEG marker 0xFF${c.toString(16).toUpperCase()} inside the scan data.`);
    }
  }

  const maxH = Math.max(...sof.comps.map((c) => c.hi));
  const maxV = Math.max(...sof.comps.map((c) => c.vi));
  const mcuW = Math.ceil(sof.w / (8 * maxH));
  const mcuH = Math.ceil(sof.h / (8 * maxV));
  const totalMcus = mcuW * mcuH;

  // One decoded plane per component, MCU-padded; cropped to frame size later.
  const planes = sof.comps.map((c) => ({
    comp: c,
    w: mcuW * 8 * c.hi,
    h: mcuH * 8 * c.vi,
    data: new Uint8Array(mcuW * 8 * c.hi * mcuH * 8 * c.vi),
  }));
  const planeOf = new Map(sof.comps.map((c, i) => [c, planes[i]]));

  const dcPrev = new Array(sof.comps.length).fill(0);
  let mcuIndex = 0;
  let segIndex = 0;
  let segBytes = Uint8Array.from(segments[0]);
  let segPos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const fillBits = (n) => {
    while (bitCount < n) {
      if (segPos >= segBytes.length) {
        break;
      }
      bitBuf = (bitBuf << 8) | segBytes[segPos];
      segPos += 1;
      bitCount += 8;
    }
  };
  const getBit = () => {
    fillBits(1);
    if (bitCount < 1) {
      err("JPEG scan data ends mid-block — refusing a truncated input.");
    }
    bitCount -= 1;
    return (bitBuf >> bitCount) & 1;
  };
  const getBits = (n) => {
    if (n === 0) {
      return 0;
    }
    fillBits(n);
    if (bitCount < n) {
      err("JPEG scan data ends mid-block — refusing a truncated input.");
    }
    bitCount -= n;
    return (bitBuf >> bitCount) & ((1 << n) - 1);
  };
  const huffDecode = (table) => {
    let code = 0;
    for (let len = 1; len <= 16; len += 1) {
      code = (code << 1) | getBit();
      const s = table.get(len * 65536 + code);
      if (s !== undefined) {
        return s;
      }
    }
    err("JPEG Huffman code is invalid — refusing a corrupt input.");
    return 0;
  };

  const restart = () => {
    for (let i = 0; i < dcPrev.length; i += 1) {
      dcPrev[i] = 0;
    }
    segIndex += 1;
    if (segIndex >= segments.length) {
      err("JPEG restart overruns the scan segments.");
    }
    segBytes = Uint8Array.from(segments[segIndex]);
    segPos = 0;
    bitBuf = 0;
    bitCount = 0;
  };

  const compOrder = scanComps.map((s) => s);
  for (let mcu = 0; mcu < totalMcus; mcu += 1) {
    if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
      restart();
    }
    const mcuX = mcu % mcuW;
    const mcuY = Math.floor(mcu / mcuW);
    for (const s of compOrder) {
      const plane = planeOf.get(s.comp);
      const q = quant[s.comp.tq];
      const dcTable = huffDC[s.td];
      const acTable = sof.comps.length > 1 ? huffAC[s.ta] : null;
      const compIdx = sof.comps.indexOf(s.comp);
      for (let vy = 0; vy < s.comp.vi; vy += 1) {
        for (let hx = 0; hx < s.comp.hi; hx += 1) {
          const size = huffDecode(dcTable);
          if (size > 11) {
            err("JPEG DC difference size is out of range.");
          }
          let diff = 0;
          if (size > 0) {
            const v = getBits(size);
            diff = v < 1 << (size - 1) ? v + 1 - (1 << size) : v;
          }
          dcPrev[compIdx] += diff;
          const zz = new Array(64).fill(0);
          zz[0] = dcPrev[compIdx];
          if (acTable !== null) {
            let k = 1;
            while (k < 64) {
              const rs = huffDecode(acTable);
              const r = rs >> 4;
              const ss = rs & 15;
              if (ss === 0) {
                if (r === 15) {
                  k += 16;
                } else {
                  break;
                }
              } else {
                k += r;
                if (k >= 64) {
                  err("JPEG block overruns its 64 coefficients.");
                }
                const v = getBits(ss);
                zz[k] = v < 1 << (ss - 1) ? v + 1 - (1 << ss) : v;
                k += 1;
              }
            }
          }
          const coeff = new Array(64);
          for (let i = 0; i < 64; i += 1) {
            coeff[JPEG_ZIGZAG[i]] = zz[i] * q[JPEG_ZIGZAG[i]];
          }
          const spatial = jpegIdctBlock(coeff);
          const baseX = (mcuX * s.comp.hi + hx) * 8;
          const baseY = (mcuY * s.comp.vi + vy) * 8;
          for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 1) {
              let v = Math.round(spatial[y * 8 + x] + 128);
              if (v < 0) {
                v = 0;
              } else if (v > 255) {
                v = 255;
              }
              plane.data[(baseY + y) * plane.w + baseX + x] = v;
            }
          }
        }
      }
    }
    mcuIndex += 1;
  }
  void mcuIndex;

  const { w, h } = sof;
  const rgba = Buffer.alloc(w * h * 4);
  if (sof.comps.length === 1) {
    const g = planes[0];
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const v = g.data[y * g.w + x];
        const dst = (y * w + x) * 4;
        rgba[dst] = v;
        rgba[dst + 1] = v;
        rgba[dst + 2] = v;
        rgba[dst + 3] = 255;
      }
    }
  } else {
    const yPlane = planeOf.get(scanComps[0].comp);
    const cbPlane = planeOf.get(scanComps[1].comp);
    const crPlane = planeOf.get(scanComps[2].comp);
    const sample = (plane, comp, x, y) => {
      const sx = Math.min(plane.w - 1, Math.floor((x * comp.hi) / maxH));
      const sy = Math.min(plane.h - 1, Math.floor((y * comp.vi) / maxV));
      return plane.data[sy * plane.w + sx];
    };
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const yy = sample(yPlane, scanComps[0].comp, x, y);
        const cb = sample(cbPlane, scanComps[1].comp, x, y) - 128;
        const cr = sample(crPlane, scanComps[2].comp, x, y) - 128;
        let r = Math.round(yy + 1.402 * cr);
        let g = Math.round(yy - 0.344136 * cb - 0.714136 * cr);
        let b = Math.round(yy + 1.772 * cb);
        if (r < 0) {
          r = 0;
        } else if (r > 255) {
          r = 255;
        }
        if (g < 0) {
          g = 0;
        } else if (g > 255) {
          g = 255;
        }
        if (b < 0) {
          b = 0;
        } else if (b > 255) {
          b = 255;
        }
        const dst = (y * w + x) * 4;
        rgba[dst] = r;
        rgba[dst + 1] = g;
        rgba[dst + 2] = b;
        rgba[dst + 3] = 255;
      }
    }
  }
  return { w, h, rgba };
}

// Dispatch on magic bytes. JPEG is the contract input; PNG is accepted as a
// documented test seam so unit fixtures never need a JPEG encoder.
function decodeImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) {
    throw stageError("decode", "input is empty — expected a JPEG or PNG image.");
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return decodeJpeg(buf);
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return decodePng(buf);
  }
  throw stageError("decode", "unknown image magic — expected a JPEG or PNG input.");
}

// ---------------------------------------------------------------------------
// Pipeline stages (pure: each takes and returns image objects, never fs).
// Images are { w, h, rgba } with rgba a Buffer of w*h*4 bytes.
// ---------------------------------------------------------------------------

// Chroma key: already-transparent pixels stay transparent (the PNG test
// seam carries real transparency); otherwise pixels within KEY_TOLERANCE of
// #FF00FF go transparent (alpha 0) and everything else goes fully opaque
// (alpha 255). Alpha is only 0/255.
function chromaKey(img) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w <= 0 || img.h <= 0) {
    throw stageError("key", "image has unusable dimensions.");
  }
  if (!img.rgba || img.rgba.length !== img.w * img.h * 4) {
    throw stageError("key", "image buffer length does not match its dimensions.");
  }
  const rgba = Buffer.from(img.rgba);
  for (let i = 0; i < img.w * img.h; i += 1) {
    if (img.rgba[i * 4 + 3] === 0) {
      rgba[i * 4 + 3] = 0;
      continue;
    }
    const dr = rgba[i * 4] - CHROMA[0];
    const dg = rgba[i * 4 + 1] - CHROMA[1];
    const db = rgba[i * 4 + 2] - CHROMA[2];
    rgba[i * 4 + 3] = dr * dr + dg * dg + db * db <= KEY_TOLERANCE_SQ ? 0 : 255;
  }
  return { w: img.w, h: img.h, rgba };
}

// 1px alpha erode (4-neighbourhood): an opaque pixel survives only when its
// up/down/left/right neighbours are all opaque. Eats the magenta fringe the
// key leaves on JPEG-blurred edges. Out-of-frame counts as transparent.
function erodeAlpha(img) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w <= 0 || img.h <= 0) {
    throw stageError("key", "image has unusable dimensions.");
  }
  if (!img.rgba || img.rgba.length !== img.w * img.h * 4) {
    throw stageError("key", "image buffer length does not match its dimensions.");
  }
  const { w, h } = img;
  const src = img.rgba;
  const isOpaque = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) {
      return false;
    }
    return src[(y * w + x) * 4 + 3] !== 0;
  };
  const rgba = Buffer.from(src);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!isOpaque(x, y)) {
        rgba[(y * w + x) * 4 + 3] = 0;
      } else if (!isOpaque(x - 1, y) || !isOpaque(x + 1, y) || !isOpaque(x, y - 1) || !isOpaque(x, y + 1)) {
        rgba[(y * w + x) * 4 + 3] = 0;
      } else {
        rgba[(y * w + x) * 4 + 3] = 255;
      }
    }
  }
  return { w, h, rgba };
}

// Opaque/transparent transitions per axis (positions 1..W-1 / 1..H-1;
// image borders carry no grid information).
function maskTransitions(img) {
  const tx = [];
  const ty = [];
  const { w, h, rgba } = img;
  const opaque = (x, y) => rgba[(y * w + x) * 4 + 3] !== 0;
  for (let y = 0; y < h; y += 1) {
    let prev = opaque(0, y);
    for (let x = 1; x < w; x += 1) {
      const cur = opaque(x, y);
      if (cur !== prev) {
        tx.push(x);
      }
      prev = cur;
    }
  }
  for (let x = 0; x < w; x += 1) {
    let prev = opaque(x, 0);
    for (let y = 1; y < h; y += 1) {
      const cur = opaque(x, y);
      if (cur !== prev) {
        ty.push(y);
      }
      prev = cur;
    }
  }
  return { tx, ty };
}

// Best single-phase support for one axis: the largest count of transitions
// within +-1 (circular) of any phase modulo p. The reported phase is the
// mode residue (most common exact edge position, ties to the smallest):
// erosion insets edges by a pixel, so the window centre can land on removed
// pixels while the mode still marks a surviving object edge — downscale
// samples from the mode and stays on the artwork.
function phaseSupport(transitions, p) {
  if (transitions.length === 0) {
    return { matches: 0, phase: 0 };
  }
  const freq = new Array(p).fill(0);
  for (const t of transitions) {
    freq[((t % p) + p) % p] += 1;
  }
  let best = -1;
  let mode = 0;
  let modeCount = -1;
  for (let phi = 0; phi < p; phi += 1) {
    const n = freq[(phi + p - 1) % p] + freq[phi] + freq[(phi + 1) % p];
    if (n > best) {
      best = n;
    }
    if (freq[phi] > modeCount) {
      modeCount = freq[phi];
      mode = phi;
    }
  }
  return { matches: best, phase: mode };
}

// Score every candidate pitch on one transition set: the largest share of
// transitions within +-1 (circular) of a single phase, plus that phase.
// Strict best wins; exact ties go to the larger pitch so a clean 8-grid
// reports 8 rather than its divisor 4.
function votePitch(tx, ty) {
  const total = tx.length + ty.length;
  let winner = null;
  let bestSupport = -1;
  for (let p = PITCH_MIN; p <= PITCH_MAX; p += 1) {
    const sx = phaseSupport(tx, p);
    const sy = phaseSupport(ty, p);
    const support = total === 0 ? 0 : (sx.matches + sy.matches) / total;
    if (support > bestSupport || (support === bestSupport && winner !== null && p > winner.pitch)) {
      bestSupport = support;
      winner = { pitch: p, phaseX: sx.phase, phaseY: sy.phase };
    }
  }
  return { winner, bestSupport, total };
}

// Detect the pixel pitch (dominant block size). Refuses when no candidate in
// PITCH_MIN..PITCH_MAX explains >=PITCH_SUPPORT of transitions, or when the
// image quadrants vote for different pitches (a spliced sheet whose halves
// sit on different grids has no single pitch even when each half is clean).
// Uniformly alternating widths (6/8 around 7, say) ARE a single pitch by
// the issue's own +-1px definition and are accepted as such; only grids
// that vary by more than 1px — or vary across the frame — are refused.
function detectPitch(img) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w <= 0 || img.h <= 0) {
    throw stageError("pitch", "image has unusable dimensions.");
  }
  if (!img.rgba || img.rgba.length !== img.w * img.h * 4) {
    throw stageError("pitch", "image buffer length does not match its dimensions.");
  }
  const { tx, ty } = maskTransitions(img);
  const total = tx.length + ty.length;
  if (total < PITCH_MIN_TRANSITIONS) {
    throw stageError(
      "pitch",
      `only ${total} mask transitions — cannot measure a pixel pitch.`,
    );
  }
  const { winner, bestSupport } = votePitch(tx, ty);
  // Winner selection scans ascending and keeps the larger pitch on ties, so
  // exact divisors of the true pitch never shadow it (a true 8-grid is also
  // 4-coherent, but 8 explains the same transitions at the coarser grid).
  if (bestSupport < PITCH_SUPPORT) {
    throw stageError(
      "pitch",
      `no stable pitch in ${PITCH_MIN}..${PITCH_MAX} (best ${bestSupport.toFixed(2)} at ${winner.pitch}) — pitch varies by more than 1px.`,
    );
  }
  // Spatial agreement: each quadrant re-votes on its own transitions.
  // Quadrants too sparse, too repetitive (fewer than 20 distinct edge
  // positions fit any large pitch, so their argmax is meaningless), or too
  // noisy to judge abstain; when the voting quadrants split into two camps
  // of >=2 whose pitches differ by more than 1px, the sheet mixes grids and
  // is refused. A lone outlier quadrant is local damage, not a second
  // grid, so 3-vs-1 splits still pass.
  const mx = Math.floor(img.w / 2);
  const my = Math.floor(img.h / 2);
  const opaque = (x, y) => img.rgba[(y * img.w + x) * 4 + 3] !== 0;
  const quadTransitions = (x0, y0, x1, y1) => {
    const qx = [];
    const qy = [];
    for (let y = y0; y < y1; y += 1) {
      let prev = opaque(x0, y);
      for (let x = x0 + 1; x < x1; x += 1) {
        const cur = opaque(x, y);
        if (cur !== prev) {
          qx.push(x - x0);
        }
        prev = cur;
      }
    }
    for (let x = x0; x < x1; x += 1) {
      let prev = opaque(x, y0);
      for (let y = y0 + 1; y < y1; y += 1) {
        const cur = opaque(x, y);
        if (cur !== prev) {
          qy.push(y - y0);
        }
        prev = cur;
      }
    }
    return { qx, qy };
  };
  const votes = [];
  for (const [x0, y0, x1, y1] of [[0, 0, mx, my], [mx, 0, img.w, my], [0, my, mx, img.h], [mx, my, img.w, img.h]]) {
    if (x1 - x0 < 2 || y1 - y0 < 2) {
      continue;
    }
    const { qx, qy } = quadTransitions(x0, y0, x1, y1);
    const n = qx.length + qy.length;
    if (n < PITCH_QUAD_MIN_TRANSITIONS) {
      continue;
    }
    if (new Set([...qx, ...qy]).size < PITCH_QUAD_MIN_DISTINCT) {
      continue;
    }
    const qv = votePitch(qx, qy);
    if (qv.bestSupport >= PITCH_QUAD_MIN_SUPPORT) {
      votes.push(qv.winner.pitch);
    }
  }
  if (votes.length >= 3) {
    const sorted = votes.slice().sort((a, b) => a - b);
    let gapAt = -1;
    let gapSize = -1;
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const gap = sorted[i + 1] - sorted[i];
      if (gap > gapSize) {
        gapSize = gap;
        gapAt = i;
      }
    }
    const left = gapAt + 1;
    const right = sorted.length - left;
    if (gapSize > 1 && left >= 2 && right >= 2) {
      throw stageError(
        "pitch",
        `quadrants disagree (pitches ${sorted.join(", ")}) — pitch varies by more than 1px across the image.`,
      );
    }
  }
  return { pitch: winner.pitch, phaseX: winner.phaseX, phaseY: winner.phaseY };
}

// Integer downscale by the pitch, nearest-neighbour: output pixel (i, j) is
// the top-left pixel of grid cell (phase + i*p, phase + j*p).
function downscaleNearest(img, pitch, phaseX = 0, phaseY = 0) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w <= 0 || img.h <= 0) {
    throw stageError("downscale", "image has unusable dimensions.");
  }
  if (!Number.isInteger(pitch) || pitch <= 0) {
    throw stageError("downscale", `pitch ${pitch} is not a positive integer.`);
  }
  if (!Number.isInteger(phaseX) || phaseX < 0 || !Number.isInteger(phaseY) || phaseY < 0) {
    throw stageError("downscale", `phase (${phaseX}, ${phaseY}) is out of range.`);
  }
  const outW = Math.ceil((img.w - phaseX) / pitch);
  const outH = Math.ceil((img.h - phaseY) / pitch);
  if (outW <= 0 || outH <= 0) {
    throw stageError("downscale", `phase (${phaseX}, ${phaseY}) is outside the ${img.w}x${img.h} image.`);
  }
  const rgba = Buffer.alloc(outW * outH * 4);
  for (let j = 0; j < outH; j += 1) {
    for (let i = 0; i < outW; i += 1) {
      const sx = Math.min(img.w - 1, phaseX + i * pitch);
      const sy = Math.min(img.h - 1, phaseY + j * pitch);
      const src = (sy * img.w + sx) * 4;
      const dst = (j * outW + i) * 4;
      rgba[dst] = img.rgba[src];
      rgba[dst + 1] = img.rgba[src + 1];
      rgba[dst + 2] = img.rgba[src + 2];
      rgba[dst + 3] = img.rgba[src + 3];
    }
  }
  return { w: outW, h: outH, rgba };
}

// Quantise to the twelve palette colours (nearest in squared RGB),
// dithering off: each pixel maps independently, so flat regions stay flat.
// Transparent pixels collapse to (0,0,0,0) so the PNG-8 writer needs exactly
// one transparent palette entry.
function quantiseNearest(img) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w <= 0 || img.h <= 0) {
    throw stageError("quantise", "image has unusable dimensions.");
  }
  if (!img.rgba || img.rgba.length !== img.w * img.h * 4) {
    throw stageError("quantise", "image buffer length does not match its dimensions.");
  }
  const rgba = Buffer.alloc(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i += 1) {
    const src = i * 4;
    if (img.rgba[src + 3] === 0) {
      rgba[src] = 0;
      rgba[src + 1] = 0;
      rgba[src + 2] = 0;
      rgba[src + 3] = 0;
      continue;
    }
    const r = img.rgba[src];
    const g = img.rgba[src + 1];
    const b = img.rgba[src + 2];
    let best = 0;
    let bestDist = Infinity;
    for (let k = 0; k < PALETTE_12.length; k += 1) {
      const dr = r - PALETTE_12[k][0];
      const dg = g - PALETTE_12[k][1];
      const db = b - PALETTE_12[k][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = k;
      }
    }
    rgba[src] = PALETTE_12[best][0];
    rgba[src + 1] = PALETTE_12[best][1];
    rgba[src + 2] = PALETTE_12[best][2];
    rgba[src + 3] = 255;
  }
  return { w: img.w, h: img.h, rgba };
}

// Bounding box of opaque pixels. Refuses the empty (fully keyed) image.
function boundingBox(img) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w <= 0 || img.h <= 0) {
    throw stageError("crop", "image has unusable dimensions.");
  }
  if (!img.rgba || img.rgba.length !== img.w * img.h * 4) {
    throw stageError("crop", "image buffer length does not match its dimensions.");
  }
  let minX = img.w;
  let minY = img.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.h; y += 1) {
    for (let x = 0; x < img.w; x += 1) {
      if (img.rgba[(y * img.w + x) * 4 + 3] !== 0) {
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }
  if (maxX < 0) {
    throw stageError("crop", "image has no opaque pixels — nothing to slice.");
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function cropImage(img, rect) {
  if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y) ||
    !Number.isInteger(rect.w) || !Number.isInteger(rect.h) ||
    rect.w <= 0 || rect.h <= 0 ||
    rect.x < 0 || rect.y < 0 ||
    rect.x + rect.w > img.w || rect.y + rect.h > img.h) {
    throw stageError("crop", `crop ${JSON.stringify(rect)} is outside the ${img.w}x${img.h} image.`);
  }
  const rgba = Buffer.alloc(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y += 1) {
    const src = ((rect.y + y) * img.w + rect.x) * 4;
    img.rgba.copy(rgba, y * rect.w * 4, src, src + rect.w * 4);
  }
  return { w: rect.w, h: rect.h, rgba };
}

// Split the image into cols x rows equal rectangles (row-major). An uneven
// split refuses instead of slicing fractional cells.
function cropCells(img, cols, rows) {
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
    throw stageError("crop", `--cells ${cols}x${rows} must be positive integers.`);
  }
  if (img.w % cols !== 0 || img.h % rows !== 0) {
    throw stageError(
      "crop",
      `--cells ${cols}x${rows} does not divide the ${img.w}x${img.h} image into equal rectangles.`,
    );
  }
  const cellW = img.w / cols;
  const cellH = img.h / rows;
  const cells = [];
  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells.push({
        index,
        x: c * cellW,
        y: r * cellH,
        img: cropImage(img, { x: c * cellW, y: r * cellH, w: cellW, h: cellH }),
      });
      index += 1;
    }
  }
  return cells;
}

// Pad to the requested logical size, centred, never scaling: content plus
// 2*border must fit, otherwise refuse.
function padCanvas(img, sizeW, sizeH, border = 0) {
  if (!Number.isInteger(sizeW) || sizeW <= 0 || !Number.isInteger(sizeH) || sizeH <= 0) {
    throw stageError("pad", `--size ${sizeW}x${sizeH} must be positive integers.`);
  }
  if (!Number.isInteger(border) || border < 0) {
    throw stageError("pad", `--border ${border} must be a non-negative integer.`);
  }
  if (img.w + 2 * border > sizeW || img.h + 2 * border > sizeH) {
    throw stageError(
      "pad",
      `content ${img.w}x${img.h} plus border ${border} does not fit --size ${sizeW}x${sizeH} — refusing to scale.`,
    );
  }
  const rgba = Buffer.alloc(sizeW * sizeH * 4, 0);
  const dx = Math.floor((sizeW - img.w) / 2);
  const dy = Math.floor((sizeH - img.h) / 2);
  for (let y = 0; y < img.h; y += 1) {
    const src = (y * img.w) * 4;
    const dst = ((dy + y) * sizeW + dx) * 4;
    img.rgba.copy(rgba, dst, src, src + img.w * 4);
  }
  return { w: sizeW, h: sizeH, rgba };
}

// Encode a quantised image as PNG-8: color type 3 with a PLTE of at most 13
// entries (transparent first when present, then opaque colours sorted
// numerically so output is deterministic) plus per-index tRNS, fixed
// filter-0 rows, single deflateSync pass.
function encodePng8(img) {
  if (!img || !Number.isInteger(img.w) || !Number.isInteger(img.h) || img.w <= 0 || img.h <= 0) {
    throw stageError("emit", "image has unusable dimensions.");
  }
  if (!img.rgba || img.rgba.length !== img.w * img.h * 4) {
    throw stageError("emit", "image buffer length does not match its dimensions.");
  }
  let hasTransparent = false;
  const opaqueSet = new Set();
  for (let i = 0; i < img.w * img.h; i += 1) {
    const a = img.rgba[i * 4 + 3];
    if (a === 0) {
      hasTransparent = true;
    } else {
      opaqueSet.add((img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2]);
    }
  }
  const opaque = Array.from(opaqueSet).sort((a, b) => a - b);
  if (opaque.length > 12) {
    throw stageError("emit", `image uses ${opaque.length} opaque colours — quantise to the twelve-colour palette first.`);
  }
  const entries = [];
  const trns = [];
  const indexOf = new Map();
  if (hasTransparent) {
    entries.push([0, 0, 0]);
    trns.push(0);
    indexOf.set(-1, 0);
  }
  for (const c of opaque) {
    indexOf.set(c, entries.length);
    entries.push([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]);
    trns.push(255);
  }
  const indices = Buffer.alloc(img.w * img.h);
  for (let i = 0; i < img.w * img.h; i += 1) {
    if (img.rgba[i * 4 + 3] === 0) {
      indices[i] = indexOf.get(-1);
    } else {
      const c = (img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2];
      const idx = indexOf.get(c);
      if (idx === undefined) {
        throw stageError("emit", "image holds a colour outside its palette — quantise first.");
      }
      indices[i] = idx;
    }
  }
  const rawRows = Buffer.alloc((img.w + 1) * img.h);
  for (let y = 0; y < img.h; y += 1) {
    rawRows[y * (img.w + 1)] = 0;
    indices.copy(rawRows, y * (img.w + 1) + 1, y * img.w, (y + 1) * img.w);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  ihdr[12] = 0;
  const plte = Buffer.from(entries.flat());
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", plte),
    pngChunk("tRNS", Buffer.from(trns)),
    pngChunk("IDAT", zlib.deflateSync(rawRows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Total bytes under a directory (missing dir weighs 0). Tolerant walker,
// mirroring tools/check-budget.js.
function sizeBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += sizeBytes(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    } catch {
      // Unreadable entry: skip instead of failing the gate.
    }
  }
  return total;
}

function readJsonDoc(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      throw stageError("emit", `${file} does not hold a JSON object — refusing to merge.`);
    }
    return doc;
  } catch (err) {
    if (err && typeof err.message === "string" && err.message.startsWith("slice-sheet:")) {
      throw err;
    }
    throw stageError("emit", `cannot parse ${file}: ${err.message}`);
  }
}

// Emit PNG-8 files plus manifest/atlas entries. Refuses BEFORE writing when
// the atlas dir plus the new PNGs would exceed the 6 MB budget. Returns the
// written asset summaries.
function emitAssets({ id, items, atlasDir }) {
  const lower = String(id).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(lower)) {
    throw stageError("emit", `id ${JSON.stringify(id)} must match [A-Za-z0-9][A-Za-z0-9-]*.`);
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw stageError("emit", "nothing to emit — the crop stage produced no assets.");
  }
  const dir = atlasDir || DEFAULT_ATLAS_DIR;
  const uiDir = path.join(dir, "ui");
  const manifestPath = path.join(dir, "manifest.json");
  const atlasPath = path.join(dir, "ui.json");

  const files = items.map((item) => {
    const name = `${lower}${item.suffix ? `.${item.suffix}` : ""}.png`;
    return { key: `ui.${lower}${item.suffix ? `.${item.suffix}` : ""}`, file: `ui/${name}`, buf: encodePng8(item.img), img: item.img };
  });

  // Budget before writing: existing atlas bytes (minus files about to be
  // replaced) plus the new PNGs must fit the cap.
  let current = sizeBytes(dir);
  for (const f of files) {
    try {
      if (fs.existsSync(path.join(dir, f.file))) {
        current -= fs.statSync(path.join(dir, f.file)).size;
      }
    } catch {
      // Stat failure: keep the conservative (larger) total.
    }
  }
  const added = files.reduce((a, f) => a + f.buf.length, 0);
  if (current + added > BUDGET_BYTES) {
    throw stageError(
      "emit",
      `atlas budget exceeded: ${current + added} bytes > ${BUDGET_BYTES} bytes — refusing to write.`,
    );
  }

  fs.mkdirSync(uiDir, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f.file), f.buf);
  }

  const manifest = readJsonDoc(manifestPath, {});
  for (const f of files) {
    manifest[f.key] = { file: f.file, atlas: "ui.json", w: f.img.w, h: f.img.h };
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const atlas = readJsonDoc(atlasPath, { meta: { app: "scrapline", version: 1, family: "ui" }, frames: {} });
  if (atlas.frames === null || typeof atlas.frames !== "object" || Array.isArray(atlas.frames)) {
    throw stageError("emit", `${atlasPath} has no frames object — refusing to merge.`);
  }
  for (const f of files) {
    atlas.frames[f.key] = { file: f.file, x: 0, y: 0, w: f.img.w, h: f.img.h };
  }
  fs.writeFileSync(atlasPath, JSON.stringify(atlas, null, 2) + "\n");

  return files.map((f) => ({ key: f.key, file: f.file, w: f.img.w, h: f.img.h }));
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(
    [
      "usage: node tools/slice-sheet.js --input <jpg> --id <prompt-id> [--cells WxH] [--size WxH] [--border N]",
      "",
      "  --input <jpg>   reference JPEG (flat #FF00FF background) — required",
      "  --id <id>       prompt id (e.g. CH-01); output uses the lowercased id — required",
      "  --cells WxH     slice one asset per equal cell (row-major ui.<id>.<nn>)",
      "  --size WxH      logical output size (default: cropped size; never scales to fit)",
      "  --border N      minimum transparent margin inside --size (default: 0)",
      "  --help          print this text and exit 0",
      "",
      "Pipeline: key -> pitch -> downscale -> quantise -> crop -> pad -> emit.",
      "Failures exit nonzero as slice-sheet:<stage>: <detail>.",
    ].join("\n"),
  );
}

function parseCellsFlag(value) {
  const m = /^(\d+)x(\d+)$/.exec(String(value));
  if (m === null) {
    throw stageError("crop", `--cells ${JSON.stringify(value)} must look like WxH (e.g. 3x2).`);
  }
  const cols = Number(m[1]);
  const rows = Number(m[2]);
  if (cols < 1 || rows < 1) {
    throw stageError("crop", `--cells ${JSON.stringify(value)} must be positive integers.`);
  }
  return { cols, rows };
}

function parseSizeFlag(value) {
  const m = /^(\d+)x(\d+)$/.exec(String(value));
  if (m === null) {
    throw stageError("pad", `--size ${JSON.stringify(value)} must look like WxH (e.g. 128x128).`);
  }
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < 1 || h < 1) {
    throw stageError("pad", `--size ${JSON.stringify(value)} must be positive integers.`);
  }
  return { w, h };
}

function parseBorderFlag(value) {
  if (!/^\d+$/.test(String(value))) {
    throw stageError("pad", `--border ${JSON.stringify(value)} must be a non-negative integer.`);
  }
  return Number(value);
}

function fail(err) {
  const message = err && typeof err.message === "string" && err.message.startsWith("slice-sheet:")
    ? err.message
    : `slice-sheet:decode: ${err && err.message ? err.message : String(err)}`;
  console.error(message);
  process.exit(1);
}

function runStage(stage, fn) {
  try {
    return fn();
  } catch (err) {
    if (err && typeof err.message === "string" && err.message.startsWith("slice-sheet:")) {
      throw err;
    }
    throw stageError(stage, err && err.message ? err.message : String(err));
  }
}

function main(argv) {
  let input = null;
  let id = null;
  let cells = null;
  let size = null;
  let border = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printUsage();
      return;
    } else if (a === "--input") {
      input = argv[i + 1] === undefined ? null : argv[i + 1];
      i += 1;
    } else if (a === "--id") {
      id = argv[i + 1] === undefined ? null : argv[i + 1];
      i += 1;
    } else if (a === "--cells") {
      const v = argv[i + 1];
      i += 1;
      try {
        cells = parseCellsFlag(v);
      } catch (err) {
        fail(err);
      }
    } else if (a === "--size") {
      const v = argv[i + 1];
      i += 1;
      try {
        size = parseSizeFlag(v);
      } catch (err) {
        fail(err);
      }
    } else if (a === "--border") {
      const v = argv[i + 1];
      i += 1;
      try {
        border = parseBorderFlag(v);
      } catch (err) {
        fail(err);
      }
    } else {
      fail(stageError("decode", `unknown argument ${JSON.stringify(a)} — see --help.`));
    }
  }

  if (input === null) {
    fail(stageError("decode", "--input <jpg> is required — see --help."));
  }
  if (id === null) {
    fail(stageError("emit", "--id <prompt-id> is required — see --help."));
  }

  let raw;
  try {
    raw = fs.readFileSync(input);
  } catch (err) {
    fail(stageError("decode", `cannot read input ${input}: ${err.message}`));
  }

  const decoded = runStage("decode", () => decodeImage(raw));
  const keyed = runStage("key", () => erodeAlpha(chromaKey(decoded)));
  const found = runStage("pitch", () => detectPitch(keyed));
  const down = runStage("downscale", () => downscaleNearest(keyed, found.pitch, found.phaseX, found.phaseY));
  const quant = runStage("quantise", () => quantiseNearest(down));
  const crops = runStage("crop", () => {
    if (cells !== null) {
      return cropCells(quant, cells.cols, cells.rows).map((c) => ({
        suffix: String(c.index).padStart(2, "0"),
        img: c.img,
      }));
    }
    const box = boundingBox(quant);
    return [{ suffix: "", img: cropImage(quant, box) }];
  });
  const padded = runStage("pad", () => crops.map((c) => ({
    suffix: c.suffix,
    img: padCanvas(c.img, size === null ? c.img.w : size.w, size === null ? c.img.h : size.h, border),
  })));
  const atlasDir = process.env.SLICE_SHEET_ATLAS_DIR || DEFAULT_ATLAS_DIR;
  const written = runStage("emit", () => emitAssets({ id, items: padded, atlasDir }));
  for (const w of written) {
    console.log(`slice-sheet: ${w.key} -> ${w.file} (${w.w}x${w.h}, pitch ${found.pitch})`);
  }
}

// Guarded so tests can require this file for the pure stages without
// slicing: requiring it only defines helpers, running it slices.
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    fail(err);
  }
}

module.exports = {
  votePitch,
  crc32,
  PALETTE_12,
  CHROMA,
  KEY_TOLERANCE,
  BUDGET_BYTES,
  PITCH_MIN,
  PITCH_MAX,
  PITCH_SUPPORT,
  decodeImage,
  decodePng,
  decodeJpeg,
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
  sizeBytes,
  emitAssets,
};
