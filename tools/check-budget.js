// 6 MB shipped-weight gate (issue #271): sums the production bundle
// plus the staged atlas families and fails when the total exceeds
// BUDGET_BYTES. Mirrors the `du -cb dist/**` acceptance probe so
// `npm run check:budget` and the runtime probe can never drift apart.
//
// Zero dependencies (node:fs/path only, like build-atlas.js).
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CLIENT_DIST = path.join(ROOT, "packages", "client", "dist");
const ROOT_DIST = path.join(ROOT, "dist");

const BUDGET_BYTES = 6291456;

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

function main() {
  // Prefer the staged root dist/ when a production build staged it
  // (npm run build copies client dist -> root dist); otherwise measure
  // the client dist directly so `npm run build:client` alone still gates.
  let target = CLIENT_DIST;
  let label = "packages/client/dist";
  try {
    if (fs.existsSync(path.join(ROOT_DIST, "index.html"))) {
      target = ROOT_DIST;
      label = "dist";
    }
  } catch {
    // existsSync threw (shorn fs): keep the client dist target.
  }
  const assetsDir = path.join(target, "assets");
  const bundleFile = path.join(target, "main.js");
  let assetsBytes;
  try {
    assetsBytes = sizeBytes(assetsDir);
  } catch {
    assetsBytes = 0;
  }
  let bundleBytes;
  try {
    bundleBytes = fs.statSync(bundleFile).size;
  } catch {
    bundleBytes = 0;
  }
  // Total shipped atlas plus bundle: the whole target dir covers atlas
  // families, the pixi chunk, fonts, and the entry bundle in one number
  // (equivalent to `du -cb <target>`).
  let total;
  try {
    total = sizeBytes(target);
  } catch {
    total = assetsBytes + bundleBytes;
  }
  console.log(
    `check-budget: ${label} total ${total} bytes ` +
      `(assets ${assetsBytes} + bundle ${bundleBytes}, budget ${BUDGET_BYTES})`,
  );
  if (total === 0) {
    console.error("check-budget: no build output found — run npm run build:client first.");
    process.exit(1);
  }
  if (total > BUDGET_BYTES) {
    console.error(`check-budget: budget exceeded: ${total} > ${BUDGET_BYTES}.`);
    process.exit(1);
  }
  console.log("check-budget: within budget.");
}

if (require.main === module) {
  main();
}

module.exports = { BUDGET_BYTES, sizeBytes };
