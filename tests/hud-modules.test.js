// Cohesive HUD module contract tests (issue #317): black-box HTTP
// probes for /hud.css plus static scans proving the shared module skin,
// the four corner clusters, the label-size weapon name, and the accent
// grenade pips. Mirrors tests/menu-layout.test.js (freePort + spawned
// server.js + get()/ruleBody helpers).
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
const TOKENS_CSS = path.join(ROOT, "packages", "client", "public", "tokens.css");
const SRC_HTML = path.join(ROOT, "packages", "client", "index.html");
const SERVER_JS = path.join(ROOT, "server.js");
const COMBINED = path.join(ROOT, "packages", "server", "src", "server.ts");

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

/** Body of the first rule matching a literal selector in a CSS source. */
function ruleBody(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start !== -1, `expected selector ${selector} in hud.css`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, `expected rule block for ${selector}`);
  return source.slice(open + 1, close);
}

/** First declaration value for a property inside a rule body. */
function declarationValue(body, property) {
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);?`).exec(body);
  return match === null ? null : match[1].trim();
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

test("GET /hud.css returns 200 CSS carrying the module skin", async () => {
  const hud = await get("/hud.css");
  assert.equal(hud.status, 200);
  assert.match(hud.contentType, /text\/css/);
  assert.match(hud.text, /\.hud-module/);
  assert.match(hud.text, /\.ammo-weapon/);
  assert.match(hud.text, /\.grenade-pip/);
});

test("HEAD /hud.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/hud.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("GET / links the HUD module stylesheet", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /hud\.css/);
});

test("GET / mounts at least four hud-module clusters on the right ids", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  const hits = root.text.match(/hud-module/g) || [];
  assert.ok(hits.length >= 4, `expected >= 4 hud-module mounts, got ${hits.length}`);
  assert.match(root.text, /id="hud-status"[^>]*class="hud-module"|class="hud-module"[^>]*id="hud-status"/);
  assert.match(root.text, /id="hud-center"[^>]*class="hud-module"|class="hud-module"[^>]*id="hud-center"/);
  assert.match(root.text, /id="killfeed"[^>]*class="hud-module"|class="hud-module"[^>]*id="killfeed"/);
  assert.match(root.text, /id="ammo-module"[^>]*class="hud-module"|class="hud-module"[^>]*id="ammo-module"/);
  assert.match(root.text, /id="ammo-name"[^>]*class="ammo-weapon"|class="ammo-weapon"[^>]*id="ammo-name"/);
});

test("static hud-module skin uses a 2px token border and token panel fill", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, ".hud-module");
  assert.match(declarationValue(body, "border") || "", /2px/);
  assert.match(declarationValue(body, "border") || "", /var\(--color-border\)/);
  assert.match(declarationValue(body, "background") || "", /var\(--color-panel\)/);
  const tokens = fs.readFileSync(TOKENS_CSS, "utf8");
  assert.match(tokens, /--color-border:\s*#2a3550/);
  const panel = /--color-panel:\s*([^;]+);/.exec(tokens);
  assert.ok(panel !== null, "tokens.css must define --color-panel");
  assert.match(panel[1], /0\.92/, "--color-panel alpha must stay below 1.0");
});

test("static hud-module accent bar rides the cyan token", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, ".hud-module::before");
  assert.match(declarationValue(body, "background") || "", /var\(--color-cyan\)/);
});

test("static killfeed module cancels the legacy bottom offset", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, "#killfeed.hud-module");
  assert.equal(declarationValue(body, "bottom"), "auto");
});

test("static ammo-weapon name resolves to label size or smaller", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, "#ammo-name.ammo-weapon");
  assert.match(declarationValue(body, "font-size") || "", /var\(--font-label\)/);
  const tokens = fs.readFileSync(TOKENS_CSS, "utf8");
  const label = /--font-label:\s*([^;]+);/.exec(tokens);
  assert.ok(label !== null, "tokens.css must define --font-label");
  assert.ok(
    Number.parseFloat(label[1]) <= 12,
    `--font-label must resolve to <= 12px, got ${label[1].trim()}`,
  );
});

test("static grenade pips reference the cyan or warm accent token", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const body = ruleBody(source, ".grenade-pip");
  assert.match(
    body,
    /var\(--color-cyan\)|var\(--color-warm\)/,
    "grenade pips must paint from an accent token",
  );
});

test("hud.css and index.html carry no brick-era references", () => {
  const css = fs.readFileSync(HUD_CSS, "utf8");
  assert.doesNotMatch(css, /brick/i, "hud.css must not reference brick");
  const html = fs.readFileSync(SRC_HTML, "utf8");
  assert.doesNotMatch(html, /brick/i, "index.html must not reference brick");
  assert.doesNotMatch(html, /hud-ammo[^"]*["']?\s*:\s*[^;]*url/i, "no .hud-ammo brick background");
});

test("static hud.css never takes over stacking or tiles images", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  assert.doesNotMatch(source, /z-index/, "stacking stays owned by layers.css");
  assert.doesNotMatch(source, /background-image/, "hud.css must never tile an image");
  assert.doesNotMatch(
    source,
    /#[0-9a-fA-F]{6}/,
    "hud.css must consume token variables, not raw hex",
  );
});

test("both server sources serve the /hud.css route", () => {
  assert.match(fs.readFileSync(SERVER_JS, "utf8"), /\/hud\.css/);
  assert.match(fs.readFileSync(COMBINED, "utf8"), /\/hud\.css/);
});

test("static HP fill rests on the success token and flashes the warm token (issue #318)", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const base = ruleBody(source, ".hp-fill");
  assert.match(
    declarationValue(base, "background") || "",
    /var\(--color-success\)/,
    ".hp-fill base must fill from the success token",
  );
  const hurt = ruleBody(source, ".hp-fill.hurt");
  assert.match(
    declarationValue(hurt, "background-color") || "",
    /var\(--color-warm\)/,
    ".hp-fill.hurt must flash the warm token",
  );
});

test("static own-kill entries highlight cyan with an opacity fade (issue #318)", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const own = ruleBody(source, ".kill-entry.own");
  assert.match(
    own,
    /var\(--color-cyan\)/,
    ".kill-entry.own must reference the cyan token",
  );
  assert.match(
    `${declarationValue(own, "color") || ""}${declarationValue(own, "background") || ""}`,
    /var\(--color-cyan\)|var\(--color-chip\)/,
    ".kill-entry.own must paint color or background from a cyan-family token",
  );
  const entry = ruleBody(source, "#killfeed .kill-entry");
  assert.match(
    entry,
    /transition|animation/,
    "kill entries must carry a transition or animation",
  );
  assert.match(entry, /opacity/, "the entry fade must target opacity");
});

test("static HUD skin keeps every module border navy (issue #318)", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  const bodies = [];
  let cursor = 0;
  while (true) {
    const at = source.indexOf(".hud-module", cursor);
    if (at === -1) {
      break;
    }
    const open = source.indexOf("{", at);
    const close = source.indexOf("}", open);
    assert.ok(open !== -1 && close !== -1, "expected rule block for .hud-module");
    bodies.push(source.slice(open + 1, close));
    cursor = close + 1;
  }
  assert.ok(bodies.length > 0, "expected at least one .hud-module rule");
  for (const body of bodies) {
    assert.doesNotMatch(body, /--color-warm/, "no module border may ride the warm token");
    assert.doesNotMatch(body, /--color-danger/, "no module border may ride the danger token");
    assert.doesNotMatch(body, /#[0-9a-fA-F]{6}/, "no module border may carry a raw hex");
  }
});

test("GET / mounts the HP bar next to the fuel bar (issue #318)", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /hp-fill/, "served HTML must mount the HP fill");
  assert.match(root.text, /id="hud-hp"/, "served HTML must mount #hud-hp");
  assert.match(root.text, /id="hud-status"[^>]*class="hud-module"|class="hud-module"[^>]*id="hud-status"/);
});

test("GET /hud.css serves the HP flash and own-kill rules (issue #318)", async () => {
  const hud = await get("/hud.css");
  assert.equal(hud.status, 200);
  assert.match(hud.text, /\.hp-fill\.hurt/);
  assert.match(hud.text, /\.kill-entry\.own/);
  assert.doesNotMatch(hud.text, /#[0-9a-fA-F]{6}/, "hud.css stays token-only");
});

test("GET / mounts the HU-01 four-corner clusters plus reticle set (issue #349)", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  for (const id of [
    "hud-status",
    "hud-center",
    "killfeed",
    "ammo-module",
    "ammo-mags",
    "hud-grenade-pips",
    "crosshair",
    "scope",
    "scope-ring",
    "respawn-card",
    "nametags",
    "padlabels",
  ]) {
    assert.match(root.text, new RegExp(`id="${id}"`), `served HTML must mount #${id}`);
  }
  assert.match(root.text, /id="crosshair"[^>]*data-weapon="pistol"/);
  // The centre chip is a stage-level sibling of the left strip (never
  // nested inside it) so left:50% truly centres on the viewport.
  const hudOpen = root.text.indexOf('<div id="hud"');
  const centerOpen = root.text.indexOf('<div id="hud-center"');
  assert.ok(hudOpen !== -1 && centerOpen !== -1 && centerOpen > hudOpen);
  const between = root.text.slice(hudOpen, centerOpen);
  const opens = (between.match(/<div/g) || []).length;
  const closes = (between.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, "#hud must close before #hud-center opens");
});

