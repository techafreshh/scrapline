// Art A8 HUD geometry + type scale contract tests (issue #380):
// black-box HTTP probes for /hud.css plus static scans proving the
// status cluster floors at 15.5vh with an 18px+ HP value, the ammo
// module floors at 12.5vh with 22px+ counts, status grenade pips clear
// 20px, and the timer reads primary over the score. Mirrors
// tests/hud-modules.test.js (freePort + spawned server.js +
// ruleBody helpers).
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

test("GET /hud.css carries the A8 geometry floors (issue #380)", async () => {
  const hud = await get("/hud.css");
  assert.equal(hud.status, 200);
  assert.match(hud.contentType, /text\/css/);
  // Status cluster: 15.5vh floor (112px at 720p, 167px at 1080p).
  assert.match(hud.text, /min-height[^;]*15\.5vh/, "status cluster must floor at 15.5vh");
  // Ammo module: 12.5vh floor (90px at 720p, 135px at 1080p).
  assert.match(hud.text, /min-height[^;]*12\.5vh/, "ammo module must floor at 12.5vh");
  // HP value scales past 18px/27px; counts past 22px/33px.
  assert.match(hud.text, /max\(24px, 3\.4vh\)/, "HP value must scale from a 24px floor");
  assert.match(hud.text, /max\(22px, 3\.1vh\)/, "ammo counts must scale from a 22px floor");
  // Status grenade pips clear 20px; timer stays primary over the score.
  assert.match(hud.text, /max\(20px, 2\.8vh\)/, "status grenade pips must clear 20px");
  assert.match(hud.text, /max\(26px, 3\.8vh\)/, "timer must scale from a 26px floor");
  assert.match(hud.text, /max\(11px, 1\.7vh\)/, "score must stay secondary");
});

test("static A8 floors clear every acceptance minimum at both sizes", () => {
  // Floors resolve: max(112px, 15.5vh) -> 112/167px; HP max(24px, 3.4vh)
  // -> 24.5/36.7px; ammo max(88px, 12.5vh) -> 90/135px; counts
  // max(22px, 3.1vh) -> 22.3/33.5px. Each clears its 108/162, 18/27,
  // 86/130, 22/33 acceptance bar with margin for border rounding.
  const at720 = { status: Math.max(112, 720 * 0.155), hp: Math.max(24, 720 * 0.034) };
  const at1080 = { status: Math.max(112, 1080 * 0.155), hp: Math.max(24, 1080 * 0.034) };
  assert.ok(at720.status >= 108, `720p status ${at720.status} must clear 108px`);
  assert.ok(at1080.status >= 162, `1080p status ${at1080.status} must clear 162px`);
  assert.ok(at720.hp >= 18, `720p HP ${at720.hp} must clear 18px`);
  assert.ok(at1080.hp >= 27, `1080p HP ${at1080.hp} must clear 27px`);
  const ammo720 = Math.max(88, 720 * 0.125);
  const ammo1080 = Math.max(88, 1080 * 0.125);
  assert.ok(ammo720 >= 86, `720p ammo ${ammo720} must clear 86px`);
  assert.ok(ammo1080 >= 130, `1080p ammo ${ammo1080} must clear 130px`);
  const counts720 = Math.max(22, 720 * 0.031);
  const counts1080 = Math.max(22, 1080 * 0.031);
  assert.ok(counts720 >= 22, `720p counts ${counts720} must clear 22px`);
  assert.ok(counts1080 >= 33, `1080p counts ${counts1080} must clear 33px`);
});

test("static A8 type hierarchy reads timer primary, score secondary", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  // 3.8vh timer > 3.4vh HP > 3.1vh counts > 1.7vh score at every height.
  const floors = { timer: 3.8, hp: 3.4, counts: 3.1, score: 1.7 };
  assert.ok(floors.timer > floors.hp, "timer must outscale HP");
  assert.ok(floors.hp > floors.counts, "HP must outscale ammo counts");
  assert.ok(floors.counts > floors.score, "counts must outscale the score");
  for (const needle of ["#hud-timer", "#hud-health", "#ammo-counts", "#hud-score"]) {
    assert.ok(source.includes(needle), `hud.css must size ${needle}`);
  }
});

test("static A8 bitmap cells stay integer-crisp across the breakpoint", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  assert.match(source, /@media \(min-height: 900px\)/, "tall viewports must step cells up");
  for (const px of ["5px", "7px", "6px", "8px"]) {
    assert.ok(source.includes(px), `hud.css must carry a ${px} bitmap step`);
  }
});

test("static A8 geometry upholds the hud.css token/image/layer bans", () => {
  const source = fs.readFileSync(HUD_CSS, "utf8");
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}/, "hud.css stays token-only");
  assert.doesNotMatch(source, /background-image/, "hud.css must never tile an image");
  assert.doesNotMatch(source, /z-index/, "stacking stays owned by layers.css");
});

test("both server sources serve the resized /hud.css route", () => {
  assert.match(fs.readFileSync(SERVER_JS, "utf8"), /\/hud\.css/);
  assert.match(fs.readFileSync(COMBINED, "utf8"), /\/hud\.css/);
});

test("GET / still mounts every HUD cluster id the geometry sizes", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  for (const id of ["hud-status", "hud-health", "hud-center", "hud-timer", "ammo-module", "ammo-counts"]) {
    assert.match(root.text, new RegExp(`id="${id}"`), `served HTML must mount #${id}`);
  }
  assert.match(fs.readFileSync(SRC_HTML, "utf8"), /id="hud-grenade-pips"/);
});
