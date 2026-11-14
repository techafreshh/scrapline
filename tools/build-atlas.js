// Ingest the CC0 vector sprites into the web bundle's Pixi atlas index.
//
// Zero dependencies (node:fs/path only, like server.js): resolves
// packages/client/assets, copies the hand-authored *.svg sources into
// packages/client/dist/assets/, writes packages/client/dist/assets/atlas.json
// (a multi-sprite index of { meta, frames } the client preloads behind the
// loading screen), then enforces the 6 MB total-asset budget. Anything over
// budget exits nonzero so the build fails loudly instead of shipping bloat.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "packages", "client", "assets");
const DEST = path.join(ROOT, "packages", "client", "dist", "assets");
const ATLAS = path.join(DEST, "atlas.json");

// Total built assets must stay at or under 6 MB (the presentation-v2
// bundle-risk cap); the check sums every byte under dist/assets.
const BUDGET_BYTES = 6291456;

function fail(message) {
  console.error(`build-atlas: ${message}`);
  process.exit(1);
}

// Frame box in px, parsed from the svg root width/height (or viewBox when
// the pixel attrs are absent). Unknown shapes fall back to 32x32.
function frameSize(svg) {
  const attr = (name) => {
    const match = new RegExp(`${name}\\s*=\\s*"([\\d.]+)"`).exec(svg);
    return match !== null ? Number(match[1]) : NaN;
  };
  const w = attr("width");
  const h = attr("height");
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { w: Math.floor(w), h: Math.floor(h) };
  }
  const viewBox = /viewBox\s*=\s*"([\d.\s-]+)"/.exec(svg);
  if (viewBox !== null) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { w: Math.floor(parts[2]), h: Math.floor(parts[3]) };
    }
  }
  return { w: 32, h: 32 };
}

function sizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sizeBytes(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function main() {
  let names;
  try {
    names = fs.readdirSync(SRC).filter((name) => name.endsWith(".svg"));
  } catch {
    fail(`missing ${SRC} — add the CC0 *.svg sources first.`);
  }
  if (names.length === 0) {
    fail(`no *.svg sources in ${SRC} — nothing to ingest.`);
  }
  fs.mkdirSync(DEST, { recursive: true });
  const frames = {};
  for (const name of names.sort()) {
    const body = fs.readFileSync(path.join(SRC, name), "utf8");
    if (!/<svg[\s>]/.test(body)) {
      fail(`${name} is not a valid SVG root — refusing to index it.`);
    }
    fs.copyFileSync(path.join(SRC, name), path.join(DEST, name));
    const base = name.slice(0, -".svg".length);
    const { w, h } = frameSize(body);
    frames[base] = { file: name, w, h };
  }
  const index = { meta: { app: "scrapline", version: 1 }, frames };
  fs.writeFileSync(ATLAS, JSON.stringify(index, null, 2) + "\n");
  const bytes = sizeBytes(DEST);
  console.log(
    `build-atlas: ingested ${names.length} sprites -> ${ATLAS} (${(bytes / 1048576).toFixed(2)} MB)`,
  );
  if (bytes > BUDGET_BYTES) {
    fail(`asset budget exceeded: ${bytes} bytes > ${BUDGET_BYTES} bytes.`);
  }
}

// Guarded so tests can require this file for frameSize without ingesting:
// requiring it only defines helpers, running it copies and indexes.
if (require.main === module) {
  main();
}

module.exports = { frameSize, BUDGET_BYTES };
