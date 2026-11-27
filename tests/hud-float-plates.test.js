// HUD floating-surface plates (issue #394): name tags, pad labels,
// kill-feed rows, and the toast stack ride their sliced art as 9-slice
// frames while the code keeps carrying the colour (team rails, pickup
// underlines, entry text). Static CSS scans only (no browser in CI):
// each surface resolves a ui/ plate with stretch repeat and pixelated
// rendering, slices stay on the 4px grid with integer render scaling,
// and no rule touches the code-owned colour layers.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CHROME_CSS = path.join(ROOT, "packages", "client", "public", "components", "chrome.css");
const ATLAS_DIR = path.join(ROOT, "packages", "client", "assets", "atlas");
const SRC_HTML = path.join(ROOT, "packages", "client", "index.html");
const NAMETAGS_TS = path.join(ROOT, "packages", "client", "src", "ui", "nametags.ts");
const PADLABELS_TS = path.join(ROOT, "packages", "client", "src", "ui", "padlabels.ts");
const FEED_TS = path.join(ROOT, "packages", "client", "src", "ui", "feed.ts");

function css() {
  return fs.readFileSync(CHROME_CSS, "utf8");
}

/** Escape a selector for literal regex use. */
function escaped(selector) {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Bodies of every rule block whose selector list contains `selector`
 * (the house `#stage X, X` dual-selector idiom).
 */
function ruleBodies(source, selector) {
  const out = [];
  const chunks = source.split("}");
  for (const chunk of chunks) {
    const brace = chunk.indexOf("{");
    if (brace === -1) {
      continue;
    }
    const head = chunk.slice(0, brace);
    if (new RegExp(escaped(selector)).test(head)) {
      out.push(chunk.slice(brace + 1));
    }
  }
  return out;
}

/** First declaration value for `prop` inside a rule body (or null). */
function declarationValue(body, prop) {
  const match = new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body || "");
  return match === null ? null : match[1].trim();
}

