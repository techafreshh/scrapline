// Full-green gate (#161): the issue's "full probe suite + assets" lap.
// Spawns `npm test` with inherited stdio (exit code must be 0), then
// recomputes the dist/assets recursive byte sum with the asset-pipeline
// sizeBytes idiom and asserts it stays within the 6 MB budget. Stays out
// of `npm test` and CI by construction (it drives them, like
// verify-presentation drives the browser).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const DIST_ASSETS = path.join(ROOT, "packages", "client", "dist", "assets");
// 6 MB asset budget (the tests/asset-pipeline.test.js BUDGET_BYTES twin).
const BUDGET_BYTES = 6291456;

function log(message) {
  console.log(`[verify-full] ${message}`);
}

function fail(message) {
  console.error(`[verify-full] FAIL: ${message}`);
  throw new Error(message);
}

/** Recursive byte sum of every file under dir (asset-pipeline idiom). */
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

function run() {
  log("running `npm test` (full probe suite)...");
  const result = spawnSync("npm", ["test"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail(`\`npm test\` exited with code ${result.status}`);
  }
  log("`npm test` passed (exit 0)");
  const bytes = sizeBytes(DIST_ASSETS);
  if (bytes > BUDGET_BYTES) {
    fail(`dist assets are ${bytes} bytes, expected <= ${BUDGET_BYTES}`);
  }
  log(`dist assets ${bytes} bytes <= ${BUDGET_BYTES} (6 MB budget)`);
  log("ALL GREEN: full probe suite + assets passed");
}

try {
  run();
} catch (err) {
  if (process.exitCode === 0) {
    process.exitCode = 1;
  }
  console.error(`[verify-full] ${err && err.message ? err.message : err}`);
}
