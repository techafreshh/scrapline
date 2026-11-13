// Black-box feel-parity verification: fresh profile quick-play on kilima,
// mid-match tracers/shake/audio/zoom, force match end, standings with
// Winner, settings/volume round-trip, replay on dune/hard, back to menu,
// plus an SFX-only scope guard. Saves shots/feel-parity/*.png.
//
// Zero repo dependencies (node:* only, like server.js): the only external
// module is puppeteer-core driving the preinstalled system Chromium.
// Stays out of `npm test` and CI on purpose: CI runners have no browser.
/* global window, document, getComputedStyle, HTMLElement:readonly */
// (Browser globals above appear only inside page.evaluate /
// waitForFunction callbacks, which execute in Chromium, not in node.)
const { spawn, execSync } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");
const SHOTS_DIR = path.join(ROOT, "shots", "feel-parity");
const REQUIRED_PNGS = ["menu.png", "setup.png", "midmatch.png", "standings.png"];
// Fresh-profile recognition budget: the landing leg must land well under it.
const RECOGNITION_BUDGET_MS = 30000;
const MIN_PNG_BYTES = 5 * 1024;
/** localStorage key for the persisted master volume (settings.ts). */
const VOLUME_KEY = "scrapline.settings.volume";
/** Whole-word UI-text patterns that must never appear (SFX only). */
const OUT_OF_SCOPE = [
  /\bmultiplayer\b/i,
  /\bprogression\b/i,
  /\btouch-controls?\b/i,
  /\bmusic(?:-track)?\b/i,
];

function log(message) {
  console.log(`[feel-parity] ${message}`);
}

function fail(message) {
  console.error(`[feel-parity] FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Free loopback port for the spawned server (skeleton.test.js idiom). */
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

/**
 * Resolve system Chromium: CHROME_PATH, then well-known paths, then a
 * `which` lookup. Returns null when no browser is installed.
 */
function resolveChrome() {
  const candidates = [];
  if (process.env.CHROME_PATH) {
    candidates.push(process.env.CHROME_PATH);
  }
  candidates.push("/usr/bin/chromium", "/usr/bin/google-chrome");
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Unreadable candidate: fall through to the lookup below.
    }
  }
  try {
    const found = execSync("which chromium || which google-chrome || true", {
      encoding: "utf8",
    })
      .split("\n")[0]
      .trim();
    if (found) {
      return found;
    }
  } catch {
    // No `which` output: no browser on PATH.
  }
  return null;
}

/** Poll /api/health until the spawned server answers (skeleton idiom). */
async function waitForHealth(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      const text = await res.text();
      if (res.status === 200 && text.includes('"status":"ok"')) {
        return;
      }
      lastError = new Error(`unexpected health: ${res.status} ${text}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(100);
  }
  throw new Error(`server did not become healthy in time: ${lastError}`);
}

/** Client module readiness: input mirror tick exists (set at module top). */
async function waitForClientReady(page) {
  await page.waitForFunction(() => typeof window.__scraplineTick === "number", {
    timeout: 15000,
    polling: 100,
  });
}

/** Visible text of the served page: tags, scripts, and styles stripped. */
function visibleTextOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

