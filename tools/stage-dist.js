// Stage the client Vite bundle to the repo-root dist/ for static hosting.
//
// Zero dependencies (node:fs/path only, like server.js): resolves
// packages/client/dist, fails fast when the bundle is missing or stale,
// wipes root dist/, copies the web artifacts (skipping TypeScript compiler
// byproducts such as *.d.ts and *.tsbuildinfo), then logs the staged size so
// `npm run build` visibly proves the <50MB static-hosting budget.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "packages", "client", "dist");
const DEST = path.join(ROOT, "dist");

function fail(message) {
  console.error(`stage-dist: ${message}`);
  process.exit(1);
}

// Never stage TypeScript compiler byproducts: the client tsc project emits
// declarations only, so *.d.ts and *.tsbuildinfo must never leak into the
// staged web bundle even if a tsconfig ever points the emit back at dist.
function shouldStageFile(name) {
  return !name.endsWith(".d.ts") && !name.endsWith(".tsbuildinfo");
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

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else if (entry.isFile()) {
      if (!shouldStageFile(entry.name)) {
        continue;
      }
      fs.copyFileSync(from, to);
    }
  }
}

function main() {
  const builtIndex = path.join(SRC, "index.html");
  let index;
  try {
    index = fs.readFileSync(builtIndex, "utf8");
  } catch {
    fail(
      `missing ${builtIndex} — run \`npm run build:client\` first so there is a bundle to stage.`,
    );
  }
  if (!index.includes("Play vs bots")) {
    fail(`${builtIndex} lacks the "Play vs bots" menu — refusing to stage a stale bundle.`);
  }

  fs.rmSync(DEST, { recursive: true, force: true });
  copyTree(SRC, DEST);
  const bytes = sizeBytes(DEST);
  console.log(
    `stage-dist: staged ${SRC} -> ${DEST} (${(bytes / 1048576).toFixed(2)} MB)`,
  );
}

// Guarded so tests can require this file for shouldStageFile without
// staging a bundle: requiring it only defines helpers, running it stages.
if (require.main === module) {
  main();
}

module.exports = { shouldStageFile };
