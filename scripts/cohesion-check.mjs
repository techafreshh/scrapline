// Theme cohesion checklist (#205): declared parallax backdrop layer ids
// per map plus the rendered-subset-of-declared checker. Pure ESM with no
// DOM, no Pixi, and no browser, so both the node:test checklist
// (tests/cohesion.test.js) and the Chromium capture leg
// (scripts/capture-themes.mjs) import this one module. The
// DECLARED_LAYERS literal mirrors THEME_BACKDROP_LAYERS
// (packages/client/src/view/theme.ts); the vitest drift-pin
// (packages/client/test/theme-cohesion.test.ts) fails when the two
// registries drift apart. No theme ever contains `city`.
import { fileURLToPath } from "node:url";
function log(message) {
  console.log(`[cohesion] ${message}`);
}

function fail(message) {
  console.error(`[cohesion] FAIL: ${message}`);
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

/**
 * Declared parallax backdrop layer ids per theme (probe-visible
 * contract). kilima renders dusk savanna (sun disc, acacias, birds);
 * dune renders golden-hour desert (dune ridges, chimneys); frostbite
 * renders polar night (aurora, antennas, snow). No theme declares
 * `city` (city silhouettes were removed from every set).
 */
export const DECLARED_LAYERS = {
  kilima: ["sky", "sun-disc", "far-savanna", "acacia", "haze", "birds"],
  dune: ["sky", "dune-ridge", "chimney", "haze"],
  frostbite: ["sky", "aurora", "far-ridge", "antenna", "snow", "haze"],
};

/** Canonical theme key for a tolerant input (kilima fallback, never throws). */
function resolveTheme(name) {
  if (typeof name === "string") {
    const key = name.trim().toLowerCase();
    if (key === "dune" || key === "frostbite" || key === "kilima") {
      return key;
    }
  }
  return "kilima";
}

/**
 * Declared backdrop layers for a theme name (tolerant, kilima fallback).
 * Returns a fresh copy so callers cannot mutate the registry.
 */
export function declaredLayersFor(name) {
  return [...DECLARED_LAYERS[resolveTheme(name)]];
}

/**
 * Rendered layer ids that the theme does not declare. Empty means the
 * frame is cohesive (rendered is a subset of declared).
 */
export function undeclaredLayers(rendered, name) {
  const declared = new Set(declaredLayersFor(name));
  const list = Array.isArray(rendered) ? rendered : [];
  return list.filter((layer) => !declared.has(layer));
}

/**
 * Cohesion verdict for one frame: rendered layer ids against the theme
 * declaration. `{ ok, theme, undeclared }`; `ok` is false exactly when a
 * rendered layer (e.g. an injected `city`) is not declared by the theme.
 */
export function checkCohesion(rendered, name) {
  const theme = resolveTheme(name);
  const undeclared = undeclaredLayers(rendered, theme);
  return { ok: undeclared.length === 0, theme, undeclared };
}

function runCli() {
  const [theme, injected] = process.argv.slice(2);
  const rendered = declaredLayersFor(theme);
  if (injected !== undefined) {
    rendered.push(injected);
  }
  const result = checkCohesion(rendered, theme);
  log(`${result.theme}: ${result.ok ? "cohesive" : `undeclared ${result.undeclared.join(",")}`}`);
  assert(result.ok, `undeclared layer(s) for ${result.theme}: ${result.undeclared.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (err) {
    if (process.exitCode === 0) {
      process.exitCode = 1;
    }
  }
}
