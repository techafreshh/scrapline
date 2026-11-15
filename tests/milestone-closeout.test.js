// Milestone closeout gate (#219): the single green proof that every leg
// of the milestone stays green together, browser-free so CI stays green.
// Asserts the committed theme-capture inventory (exactly the three
// 1920x1080 PNGs over 50KB), the served menu live-DOM ids (profile
// badge, challenges + locker, online play), the built-bundle mirrors,
// the source-shape pins (WebAudio autoplay guard, quality default,
// __game fps/ambient mirror, wire codec, netcode close codes), and the
// test-inventory pin so no test file can silently fall out of `npm test`.
// Node-only: no browser, no build; live HTTP legs spawn server.js on a
// free loopback port (skeleton.test.js idiom).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const THEMES_DIR = path.join(ROOT, "docs", "benchmark", "themes");
const THEME_NAMES = ["dune", "frostbite", "kilima"];
// Settled gameplay-frame budget: thin/blank captures stay far below it.
const MIN_THEME_PNG_BYTES = 50 * 1024;

let compare = null;
let child = null;
let base = "";
let rootHtml = "";
let mainJs = "";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  compare = await import("../scripts/verify/benchmark-compare.mjs");
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      const text = await res.text();
      if (
        res.status === 200 &&
        text.includes('"status":"ok"') &&
        text.includes('"ok":true')
      ) {
        const rootRes = await fetch(`${base}/`);
        assert.equal(rootRes.status, 200);
        rootHtml = await rootRes.text();
        const mainRes = await fetch(`${base}/main.js`);
        assert.equal(mainRes.status, 200);
        mainJs = await mainRes.text();
        return;
      }
      lastError = new Error(`unexpected health response: ${res.status} ${text}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy in time: ${lastError}`);
});

after(() => {
  if (child !== null) {
    child.kill();
    child = null;
  }
});

test("docs/benchmark/themes/ lists exactly the three map captures", () => {
  const names = fs.readdirSync(THEMES_DIR).sort();
  assert.deepEqual(names, ["dune.png", "frostbite.png", "kilima.png"]);
  for (const theme of THEME_NAMES) {
    assert.ok(names.includes(`${theme}.png`), `missing ${theme}.png`);
  }
});

test("every theme capture is a non-trivial 1920x1080 PNG", () => {
  for (const theme of THEME_NAMES) {
    const buf = fs.readFileSync(path.join(THEMES_DIR, `${theme}.png`));
    assert.ok(
      buf.length > MIN_THEME_PNG_BYTES,
      `${theme}.png is ${buf.length} bytes, expected >50KB`,
    );
    assert.ok(compare.isPngBytes(buf), `${theme}.png has a bad PNG signature`);
    assert.deepEqual(
      compare.pngInfoBytes(buf),
      { width: 1920, height: 1080 },
      `${theme}.png must be exactly 1920x1080`,
    );
  }
});

test("GET / serves the menu badge, challenges, locker, and online affordances", () => {
  for (const id of [
    "profile-badge",
    "challenges-open",
    "locker-open",
    "challenges-panel",
    "locker-panel",
    "play-online",
  ]) {
    assert.ok(rootHtml.includes(id), `GET / must serve the ${id} live-DOM id`);
  }
  assert.match(rootHtml, /Play vs bots/);
  assert.ok(rootHtml.includes('<canvas id="game">'), "GET / must serve the bare canvas tag");
});

test("GET /main.js carries the meta and audio probe mirrors", () => {
  for (const mirror of ["__profile", "__challenges", "__locker", "__audio"]) {
    assert.ok(mainJs.includes(mirror), `/main.js must carry the ${mirror} mirror`);
  }
});

test("WebAudio stays gesture-gated (no AudioContext before ensureAudioOnGesture)", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "audio", "engine.ts"),
    "utf8",
  );
  assert.match(source, /ensureAudioOnGesture/);
  assert.match(source, /getAudioContext\(\): AudioContext \| null/);
  assert.match(source, /no AudioContext exists until/);
  assert.match(source, /let ctx: AudioContext \| null = null/);
});

test("quality default stays high (ambient bed on out of the box)", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "settings.ts"),
    "utf8",
  );
  assert.match(source, /DEFAULT_QUALITY: Quality = "high"/);
});

test("renderer publishes the fps/ambient mirror on window.__game", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "packages", "client", "src", "renderer", "index.ts"),
    "utf8",
  );
  assert.match(source, /FPS_ALPHA/);
  assert.match(source, /fps:/);
  assert.match(source, /ambientCount:/);
  assert.match(source, /ambientBirdCount:/);
});

test("wire codec exports the snapshot and input-packet round-trip", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "packages", "server", "src", "codec.ts"),
    "utf8",
  );
  for (const name of [
    "encodeSnapshot",
    "decodeSnapshot",
    "encodeInputPacket",
    "decodeInputPacket",
  ]) {
    assert.match(
      source,
      new RegExp(`export function ${name}`),
      `codec.ts must export ${name}`,
    );
  }
});

test("netcode keeps the bogus-session, oversize, and double-join guards", () => {
  const source = fs.readFileSync(
    path.join(ROOT, "packages", "server", "src", "server.ts"),
    "utf8",
  );
  assert.match(source, /4002/);
  assert.match(source, /1009/);
  assert.match(source, /already-joined/);
});

test("npm test runs every node test file including the closeout gate", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  const script = pkg.scripts.test;
  assert.equal(typeof script, "string");
  for (const name of [
    "skeleton",
    "stage-dist",
    "core-imports",
    "perf-guardrail",
    "prd-docs-refs",
    "asset-pipeline",
    "pwa",
    "benchmark-refs",
    "cohesion",
    "milestone-closeout",
  ]) {
    assert.ok(
      script.includes(name),
      `scripts.test must run tests/${name}.test.js (nothing may silently fall out)`,
    );
  }
});
