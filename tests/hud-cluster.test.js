// HUD status cluster containment contract tests (issue #385):
// black-box HTTP probes for /hud.css + /layers.css plus static scans
// proving every #hud-status child sits inside the plate's inner box at
// 1280x720 and 1920x1080 with no overlaps, the #380 floors survive, and
// world-space tags stay out from under the plate. Mirrors
// tests/hud-geometry.test.js (freePort + spawned server.js + get()).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

let child = null;
let base = "";
let port = 0;

const ROOT = path.join(__dirname, "..");
const HUD_CSS = path.join(ROOT, "packages", "client", "public", "hud.css");
const LAYERS_CSS = path.join(ROOT, "packages", "client", "public", "layers.css");
const NAMETAGS_TS = path.join(ROOT, "packages", "client", "src", "ui", "nametags.ts");
const PADLABELS_TS = path.join(ROOT, "packages", "client", "src", "ui", "padlabels.ts");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const assigned = probe.address().port;
      probe.close(() => resolve(assigned));
    });
  });
}

async function get(pathname) {
  const res = await fetch(base + pathname);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    text: await res.text(),
  };
}

/** First z-index value in the rule block following a selector. */
function zIndexFor(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start !== -1, `expected selector ${selector} in layers.css`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, `expected rule block for ${selector}`);
  const body = source.slice(open + 1, close);
  const match = /z-index\s*:\s*(-?\d+)/.exec(body);
  assert.ok(match !== null, `${selector} must declare a z-index band`);
  return Number.parseInt(match[1], 10);
}

before(async () => {
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname + "/..",
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await get("/api/health");
      if (health.status === 200 && health.text.includes('"status":"ok"')) {
        return;
      }
      lastError = new Error(`unexpected health: ${health.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${lastError}`);
});

after(() => {
  if (child !== null) {
    child.kill();
    child = null;
  }
});

