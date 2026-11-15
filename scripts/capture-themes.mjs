// Theme cohesion captures (#205): headless-Chromium screenshots, one
// settled 1920x1080 mid-match frame per map into
// docs/benchmark/themes/<map>.png, each gated live on the rendered
// subset (window.__game.backdropLayers must sit inside the theme
// declaration or the run fails naming the undeclared ids). Mirrors the
// verify-presentation mid-match leg: build the client if dist/ is
// missing, spawn server.js on a free port, puppeteer-core at 1920x1080
// deviceScaleFactor 1, `?bots=1&tier=normal&map=<each>`, wait for
// `__game.theme===map && tilesDrawn>0`, settle 2.5 s, assert >50KB (one
// held-fire re-take under muzzle/tracer entropy when thin), assert the
// IHDR size is exactly 1920x1080, then prove every pair differs by >5%.
// Node:* plus puppeteer-core only (no repo imports): stays out of
// `npm test` and CI on purpose (no browser there). Regenerate with
// `npm run capture:themes`.
/* global window:readonly */
// (Browser globals above appear only inside page.evaluate /
// waitForFunction callbacks, which execute in Chromium, not in node.)
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCohesion } from "./cohesion-check.mjs";
import {
  decodePngRgbFile,
  histogramDelta,
  pngInfoBytes,
} from "./verify/benchmark-compare.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const THEMES_DIR = path.join(ROOT, "docs", "benchmark", "themes");
// Settled gameplay-frame budget: thin/blank captures stay far below it.
const MIN_THEME_PNG_BYTES = 50 * 1024;
// Pairwise theme distinctness floor: warm/cool/neutral grades land near
// 35%+ pixel delta, so 5% proves distinct themes with wide margin.
const MIN_HISTOGRAM_DELTA = 0.05;
const MAPS = ["kilima", "dune", "frostbite"];

function log(message) {
  console.log(`[capture-themes] ${message}`);
}

function fail(message) {
  console.error(`[capture-themes] FAIL: ${message}`);
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
      if (res.status === 200 && text.includes('"status":"ok"') && text.includes('"ok":true')) {
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

/** Client module readiness: input mirror exists (set at module top). */
async function waitForClientReady(page) {
  await page.waitForFunction(() => typeof window.__scraplineTick === "number", {
    timeout: 15000,
    polling: 100,
  });
}

/**
 * Screenshot with a held-fire re-take: when the first frame is thin
 * (<50KB), aim at canvas center and hold fire for 2 s (muzzle/tracer
 * entropy, mirroring the presentation combat leg), then shoot once more
 * before accepting. Returns the on-disk byte count.
 */
async function shoot(page, file) {
  await page.screenshot({ path: file });
  let bytes = fs.statSync(file).size;
  if (bytes > MIN_THEME_PNG_BYTES) {
    return bytes;
  }
  log(`${path.basename(file)} is thin (${bytes} bytes) — re-taking under fire`);
  const box = await (await page.$("#game")).boundingBox();
  assert(box !== null, "game canvas has no layout box for the fire re-take");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await sleep(2000);
    await page.screenshot({ path: file });
  } finally {
    await page.mouse.up();
  }
  bytes = fs.statSync(file).size;
  return bytes;
}

async function run() {
  let builtIndex = path.join(ROOT, "packages", "client", "dist", "index.html");
  if (!fs.existsSync(builtIndex)) {
    log("dist/ missing — running `npm run build:client` first.");
    execSync("npm run build:client", { cwd: ROOT, stdio: "inherit" });
  }
  builtIndex = path.join(ROOT, "packages", "client", "dist", "index.html");
  assert(fs.existsSync(builtIndex), "missing packages/client/dist/index.html after build");
  const chromePath = resolveChrome();
  assert(chromePath !== null, "no system Chromium found (CHROME_PATH, /usr/bin/chromium)");
  log(`chromium: ${chromePath}`);
  let puppeteer = null;
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    fail("missing puppeteer-core — run `npm install` first.");
  }

  fs.mkdirSync(THEMES_DIR, { recursive: true });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-themes-"));
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
      defaultViewport: { width: 1920, height: 1080 },
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

    // Mid-match leg per map: direct arena entry via the auto-join query,
    // then a settled themed frame (theme mirror + drawn tiles + the
    // rendered-subset-of-declared cohesion gate).
    for (const map of MAPS) {
      await page.goto(`${base}/?bots=1&tier=normal&map=${map}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await waitForClientReady(page);
      await page.waitForFunction(
        (expected) =>
          window.__game !== undefined &&
          window.__game !== null &&
          window.__game.theme === expected &&
          window.__game.tilesDrawn > 0,
        { timeout: 20000, polling: 100 },
        map,
      );
      // Settle the sim before capturing the frame.
      await sleep(2500);
      const snap = await page.evaluate(() => ({
        theme: window.__game.theme,
        tilesDrawn: window.__game.tilesDrawn,
        backdropLayers: window.__game.backdropLayers,
      }));
      assert(snap.theme === map, `__game.theme is ${snap.theme}, expected ${map}`);
      assert(snap.tilesDrawn > 0, `${map}: no tiles drawn`);
      const gate = checkCohesion(snap.backdropLayers, map);
      assert(
        gate.ok,
        `${map}: undeclared backdrop layer(s): ${gate.undeclared.join(", ")}`,
      );
      const shot = path.join(THEMES_DIR, `${map}.png`);
      const bytes = await shoot(page, shot);
      assert(bytes > MIN_THEME_PNG_BYTES, `${map}.png is ${bytes} bytes, expected >50KB`);
      const info = pngInfoBytes(fs.readFileSync(shot));
      assert(
        info.width === 1920 && info.height === 1080,
        `${map}.png is ${info.width}x${info.height}, expected 1920x1080`,
      );
      log(
        `${map} ok (theme=${map} tiles=${snap.tilesDrawn} layers=${snap.backdropLayers.join(",")} ${(bytes / 1024).toFixed(1)}KB)`,
      );
    }

    // Theme-distinctness guard: every pair differs by >5%.
    const decoded = new Map();
    for (const map of MAPS) {
      decoded.set(map, decodePngRgbFile(path.join(THEMES_DIR, `${map}.png`)));
    }
    for (let i = 0; i < MAPS.length; i += 1) {
      for (let j = i + 1; j < MAPS.length; j += 1) {
        const pair = `${MAPS[i]}-vs-${MAPS[j]}`;
        const delta = histogramDelta(decoded.get(MAPS[i]), decoded.get(MAPS[j]));
        assert(
          delta > MIN_HISTOGRAM_DELTA,
          `${pair} pixel delta ${(delta * 100).toFixed(2)}% is below the 5% theme floor`,
        );
        log(`histogram ${pair}: ${(delta * 100).toFixed(2)}% differ`);
      }
    }
    log("ALL GREEN: theme captures passed");
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

run().catch((err) => {
  if (process.exitCode === 0) {
    process.exitCode = 1;
  }
  console.error(`[capture-themes] ${err && err.message ? err.message : err}`);
});
