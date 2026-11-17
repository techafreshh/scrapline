// License compliance gate (issue #262): root LICENSES.md must carry
// one attribution row per vendor pack referenced by the atlas manifest,
// and zero non-CC0 or audio files may ship under vendor/. Real-tree
// tests assert the clean tree passes; temp-fixture tests prove the
// gate fails loudly (exit path: a failure containing LICENSES) when a
// pack row is removed, an *.mp3 lands in vendor/, or a License* file
// loses its CC0 marker.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const {
  usedPacksFromAllowlist,
  packsInVendor,
  missingLicenseRows,
  scanVendorTree,
  checkLicenses,
} = require("../tools/check-licenses.js");
const { ATLAS_ALLOWLIST } = require("../tools/build-atlas.js");

const VENDOR = path.join(ROOT, "packages", "client", "assets", "vendor");
const ACCEPTANCE_FAMILIES = [
  "platformer-characters",
  "pixel-platformer",
  "particle-pack",
  "ui-pack-pixel-adventure",
];

test("LICENSES.md contains a row string for each pack in the manifest", () => {
  const licensesText = fs.readFileSync(path.join(ROOT, "LICENSES.md"), "utf8");
  for (const pack of ACCEPTANCE_FAMILIES) {
    assert.ok(
      licensesText.includes(`\`${pack}\``),
      `LICENSES.md must contain a row string for \`${pack}\``,
    );
  }
  const used = usedPacksFromAllowlist(ATLAS_ALLOWLIST);
  assert.deepEqual(missingLicenseRows(licensesText, used), []);
});

test("clean tree passes the license gate with zero *.mp3 files", () => {
  const { ok, failures } = checkLicenses(ROOT);
  assert.deepEqual(failures, [], `expected a clean gate, got: ${failures.join("; ")}`);
  assert.equal(ok, true);
  const mp3s = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mp3")) {
        mp3s.push(full);
      }
    }
  };
  walk(VENDOR);
  assert.deepEqual(mp3s, [], "zero *.mp3 files may ship under vendor/");
});

test("every License* file under vendor mentions CC0", () => {
  for (const pack of packsInVendor(VENDOR)) {
    const names = fs
      .readdirSync(path.join(VENDOR, pack))
      .filter((name) => /^license/i.test(name));
    assert.ok(names.length >= 1, `\`${pack}\` needs a License* file`);
    const marked = names.some((name) =>
      /cc0/i.test(fs.readFileSync(path.join(VENDOR, pack, name), "utf8")),
    );
    assert.ok(marked, `\`${pack}\` License* file must mention CC0`);
  }
});

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "licenses-"));
  const vendor = path.join(root, "packages", "client", "assets", "vendor");
  const packDir = path.join(vendor, "platformer-characters");
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, "sprite.png"), "png-bytes");
  fs.writeFileSync(
    path.join(packDir, "License.txt"),
    "License (Creative Commons Zero, CC0)",
  );
  fs.writeFileSync(
    path.join(root, "LICENSES.md"),
    "| `platformer-characters` | Kenney | CC0 1.0 |\n",
  );
  return { root, vendor, packDir };
}

test("a vendor pack removed from LICENSES.md coverage fails the gate", () => {
  const { root } = makeFixture();
  try {
    fs.writeFileSync(path.join(root, "LICENSES.md"), "no pack rows here\n");
    const { ok, failures } = checkLicenses(root);
    assert.equal(ok, false);
    assert.ok(failures.length >= 1);
    for (const failure of failures) {
      assert.match(failure, /LICENSES/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an *.mp3 file under vendor fails the gate", () => {
  const { root, packDir } = makeFixture();
  try {
    fs.writeFileSync(path.join(packDir, "x.mp3"), "audio-bytes");
    const { ok, failures } = checkLicenses(root);
    assert.equal(ok, false);
    assert.ok(
      failures.some((failure) => /LICENSES/.test(failure)),
      `expected a LICENSES failure, got: ${failures.join("; ")}`,
    );
    assert.deepEqual(scanVendorTree(path.join(root, "packages", "client", "assets", "vendor")).filter((f) => /x\.mp3/.test(f)).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a License* file without a CC0 marker fails the gate", () => {
  const { root, packDir } = makeFixture();
  try {
    fs.writeFileSync(
      path.join(packDir, "License.txt"),
      "All rights reserved, proprietary.",
    );
    const { ok, failures } = checkLicenses(root);
    assert.equal(ok, false);
    assert.ok(
      failures.some((failure) => /LICENSES/.test(failure)),
      `expected a LICENSES failure, got: ${failures.join("; ")}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