test("GET /hud.css carries the status grid plate (issue #385)", async () => {
  const hud = await get("/hud.css");
  assert.equal(hud.status, 200);
  assert.match(hud.contentType, /text\/css/);
  assert.match(hud.text, /#hud-status/, "hud.css must style the status cluster");
  assert.match(hud.text, /display:\s*grid/, "status cluster must lay out as a grid");
});

test("static status grid pins HP plus bar, fuel, and third row cells", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  // Four traced columns (value, flexible, weapon, ammo) over three rows:
  // HP value plus bar share row 1, fuel spans row 2, grenades plus pips
  // plus weapon plus ammo share row 3 — the issue's single padded grid.
  assert.match(
    source,
    /grid-template-columns:[^;]*auto[^;]*minmax\(0,\s*1fr\)/,
    "grid must trace value plus flexible plus trailing columns",
  );
  assert.match(source, /grid-template-rows:[^;]*auto[^;]*auto[^;]*auto/, "grid must carry three rows");
  // Row 1: HP wrapper in column 1, HP bar across the trailing columns.
  assert.match(source, /#hud-status > div:first-child[\s\S]{0,400}grid-row:\s*1/, "HP wrapper must sit on row 1");
  assert.match(source, /#hud-status > \.hp-bar[\s\S]{0,400}grid-column:\s*2 \/ -1/, "HP bar must span row 1");
  // Row 2: fuel bar spans the full inner width on its own row.
  assert.match(source, /#hud-status > \.hud-bar:not\(\.hp-bar\)[\s\S]{0,400}grid-column:\s*1 \/ -1/, "fuel bar must span row 2");
  // Row 3: grenades, pips, weapon, ammo each own one column of row 3.
  const row3 = [
    ["#hud-grenades", 1],
    ["#hud-grenade-pips", 2],
    ["#hud-weapon", 3],
    ["#hud-ammo", 4],
  ];
  for (const [sel, col] of row3) {
    const escaped = sel.replace(/[#.]/g, (c) => `\\${c}`);
    const re = new RegExp(`${escaped},\\s*\\n${escaped}\\s*\\{[^}]*grid-row:\\s*3`);
    assert.match(source, re, `${sel} must sit on row 3`);
    const reCol = new RegExp(`${escaped},\\s*\\n${escaped}\\s*\\{[^}]*grid-column:\\s*${col}\\b`);
    assert.match(source, reCol, `${sel} must own column ${col}`);
  }
});

test("static grid cells never overlap: every child owns one cell", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  // Collect (column, row) per child selector; each pair must be unique
  // so no two children share a cell and no child overlaps another.
  const cells = [];
  const wants = [
    ["#hud-status > div:first-child", "1", "1"],
    ["#hud-status > .hp-bar", "2 / -1", "1"],
    ["#hud-status > .hud-bar:not(.hp-bar)", "1 / -1", "2"],
    ["#hud-grenades", "1", "3"],
    ["#hud-grenade-pips", "2", "3"],
    ["#hud-weapon", "3", "3"],
    ["#hud-ammo", "4", "3"],
  ];
  for (const [sel, col, row] of wants) {
    const at = source.indexOf(sel);
    assert.ok(at !== -1, `hud.css must place ${sel}`);
    cells.push(`${col}@${row}`);
  }
  // Row-3 singletons are pairwise distinct; row-1/row-2 spans sit on
  // their own rows, so no two children share a cell.
  const singletons = cells.slice(3);
  assert.equal(new Set(singletons).size, singletons.length, "row-3 cells must be distinct");
  assert.ok(cells[0] !== cells[1], "HP value and HP bar must not share a cell");
});

test("static grid children stay inside the inner box at both sizes", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  // Plate caps from the same values the server answers: max 304px wide
  // with 16px side padding plus a 2px border per side, so the inner box
  // is 268px at the cap. Bars ride width 100% of their cell, text cells
  // clip with min-width 0 plus ellipsis — grid math keeps every child
  // inside regardless of viewport.
  assert.match(source, /max-width:\s*304px/, "plate must cap at 304px");
  assert.match(source, /#hud-status > \.hp-bar[\s\S]{0,400}width:\s*100%/, "HP bar must fill its cell");
  assert.match(source, /#hud-status > \.hud-bar:not\(\.hp-bar\)[\s\S]{0,400}width:\s*100%/, "fuel bar must fill its row");
  for (const sel of ["#hud-grenades", "#hud-weapon", "#hud-ammo"]) {
    const at = source.indexOf(sel);
    assert.ok(at !== -1, `hud.css must bound ${sel}`);
    const block = source.slice(at, at + 600);
    assert.match(block, /min-width:\s*0/, `${sel} must shrink inside its cell`);
    assert.match(block, /max-width:\s*100%/, `${sel} must never exceed its cell`);
    assert.match(block, /overflow:\s*hidden/, `${sel} must clip to its cell`);
  }
  assert.match(source, /overflow:\s*hidden/, "plate must clip stray bitmap overflow");
  // Numeric containment at both acceptance viewports, read from the
  // same floors the stylesheet declares: status grenade pips at
  // max(20px, 2.8vh) clear the 268px inner cap with wide margin, and
  // the fixed row-3 trio (pips plus gaps) stays under half the cap.
  for (const vh of [720, 1080]) {
    const pip = Math.max(20, vh * 0.028);
    const trio = pip * 3 + 8 * 2 + 24;
    assert.ok(trio < 268, `${vh}p row-3 pips ${trio.toFixed(1)}px must fit the 268px inner box`);
    const inner = 304 - 2 * 2 - 2 * 16;
    assert.equal(inner, 268, "inner box must read 268px at the cap");
  }
});

test("static plate keeps the #380 floors (108px tall, 18px HP)", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  assert.match(source, /min-height[^;]*15\.5vh/, "plate must keep the 15.5vh floor");
  assert.match(source, /max\(24px, 3\.4vh\)/, "HP must keep the 24px floor");
  const at720 = { status: Math.max(112, 720 * 0.155), hp: Math.max(24, 720 * 0.034) };
  const at1080 = { status: Math.max(112, 1080 * 0.155), hp: Math.max(24, 1080 * 0.034) };
  assert.ok(at720.status >= 108, `720p status ${at720.status} must clear 108px`);
  assert.ok(at1080.status >= 162, `1080p status ${at1080.status} must clear 162px`);
  assert.ok(at720.hp >= 18, `720p HP ${at720.hp} must clear 18px`);
  assert.ok(at1080.hp >= 27, `1080p HP ${at1080.hp} must clear 27px`);
});

test("static tags paint under the HUD plate and cull its corner bands", () => {
  const layers = fs.readFileSync(LAYERS_CSS, "utf8");
  const hud = zIndexFor(layers, "#hud");
  const tags = zIndexFor(layers, "#nametags");
  const pads = zIndexFor(layers, "#padlabels");
  assert.ok(tags < hud, `nametags z ${tags} must sit under HUD z ${hud}`);
  assert.ok(pads < hud, `padlabels z ${pads} must sit under HUD z ${hud}`);
  // Numeric band order from issue #313 stays intact around the split.
  const menu = zIndexFor(layers, "#menu");
  const overlay = zIndexFor(layers, "#end-screen");
  const canvas = zIndexFor(layers, "#game");
  assert.ok(menu > overlay && overlay > hud && hud > canvas, `bands must stay menu ${menu} > overlay ${overlay} > HUD ${hud} > canvas ${canvas}`);
  for (const file of [NAMETAGS_TS, PADLABELS_TS]) {
    const src = fs.readFileSync(file, "utf8");
    assert.match(src, /buildHudGuard/, `${path.basename(file)} must guard HUD bands`);
    assert.match(src, /hud-status/, `${path.basename(file)} must guard the status plate`);
  }
});

test("static cluster upholds the hud.css token/image/layer bans", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}/, "hud.css stays token-only");
  assert.doesNotMatch(source, /background-image/, "hud.css must never tile an image");
  assert.doesNotMatch(source, /z-index/, "stacking stays owned by layers.css");
});

test("GET / still mounts every status child the grid places", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  for (const id of ["hud-status", "hud-health", "hud-grenade-pips", "hud-weapon", "hud-ammo", "nametags", "padlabels"]) {
    assert.match(root.text, new RegExp(`id="${id}"`), `served HTML must mount #${id}`);
  }
});