test("static HU-01 clusters hug the four corners with a clear centre (issue #349)", () => {
  const css = fs.readFileSync(HUD_CSS, "utf8");
  const hudBody = ruleBody(css, "#hud {");
  assert.match(hudBody, /right\s*:\s*auto/, "#hud must release the right edge");
  assert.match(hudBody, /max-width/, "#hud must hug the top-left cluster");
  const killBody = ruleBody(css, "#killfeed.hud-module");
  assert.match(killBody, /top\s*:\s*var\(--spacing-8\)/, "killfeed must pin top-right");
  assert.equal(declarationValue(killBody, "bottom"), "auto");
});

test("static HP three-state bands plus low-fuel flag ride tokens (issue #349)", () => {
  const css = fs.readFileSync(HUD_CSS, "utf8");
  const mid = ruleBody(css, ".hp-fill.hp-mid");
  assert.match(
    declarationValue(mid, "background") || "",
    /var\(--color-gold\)/,
    "mid HP must read the gold token",
  );
  const low = ruleBody(css, ".hp-fill.hp-low");
  assert.match(
    declarationValue(low, "background") || "",
    /var\(--color-danger\)/,
    "low HP must read the danger token",
  );
  const fuel = ruleBody(css, "#hud-fuel.fuel-low");
  assert.match(declarationValue(fuel, "animation") || "", /hud-fuel-low/);
  assert.match(css, /@keyframes hud-fuel-low/, "low fuel must blink in code");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}/, "hud.css stays token-only");
  assert.doesNotMatch(css, /background-image/, "hud.css must never tile an image");
  assert.doesNotMatch(css, /z-index/, "stacking stays owned by layers.css");
});