test("nametags ride the tailed tooltip plate at full scale with a currentColor rail", () => {
  const source = css();
  const bodies = ruleBodies(source, "#nametags > div");
  assert.ok(bodies.length >= 1, "chrome.css must plate #nametags > div");
  const merged = bodies.join("\n");
  assert.match(merged, /url\("\.\.\/assets\/atlas\/ui\/tooltip\.png"\)/, "nametag plate must be ui/tooltip.png");
  assert.match(merged, /border-image-slice\s*:\s*8\s+8\s+20\s+8\s+fill/, "nametag slice must be 8 8 20 8 fill");
  assert.match(merged, /border-image-width\s*:\s*8px\s+8px\s+20px\s+8px/, "nametag widths must be 8px 8px 20px 8px");
  assert.match(merged, /border-image-repeat\s*:\s*stretch/, "nametag repeat must be stretch");
  assert.match(merged, /image-rendering\s*:\s*pixelated/, "nametag plate must stay pixelated");
  // Full-scale 1:1 rendering on the 4px grid (the .sl-tooltip idiom
  // verbatim): every slice and width token divides by 4, so the
  // chrome-art 9-slice guardrail holds with zero resampling.
  // The team rail: an inset currentColor shadow (no hardcoded hex),
  // so paintTag's style.color keeps carrying the teamCss colour.
  const shadow = declarationValue(merged, "box-shadow");
  assert.ok(shadow !== null, "nametag rule must carry the rail shadow");
  assert.match(shadow, /inset\s+3px\s+0/, "rail must read inset 3px 0");
  assert.doesNotMatch(shadow, /#[0-9a-fA-F]{3,6}/, "rail must use currentColor, never a hardcoded hex");
});

test("own nametag keeps the rail plus the cyan glow", () => {
  const source = css();
  const bodies = ruleBodies(source, "#nametags > div.own");
  assert.ok(bodies.length >= 1, "chrome.css must keep an own-nametag rule");
  const merged = bodies.join("\n");
  const shadow = declarationValue(merged, "box-shadow");
  assert.ok(shadow !== null, "own nametag must set box-shadow");
  assert.match(shadow, /inset\s+3px\s+0/, "own tag must keep the team rail");
  assert.match(shadow, /0\s+0\s+8px/, "own tag must keep the glow pop");
});

test("pad labels ride the plain row band at 1x without touching the accent", () => {
  const source = css();
  const bodies = ruleBodies(source, "#padlabels > div");
  assert.ok(bodies.length >= 1, "chrome.css must plate #padlabels > div");
  const merged = bodies.join("\n");
  assert.match(merged, /url\("\.\.\/assets\/atlas\/ui\/row\.png"\)/, "pad label plate must be ui/row.png");
  assert.match(merged, /border-image-slice\s*:\s*4\s+fill/, "pad label slice must be 4 fill");
  assert.match(merged, /border-image-width\s*:\s*4px/, "pad label width must be 4px");
  assert.match(merged, /border-image-repeat\s*:\s*stretch/, "pad label repeat must be stretch");
  assert.match(merged, /image-rendering\s*:\s*pixelated/, "pad label plate must stay pixelated");
  // The pickup underline stays code-owned: the plate rule must not
  // set box-shadow or background, which would fight the binder's
  // inline accent (and the token fill from the per-sheet styles).
  assert.equal(declarationValue(merged, "box-shadow"), null, "pad label plate must not set box-shadow");
  assert.equal(declarationValue(merged, "background"), null, "pad label plate must not set background");
});

test("kill-feed rows ride the row band; own rows swap to the selected band", () => {
  const source = css();
  const bodies = ruleBodies(source, "#killfeed .kill-entry");
  assert.ok(bodies.length >= 1, "chrome.css must plate #killfeed .kill-entry");
  const merged = bodies.join("\n");
  assert.match(merged, /url\("\.\.\/assets\/atlas\/ui\/row\.png"\)/, "kill rows must ride ui/row.png");
  assert.match(merged, /border-image-slice\s*:\s*4\s+fill/, "kill row slice must be 4 fill");
  assert.match(merged, /border-image-width\s*:\s*4px/, "kill row width must be 4px");
  assert.match(merged, /border-image-repeat\s*:\s*stretch/, "kill row repeat must be stretch");
  // Local-player rows keep their distinction through the selected
  // plate (the standings-winner idiom), chosen by the code-owned
  // `own` class — never by a hardcoded row colour.
  const own = ruleBodies(source, "#killfeed .kill-entry.own").join("\n");
  assert.match(own, /url\("\.\.\/assets\/atlas\/ui\/row\.selected\.png"\)/, "own rows must ride ui/row.selected.png");
  assert.match(own, /var\(--color-cyan\)/, "own row border must reference the cyan token");
  // Entry text and flash behaviour stay code-owned: no color or
  // background declarations on the plated rows.
  assert.equal(declarationValue(merged, "background"), null, "kill rows must not set background");
  assert.equal(declarationValue(merged, "color"), null, "kill rows must not set color");
});

test("toast stack takes the panel frame with an :empty guard", () => {
  const source = css();
  const bodies = ruleBodies(source, "#toast");
  assert.ok(bodies.length >= 1, "chrome.css must plate #toast");
  const merged = bodies.join("\n");
  assert.match(merged, /url\("\.\.\/assets\/atlas\/ui\/panel\.png"\)/, "toast stack must ride ui/panel.png");
  assert.match(merged, /border-image-slice\s*:\s*12\s+fill/, "toast stack slice must be 12 fill");
  assert.match(merged, /border-image-width\s*:\s*12px/, "toast stack width must be 12px");
  assert.match(merged, /border-image-repeat\s*:\s*stretch/, "toast stack repeat must be stretch");
  // The idle container (zero entries) must stay invisible: no stray
  // panel frame with nothing inside it.
  const guard = ruleBodies(source, "#toast:empty").join("\n");
  assert.match(guard, /border\s*:\s*0/, ":empty toast must drop the border");
  // Entries keep their existing strip plate (untouched by this lap).
  const entries = ruleBodies(source, "#toast .toast-entry").join("\n");
  assert.match(entries, /url\("\.\.\/assets\/atlas\/ui\/toast\.png"\)/, "toast entries must keep ui/toast.png");
});

test("new plates never tile: stretch only, pixelated, ui/ art on disk", () => {
  const source = css();
  for (const selector of ["#nametags > div", "#padlabels > div", "#killfeed .kill-entry", "#toast"]) {
    const merged = ruleBodies(source, selector).join("\n");
    assert.doesNotMatch(merged, /background-repeat\s*:\s*repeat\b/, `${selector} must never set a repeating background`);
    assert.doesNotMatch(
      merged,
      /border-image-repeat\s*:\s*(repeat|round|space)/,
      `${selector} must 9-slice with stretch, never tile`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ATLAS_DIR, "manifest.json"), "utf8"));
  for (const [key, file] of [
    ["ui.tooltip", "ui/tooltip.png"],
    ["ui.row", "ui/row.png"],
    ["ui.row.selected", "ui/row.selected.png"],
    ["ui.toast", "ui/toast.png"],
    ["ui.panel", "ui/panel.png"],
  ]) {
    assert.equal(manifest[key] && manifest[key].file, file, `manifest ${key} must pin ${file}`);
    assert.ok(fs.existsSync(path.join(ATLAS_DIR, file)), `${file} must exist on disk`);
  }
});

test("code still carries the colour: binders paint rails, accents, and names", () => {
  const html = fs.readFileSync(SRC_HTML, "utf8");
  for (const id of ["nametags", "padlabels", "toast", "killfeed"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html must keep mounting #${id}`);
  }
  const tags = fs.readFileSync(NAMETAGS_TS, "utf8");
  assert.match(tags, /\["color"\]\s*=\s*color/, "nametags binder must keep painting style.color");
  assert.match(tags, /tagColorFor/, "nametag colour must still flow from the teamCss helper");
  const pads = fs.readFileSync(PADLABELS_TS, "utf8");
  assert.match(pads, /\["boxShadow"\]\s*=\s*underline/, "padlabels binder must keep painting the accent underline");
  assert.match(pads, /data-accent/, "padlabels must keep mirroring the accent for probes");
  const feed = fs.readFileSync(FEED_TS, "utf8");
  assert.match(feed, /paintName\(victim, entry\.victimColor\)/, "feed must keep painting the victim team colour");
  assert.match(feed, /paintName\(killer, entry\.killerColor\)/, "feed must keep painting the killer team colour");
});