async function run() {
  const builtIndex = path.join(ROOT, "packages", "client", "dist", "index.html");
  if (!fs.existsSync(builtIndex)) {
    fail(`missing ${builtIndex} — run \`npm run build:client\` first.`);
  }
  const chromePath = resolveChrome();
  assert(chromePath !== null, "no system Chromium found (CHROME_PATH, /usr/bin/chromium)");
  log(`chromium: ${chromePath}`);
  let puppeteer = null;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    fail("missing puppeteer-core — run `npm install` first.");
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Fresh profile: an empty user-data-dir per run (empty localStorage).
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-feel-"));
  let browser = null;
  try {
    await waitForHealth(base, 10000);
    log(`server healthy at ${base}`);

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--autoplay-policy=no-user-gesture-required",
        "--mute-audio",
        "--enable-unsafe-swiftshader",
      ],
      userDataDir: profileDir,
      defaultViewport: { width: 1280, height: 800 },
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Landing leg: fresh profile, menu with Quick Play, time-to-interactive.
    const t0 = Date.now();
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Menu paints from static HTML instantly; the click handlers attach
    // only once the client module evaluates, so gate every click on it.
    await waitForClientReady(page);
    await page.waitForFunction(
      () => {
        const m = document.getElementById("menu");
        return m !== null && getComputedStyle(m).display !== "none";
      },
      { timeout: 15000, polling: 100 },
    );
    const ttiMs = Date.now() - t0;
    assert(ttiMs < RECOGNITION_BUDGET_MS, `time-to-interactive ${ttiMs}ms exceeds 30s budget`);
    log(`time-to-interactive: ${ttiMs}ms`);
    for (const id of ["#quick-play", "#play", "#settings-open", "#howto-open"]) {
      const handle = await page.$(id);
      assert(handle !== null, `missing ${id} on fresh-profile landing`);
    }
    const quickText = await page.$eval("#quick-play", (el) => el.textContent || "");
    assert(/Quick Play/i.test(quickText), `#quick-play reads ${JSON.stringify(quickText)}`);
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS_DIR, "menu.png") });
    log("leg 1/6 landing ok (menu.png)");

    // Setup leg: Play vs bots overlay, stepper plus tier/map buttons.
    await page.click("#play");
    await page.waitForFunction(
      () => {
        const s = document.getElementById("setup");
        return s !== null && getComputedStyle(s).display !== "none";
      },
      { timeout: 10000, polling: 100 },
    );
    for (const id of ["#bots-minus", "#bots-value", "#bots-plus"]) {
      const handle = await page.$(id);
      assert(handle !== null, `setup overlay missing ${id}`);
    }
    const tierCount = await page.$$eval('[data-tier]', (els) => els.length);
    const mapCount = await page.$$eval('[data-map]', (els) => els.length);
    assert(tierCount >= 3, `expected tier buttons, found ${tierCount}`);
    assert(mapCount >= 3, `expected map buttons, found ${mapCount}`);
    const botsValue = await page.$eval("#bots-value", (el) => (el.textContent || "").trim());
    assert(botsValue === "3", `default bots reads ${JSON.stringify(botsValue)}, expected "3"`);
    await page.screenshot({ path: path.join(SHOTS_DIR, "setup.png") });
    log("leg 2/6 setup ok (setup.png)");

    // Back to a clean landing, then quick-play the default kilima match.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForClientReady(page);
    await page.waitForFunction(
      () => {
        const m = document.getElementById("menu");
        return m !== null && getComputedStyle(m).display !== "none";
      },
      { timeout: 15000, polling: 100 },
    );
    await page.click("#quick-play");
    await page.waitForFunction(() => window.__matchConfig !== null, {
      timeout: 15000,
      polling: 100,
    });
    const quickConfig = await page.evaluate(() => window.__matchConfig);
    assert(
      quickConfig !== null &&
        quickConfig.bots === 3 &&
        quickConfig.tier === "normal" &&
        quickConfig.map === "kilima",
      `quick-play config ${JSON.stringify(quickConfig)}, expected kilima/normal/3`,
    );
    log(`leg 3/6 quick-play ok ${JSON.stringify(quickConfig)}`);

    // Mid-match leg: canvas reveal, combat FX, zoom, settings/volume, SFX.
    await page.waitForFunction(
      () => {
        const el = document.getElementById("loading");
        return el === null || getComputedStyle(el).display === "none";
      },
      { timeout: 20000, polling: 100 },
    );
    await page.waitForFunction(
      () => {
        const c = document.getElementById("game");
        return c !== null && c.style.visibility === "visible";
      },
      { timeout: 20000, polling: 100 },
    );
    await page.waitForFunction(() => window.__scraplineWorld !== null, {
      timeout: 15000,
      polling: 100,
    });
    const canvasBox = await (await page.$("#game")).boundingBox();
    assert(canvasBox !== null, "game canvas has no layout box");
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "left" });
    await page.keyboard.down("d");
    let seenTracers = false;
    let maxTrauma = 0;
    let maxShake = 0;
    let audioNames = [];
    let threwGrenade = false;
    let strafeLeft = false;
    let lastStrafeFlip = Date.now();
    const combatEnd = Date.now() + 25000;
    while (Date.now() < combatEnd) {
      if (Date.now() - lastStrafeFlip > 2000) {
        await page.keyboard.up(strafeLeft ? "a" : "d");
        strafeLeft = !strafeLeft;
        await page.keyboard.down(strafeLeft ? "a" : "d");
        lastStrafeFlip = Date.now();
      }
      await page.mouse.move(cx + 60 * Math.sin(Date.now() / 400), cy - 20, { steps: 2 });
      if (!threwGrenade && Date.now() > combatEnd - 21000) {
        await page.keyboard.press("g");
        threwGrenade = true;
      }
      const snap = await page.evaluate(() => ({
        tracers:
          window.__scraplineDebug && window.__scraplineDebug.tracers
            ? window.__scraplineDebug.tracers.length
            : 0,
        trauma: window.__camera !== null ? window.__camera.trauma : 0,
        shakeX: window.__camera !== null ? Math.abs(window.__camera.shakeX) : 0,
        shakeY: window.__camera !== null ? Math.abs(window.__camera.shakeY) : 0,
        debugTrauma:
          window.__scraplineDebug && typeof window.__scraplineDebug.trauma === "number"
            ? window.__scraplineDebug.trauma
            : 0,
        audio:
          window.__audio && window.__audio.lastPlayed
            ? window.__audio.lastPlayed.map((e) => e.name)
            : [],
      }));
      if (snap.tracers > 0) {
        seenTracers = true;
      }
      maxTrauma = Math.max(maxTrauma, snap.trauma, snap.debugTrauma);
      maxShake = Math.max(maxShake, snap.shakeX, snap.shakeY);
      audioNames = snap.audio;
      if (seenTracers && maxTrauma > 0.02 && audioNames.length > 0) {
        break;
      }
      await sleep(100);
    }
    await page.mouse.up({ button: "left" });
    await page.keyboard.up(strafeLeft ? "a" : "d");
    assert(seenTracers, "no tracers observed in __scraplineDebug during combat");
    assert(
      maxTrauma > 0.02 || maxShake > 0.05,
      `no shake observed (maxTrauma=${maxTrauma} maxShake=${maxShake})`,
    );
    assert(audioNames.length > 0, "no SFX entries in __audio.lastPlayed during combat");
    for (const name of audioNames) {
      assert(!/music/i.test(name), `non-SFX voice in lastPlayed: ${name}`);
    }
    log(
      `combat fx ok (tracers seen, maxTrauma=${maxTrauma.toFixed(3)} ` +
        `maxShake=${maxShake.toFixed(2)} audio=${audioNames.slice(-4).join(",")})`,
    );

    // Zoom leg: Z cycles the camera off 1x.
    const zoomBefore = await page.evaluate(() => (window.__camera !== null ? window.__camera.zoom : null));
    await page.keyboard.press("z");
    await page.waitForFunction(() => window.__camera !== null && window.__camera.targetZoom !== 1, {
      timeout: 5000,
      polling: 100,
    });
    await sleep(700);
    const zoomAfter = await page.evaluate(() => ({
      zoom: window.__camera !== null ? window.__camera.zoom : null,
      targetZoom: window.__camera !== null ? window.__camera.targetZoom : null,
    }));
    assert(
      zoomAfter.targetZoom !== 1 && Math.abs((zoomAfter.zoom ?? 1) - 1) > 0.01,
      `zoom did not cycle (before=${zoomBefore} after=${JSON.stringify(zoomAfter)})`,
    );
    log(`zoom ok (1 -> ${zoomAfter.targetZoom}, eased ${zoomAfter.zoom})`);

    // Settings/volume leg: open the overlay, move the slider, check storage.
    await page.evaluate(() => {
      const open = document.getElementById("settings-open");
      if (open instanceof HTMLElement) {
        open.click();
      }
    });
    await page.waitForFunction(
      () => {
        const s = document.getElementById("settings");
        return s !== null && getComputedStyle(s).display !== "none";
      },
      { timeout: 10000, polling: 100 },
    );
    await page.$eval("#volume", (el) => {
      el.value = "0.3";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const storedVolume = await page.evaluate((key) => window.localStorage.getItem(key), VOLUME_KEY);
    assert(storedVolume === "0.3", `volume persisted as ${JSON.stringify(storedVolume)}, expected "0.3"`);
    const sfxCount = await page.evaluate(() =>
      window.__audio && window.__audio.lastPlayed ? window.__audio.lastPlayed.length : 0,
    );
    assert(sfxCount > 0, "settings leg found no SFX entries in __audio.lastPlayed");
    await page.click("#settings-close");
    await page.screenshot({ path: path.join(SHOTS_DIR, "midmatch.png") });
    log("leg 4/6 mid-match ok (midmatch.png, volume=0.3, zoom cycled)");

    // Standings leg: force the kilima match end, read the Winner callout.
    await page.evaluate(() => {
      const world = window.__scraplineWorld;
      if (world === null) {
        throw new Error("no world to force-end");
      }
      world.scores[0] = world.scoreLimit;
    });
    await page.waitForFunction(
      () => {
        const s = document.getElementById("end-screen");
        return s !== null && getComputedStyle(s).display !== "none";
      },
      { timeout: 10000, polling: 100 },
    );
    const winnerText = await page.$eval("#end-winner", (el) => el.textContent || "");
    assert(/Winner:/.test(winnerText), `#end-winner reads ${JSON.stringify(winnerText)}`);
    const standingRows = await page.$$eval("#end-standings tr", (els) => els.length);
    assert(standingRows >= 2, `expected standings rows, found ${standingRows}`);
    await page.screenshot({ path: path.join(SHOTS_DIR, "standings.png") });
    log(`leg 5/6 standings ok (${winnerText.trim()}, ${standingRows} rows)`);

    // Replay leg: menu, setup to dune/hard, start again, force end, menu.
    await page.click("#end-menu");
    await page.waitForFunction(
      () => {
        const m = document.getElementById("menu");
        return m !== null && getComputedStyle(m).display !== "none";
      },
      { timeout: 10000, polling: 100 },
    );
    await page.click("#play");
    await page.waitForFunction(
      () => {
        const s = document.getElementById("setup");
        return s !== null && getComputedStyle(s).display !== "none";
      },
      { timeout: 10000, polling: 100 },
    );
    await page.click('[data-map="dune"]');
    await page.click('[data-tier="hard"]');
    await page.click("#btn-start");
    await page.waitForFunction(
      () => window.__matchConfig !== null && window.__matchConfig.map === "dune",
      { timeout: 15000, polling: 100 },
    );
    const replayConfig = await page.evaluate(() => window.__matchConfig);
    assert(
      replayConfig !== null &&
        replayConfig.map === "dune" &&
        replayConfig.tier === "hard" &&
        replayConfig.bots === 3,
      `replay config ${JSON.stringify(replayConfig)}, expected dune/hard/3`,
    );
    const persisted = await page.evaluate(() => ({
      tier: window.localStorage.getItem("scrapline.setup.tier"),
      map: window.localStorage.getItem("scrapline.setup.map"),
    }));
    assert(
      persisted.tier === "hard" && persisted.map === "dune",
      `persisted setup ${JSON.stringify(persisted)}, expected hard/dune`,
    );
    await page.evaluate(() => {
      const world = window.__scraplineWorld;
      if (world === null) {
        throw new Error("no replay world to force-end");
      }
      world.scores[0] = world.scoreLimit;
    });
    await page.waitForFunction(
      () => {
        const s = document.getElementById("end-screen");
        return s !== null && getComputedStyle(s).display !== "none";
      },
      { timeout: 10000, polling: 100 },
    );
    await page.click("#end-menu");
    await page.waitForFunction(
      () => {
        const m = document.getElementById("menu");
        return m !== null && getComputedStyle(m).display !== "none";
      },
      { timeout: 10000, polling: 100 },
    );
    log("leg 6/6 replay ok (dune/hard -> menu)");

    // Scope guard: served UI text exposes no out-of-scope affordances.
    const res = await fetch(`${base}/`);
    assert(res.status === 200, `scope-guard GET / returned ${res.status}`);
    const html = await res.text();
    const visible = visibleTextOf(html);
    for (const pattern of OUT_OF_SCOPE) {
      assert(!pattern.test(visible), `out-of-scope UI text matches ${pattern}`);
    }
    log("scope guard ok (SFX only, no multiplayer/progression/touch/music)");

    // Screenshot evidence: all four frames present and non-trivial.
    for (const name of REQUIRED_PNGS) {
      const file = path.join(SHOTS_DIR, name);
      assert(fs.existsSync(file), `missing screenshot ${name}`);
      const bytes = fs.statSync(file).size;
      assert(bytes > MIN_PNG_BYTES, `${name} is ${bytes} bytes, expected >5KB`);
      log(`shot ok: ${name} (${(bytes / 1024).toFixed(1)}KB)`);
    }
    log("ALL GREEN: feel-parity verification passed");
  } finally {
    if (browser !== null) {
      try {
        await browser.close();
      } catch {
        // Closing a half-launched browser must not mask the run result.
      }
    }
    child.kill();
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup only.
    }
  }
}

if (require.main === module) {
  run().catch((err) => {
    if (process.exitCode === 0) {
      process.exitCode = 1;
    }
    console.error(`[feel-parity] ${err && err.message ? err.message : err}`);
  });
}

module.exports = { freePort, resolveChrome, visibleTextOf, SHOTS_DIR };
