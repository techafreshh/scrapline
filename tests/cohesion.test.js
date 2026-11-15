// Theme cohesion checklist (#205): docs/benchmark/themes/ holds one
// committed 1920x1080 capture per map over 50KB, the kilima frame pins
// the exact 1920x1080 IHDR size, every theme's declared layers pass the
// rendered-subset-of-declared gate, no theme accepts a foreign theme's
// layers, and an injected `city` layer fails on every theme. Node-only:
// no browser, no build; the PNG helpers come from benchmark-compare.mjs
// and the subset checker from cohesion-check.mjs.
const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const THEMES_DIR = path.join(ROOT, "docs", "benchmark", "themes");
const THEME_NAMES = ["kilima", "dune", "frostbite"];
// Settled gameplay-frame budget: thin/blank captures stay far below it.
const MIN_THEME_PNG_BYTES = 50 * 1024;

let cohesion = null;
let compare = null;

before(async () => {
  cohesion = await import("../scripts/cohesion-check.mjs");
  compare = await import("../scripts/verify/benchmark-compare.mjs");
});

test("docs/benchmark/themes/ holds one >50KB PNG per map", () => {
  const names = fs.readdirSync(THEMES_DIR).sort();
  assert.deepEqual(names, ["dune.png", "frostbite.png", "kilima.png"]);
  for (const theme of THEME_NAMES) {
    const buf = fs.readFileSync(path.join(THEMES_DIR, `${theme}.png`));
    assert.ok(
      buf.length > MIN_THEME_PNG_BYTES,
      `${theme}.png is ${buf.length} bytes, expected >50KB`,
    );
    assert.ok(compare.isPngBytes(buf), `${theme}.png has a bad PNG signature`);
  }
});

test("kilima capture is exactly 1920x1080", () => {
  const buf = fs.readFileSync(path.join(THEMES_DIR, "kilima.png"));
  assert.deepEqual(compare.pngInfoBytes(buf), { width: 1920, height: 1080 });
});

test("declared layers pass the rendered-subset-of-declared gate", () => {
  for (const theme of THEME_NAMES) {
    const result = cohesion.checkCohesion(
      cohesion.declaredLayersFor(theme),
      theme,
    );
    assert.equal(result.ok, true, `${theme}: ${result.undeclared.join(",")}`);
    assert.deepEqual(result.undeclared, []);
  }
});

test("no theme accepts another theme's layers", () => {
  for (const theme of THEME_NAMES) {
    for (const foreign of THEME_NAMES) {
      if (foreign === theme) {
        continue;
      }
      const result = cohesion.checkCohesion(
        cohesion.declaredLayersFor(foreign),
        theme,
      );
      assert.equal(
        result.ok,
        false,
        `${foreign} layers must not pass as ${theme}`,
      );
      assert.ok(result.undeclared.length > 0, `${foreign} vs ${theme} names no undeclared layer`);
    }
  }
});

test("injected city layer fails the checklist on every theme", () => {
  for (const theme of THEME_NAMES) {
    const rendered = [...cohesion.declaredLayersFor(theme), "city"];
    const result = cohesion.checkCohesion(rendered, theme);
    assert.equal(result.ok, false, `${theme} accepted an injected city layer`);
    assert.ok(
      result.undeclared.includes("city"),
      `${theme} undeclared misses city: ${result.undeclared.join(",")}`,
    );
  }
});
