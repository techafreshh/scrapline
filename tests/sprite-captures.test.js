// Sprite capture inventory gate (#272): docs/captures/ holds exactly the
// 12 committed generator frames (six scenes x two resolutions), every
// filename token in (menu, match-run, match-jet, kilima, dune,
// frostbite, particles, hud, standings) appears across the inventory, each
// file is a valid PNG whose IHDR dims equal the viewport in its filename
// suffix, and each file's bytes read at or above its mapped baseline.
// Node-only: no browser, no build; the PNG helpers come from
// benchmark-compare.mjs like the cohesion checklist.
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CAPTURES_DIR = path.join(ROOT, "docs", "captures");
const BENCHMARK_DIR = path.join(ROOT, "docs", "benchmark");
// Six scenes x two resolutions: the exact generator inventory.
const EXPECTED_NAMES = [
  "menu-1920x1080.png",
  "menu-1280x720.png",
  "match-run-kilima-1920x1080.png",
  "match-run-kilima-1280x720.png",
  "match-jet-dune-1920x1080.png",
  "match-jet-dune-1280x720.png",
  "frostbite-particles-1920x1080.png",
  "frostbite-particles-1280x720.png",
  "hud-kilima-1920x1080.png",
  "hud-kilima-1280x720.png",
  "standings-1920x1080.png",
  "standings-1280x720.png",
];
// Filename tokens the acceptance probe requires across the inventory.
const REQUIRED_TOKENS = [
  "menu",
  "match-run",
  "match-jet",
  "kilima",
  "dune",
  "frostbite",
  "particles",
  "hud",
  "standings",
];
// Baseline mapping: the generator's fixed table, mirrored here so the
// committed frames prove parity without a browser.
const BASELINE_FOR = {
  menu: "menu.png",
  "match-run-kilima": "midmatch-kilima.png",
  "match-jet-dune": path.join("themes", "dune.png"),
  "frostbite-particles": path.join("themes", "frostbite.png"),
  "hud-kilima": "midmatch-kilima.png",
  standings: "standings.png",
};

let compare = null;

before(async () => {
  compare = await import("../scripts/verify/benchmark-compare.mjs");
});

function sceneOf(name) {
  return name.replace(/-(1920x1080|1280x720)\.png$/, "");
}

test("docs/captures/ holds exactly the 12 scene x resolution frames", () => {
  // PNG inventory only: the protocol README lives alongside the frames.
  const names = fs
    .readdirSync(CAPTURES_DIR)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
  assert.deepEqual(names, [...EXPECTED_NAMES].sort());
});

test("every required filename token appears across the inventory", () => {
  const names = fs.readdirSync(CAPTURES_DIR);
  for (const token of REQUIRED_TOKENS) {
    assert.ok(
      names.some((name) => name.includes(token)),
      `no capture filename contains ${JSON.stringify(token)}`,
    );
  }
});

test("every capture is a valid PNG at its filename viewport", () => {
  for (const name of EXPECTED_NAMES) {
    const buf = fs.readFileSync(path.join(CAPTURES_DIR, name));
    assert.ok(compare.isPngBytes(buf), `${name} has a bad PNG signature`);
    const want =
      name.endsWith("-1920x1080.png") ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
    assert.deepEqual(compare.pngInfoBytes(buf), want, `${name} must be ${want.width}x${want.height}`);
  }
});

test("every capture reads at or above its mapped baseline", () => {
  for (const name of EXPECTED_NAMES) {
    const scene = sceneOf(name);
    const baselineFile = path.join(BENCHMARK_DIR, BASELINE_FOR[scene]);
    assert.ok(fs.existsSync(baselineFile), `missing baseline ${baselineFile}`);
    const bytes = fs.statSync(path.join(CAPTURES_DIR, name)).size;
    const baselineBytes = fs.statSync(baselineFile).size;
    assert.ok(
      bytes >= baselineBytes,
      `${name} is ${bytes} bytes, below baseline ${BASELINE_FOR[scene]} (${baselineBytes} bytes)`,
    );
  }
});
