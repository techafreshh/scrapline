// License compliance gate (issue #262): every runtime-used vendor pack
// needs an attribution row in root LICENSES.md, and zero non-CC0 or
// audio files may ship under packages/client/assets/vendor/. Zero
// dependencies (node:fs/path/os only, like tools/build-atlas.js): used
// packs derive from the atlas allowlist's `from` vendor prefixes, the
// single source of truth exported by tools/build-atlas.js.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LICENSES_FILE = path.join(ROOT, "LICENSES.md");

// Runtime-shippable vendor extensions only: PNG art, Kenney license
// notes, and Tiled map sources. Anything else (notably *.mp3 audio)
// fails the gate loudly instead of shipping unlicensed weight.
const ALLOWED_EXTENSIONS = new Set([".png", ".txt", ".tmx", ".tsx"]);

// Top segment of each allowlist `from` path: "platformer-characters" in
// "platformer-characters/PNG/Soldier/Poses/soldier_idle.png".
function usedPacksFromAllowlist(allowlist) {
  const packs = new Set();
  for (const entry of allowlist) {
    const top = String(entry.from).split("/")[0];
    if (top) {
      packs.add(top);
    }
  }
  return [...packs].sort();
}

// Every committed pack: the top-level subdirs of vendor/. Staged but
// atlas-unused packs are still shipped bytes needing attribution, so
// row coverage is required for all of them (a superset of used packs).
function packsInVendor(vendorDir) {
  return fs
    .readdirSync(vendorDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Each pack must appear as a backticked `pack` row string in the root
// LICENSES.md text; anything missing fails with a LICENSES.md message.
function missingLicenseRows(licensesText, packs) {
  const missing = [];
  for (const pack of packs) {
    if (!licensesText.includes(`\`${pack}\``)) {
      missing.push(
        `check-licenses: LICENSES.md is missing an attribution row for vendor pack \`${pack}\`.`,
      );
    }
  }
  return missing;
}

function listFilesRecursive(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

// Fails vendor files with extensions outside the shippable set, and
// fails any pack dir whose License* file lacks a case-insensitive CC0
// marker (an unattributed or non-CC0 pack must fail, never ship).
function scanVendorTree(vendorDir) {
  const failures = [];
  for (const file of listFilesRecursive(vendorDir)) {
    const ext = path.extname(file).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      failures.push(
        `check-licenses: LICENSES.md gate rejects ${path.relative(vendorDir, file)} — extension ${ext || "(none)"} is not runtime-shippable under vendor/.`,
      );
    }
  }
  for (const entry of fs.readdirSync(vendorDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packDir = path.join(vendorDir, entry.name);
    const licenseNames = fs
      .readdirSync(packDir)
      .filter((name) => /^license/i.test(name));
    if (licenseNames.length === 0) {
      failures.push(
        `check-licenses: LICENSES.md gate rejects \`${entry.name}\` — no License* file with a CC0 marker found.`,
      );
      continue;
    }
    const marked = licenseNames.some((name) => {
      const body = fs.readFileSync(path.join(packDir, name), "utf8");
      return /cc0/i.test(body);
    });
    if (!marked) {
      failures.push(
        `check-licenses: LICENSES.md gate rejects \`${entry.name}\` — License* file lacks a CC0 marker (non-CC0 bytes must not ship).`,
      );
    }
  }
  return failures;
}

// Full gate over a repo root: row coverage for every committed vendor
// pack (superset of the atlas-used packs) plus the vendor extension
// and CC0-marker scan. Every failure string contains LICENSES.md.
function checkLicenses(root) {
  const failures = [];
  const vendorDir = path.join(root, "packages", "client", "assets", "vendor");
  const licensesFile = path.join(root, "LICENSES.md");
  let licensesText;
  try {
    licensesText = fs.readFileSync(licensesFile, "utf8");
  } catch {
    failures.push(
      "check-licenses: LICENSES.md is missing — add one attribution row per vendor pack.",
    );
    return { ok: false, failures };
  }
  let packs;
  try {
    packs = packsInVendor(vendorDir);
  } catch {
    failures.push(
      "check-licenses: LICENSES.md gate cannot read packages/client/assets/vendor/ — stage the CC0 vendor packs first.",
    );
    return { ok: false, failures };
  }
  failures.push(...missingLicenseRows(licensesText, packs));
  failures.push(...scanVendorTree(vendorDir));
  return { ok: failures.length === 0, failures };
}

// Guarded so tests can require this file for its pure helpers without
// running the gate: requiring it only defines helpers, running it
// checks the tree and exits nonzero on any failure.
if (require.main === module) {
  const { ATLAS_ALLOWLIST } = require("./build-atlas.js");
  const licensesText = fs.readFileSync(LICENSES_FILE, "utf8");
  const usedFailures = missingLicenseRows(licensesText, usedPacksFromAllowlist(ATLAS_ALLOWLIST));
  const { failures } = checkLicenses(ROOT);
  const all = [...failures];
  for (const failure of usedFailures) {
    if (!all.includes(failure)) {
      all.push(failure);
    }
  }
  if (all.length > 0) {
    for (const failure of all) {
      console.error(failure);
    }
    process.exit(1);
  }
  console.log(
    "check-licenses: LICENSES.md covers every committed vendor pack; vendor tree is CC0-only.",
  );
}

module.exports = {
  ALLOWED_EXTENSIONS,
  usedPacksFromAllowlist,
  packsInVendor,
  missingLicenseRows,
  scanVendorTree,
  checkLicenses,
};