test("static magazine pips render five sockets with low-ammo styling (issue #349)", () => {
  const css = fs.readFileSync(HUD_CSS, "utf8");
  const filled = ruleBody(css, "#ammo-mags .pip.mag-pip.filled");
  assert.match(
    declarationValue(filled, "background-color") || "",
    /var\(--color-cyan\)/,
    "filled mag pips must read cyan",
  );
  const low = ruleBody(css, "#ammo-mags .pip.mag-pip.filled.low");
  assert.match(
    declarationValue(low, "background-color") || "",
    /var\(--color-warm\)/,
    "low mag pips must read warm",
  );
  const html = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(html, /id="ammo-mags"/, "served HTML must mount the mag row");
  const ammo = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "ui", "ammo.ts"),
    "utf8",
  );
  assert.match(ammo, /MAG_PIP_COUNT = 5/, "ammo module must model five mag pips");
});

test("served crosshair swaps per weapon with hit and kill markers (issue #349)", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  for (const weapon of ["smg", "rifle", "shotgun", "sniper", "rocket"]) {
    assert.match(
      root.text,
      new RegExp(`data-weapon="${weapon}`),
      `served HTML must skin the ${weapon} reticle`,
    );
  }
  assert.match(root.text, /#crosshair\.kill/, "served HTML must carry the kill marker");
  assert.match(root.text, /#crosshair\.scoped/, "scoped snipers must hide the reticle");
  const hudSrc = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "hud", "hud.ts"),
    "utf8",
  );
  assert.match(hudSrc, /setCrosshairWeapon/, "HUD binder must stamp the weapon skin");
  assert.match(hudSrc, /flashKillMarker/, "kill events must fire the kill marker");
  assert.match(hudSrc, /isSniperScoped/, "sniper scope must gate the lens overlay");
});

test("HUD reticles and lens stay baked-text-free CSS shapes (issue #349)", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  const crosshair = root.text.slice(
    root.text.indexOf('<div id="crosshair"'),
    root.text.indexOf('<div id="crosshair"') + 200,
  );
  assert.doesNotMatch(crosshair, /<img/, "the reticle must be CSS, never an image");
  const scope = root.text.slice(
    root.text.indexOf('<div id="scope"'),
    root.text.indexOf('<div id="scope"') + 400,
  );
  assert.doesNotMatch(scope, /<img/, "the lens must be CSS, never an image");
  const chrome = fs.readFileSync(
    path.join(ROOT, "packages", "client", "public", "components", "chrome.css"),
    "utf8",
  );
  assert.match(chrome, /#scope-ring/, "chrome.css must paint the lens ring");
  assert.match(chrome, /#respawn-card/, "chrome.css must plate the respawn card");
});

test("name tags and pad labels ride team and pickup accents (issue #349)", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  const css = fs.readFileSync(HUD_CSS, "utf8");
  const tag = ruleBody(css, ".nametag");
  assert.match(tag, /border-left/, "name tags must carry the team rail");
  const pads = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "ui", "padlabels.ts"),
    "utf8",
  );
  assert.match(pads, /pickupPaintFor/, "pad labels must read the pickup accent");
  assert.match(pads, /data-accent/, "pad labels must mirror the accent for probes");
  const char = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "view", "character.ts"),
    "utf8",
  );
  assert.match(char, /teamCss/, "name tags must source team colors");
});

test("static toast accent covers both grenade spellings with the gold token (issue #361)", () => {
  const html = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(
    html,
    /data-kind="grenades"/,
    "index.html must carry the plural grenades toast accent",
  );
  assert.match(
    html,
    /data-kind="grenade"/,
    "index.html must carry the singular grenade toast accent",
  );
  const accent = html.slice(
    html.indexOf('data-kind="grenade"'),
    html.indexOf('data-kind="grenade"') + 200,
  );
  assert.match(accent, /var\(--color-gold\)/, "grenade accents must read the gold token");
});
