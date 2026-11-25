// Menu slicer tests (issue #348): the ME-* sheets slice into the
// committed packages/client/assets/ui/ kit deterministically (same
// bytes on re-slice), every file parses as a PNG with the manifest
// box, and the failure paths name their stage. Uses a temp-dir seam
// (SLICE_MENU_UI_DIR); the committed kit is never touched. Mirrors
// tools/slice-sheet.test.js (node:test, no art produced outside tmp).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TOOL = path.join(__dirname, "slice-menu.js");
const { sliceMenu, sliceCells } = require(TOOL);

/** PNG IHDR dimensions (no decode needed). */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.deepEqual(
    Array.from(buf.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${file} must carry the PNG signature`,
  );
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

test("sliceCells yields the nine-file menu kit with sane boxes", () => {
  const cells = sliceCells();
  const names = cells.map((cell) => cell.name).sort();
  assert.deepEqual(names, [
    "menu-arrow-left",
    "menu-arrow-right",
    "menu-avatar",
    "menu-card",
    "menu-dot-off",
    "menu-dot-on",
    "menu-field",
    "menu-tip",
    "wordmark",
  ]);
  for (const cell of cells) {
    assert.ok(cell.img.w > 0 && cell.img.h > 0, `${cell.name} must have a box`);
    assert.ok(cell.img.w <= 300 && cell.img.h <= 200, `${cell.name} box ${cell.img.w}x${cell.img.h} is implausibly large`);
  }
  const byName = new Map(cells.map((cell) => [cell.name, cell.img]));
  assert.deepEqual([byName.get("wordmark").w, byName.get("wordmark").h], [237, 50]);
  assert.deepEqual([byName.get("menu-card").w, byName.get("menu-card").h], [239, 129]);
  assert.deepEqual(
    [byName.get("menu-arrow-left").w, byName.get("menu-arrow-left").h],
    [byName.get("menu-arrow-right").w, byName.get("menu-arrow-right").h],
    "arrow plates must share one box",
  );
});

test("sliceMenu emits PNGs plus a manifest into the seam dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-slice-menu-"));
  try {
    const written = sliceMenu(dir);
    assert.equal(written.length, 9);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest).sort(), written.map((w) => w.name).sort());
    for (const w of written) {
      const dims = pngSize(path.join(dir, w.file));
      assert.deepEqual([dims.w, dims.h], [w.w, w.h], `${w.name} manifest must match IHDR`);
      assert.deepEqual([dims.w, dims.h], [manifest[w.name].w, manifest[w.name].h]);
      assert.equal(manifest[w.name].file, `ui/${w.file}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("re-slicing is byte-identical (deterministic pipeline)", () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-slice-menu-a-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-slice-menu-b-"));
  try {
    sliceMenu(first);
    sliceMenu(second);
    for (const name of fs.readdirSync(first).sort()) {
      assert.ok(fs.existsSync(path.join(second, name)), `second slice must emit ${name}`);
      assert.equal(sha256(path.join(first, name)), sha256(path.join(second, name)), `${name} must be byte-identical`);
    }
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("CLI honors SLICE_MENU_UI_DIR and prints per-file lines", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-slice-menu-cli-"));
  try {
    const child = spawnSync(process.execPath, [TOOL], {
      env: { ...process.env, SLICE_MENU_UI_DIR: dir },
      encoding: "utf8",
    });
    assert.equal(child.status, 0, `CLI must exit 0, got: ${child.stderr}`);
    assert.match(child.stdout, /slice-menu: wordmark -> wordmark\.png/);
    assert.match(child.stdout, /slice-menu: menu-card -> menu-card\.png/);
    assert.ok(fs.existsSync(path.join(dir, "wordmark.png")));
    assert.ok(fs.existsSync(path.join(dir, "manifest.json")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
