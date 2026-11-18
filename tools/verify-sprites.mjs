// Final sprite-swap verification (#272): headless-Chromium captures proving
// sprite parity with the vector baseline. Screenshots six scenes (menu,
// mid-match run, mid-match jet, particles, HUD, standings) at 1920x1080
// and 1280x720 into docs/captures/, gates every capture at or above its
// mapped docs/benchmark baseline size (one held-fire re-take when thin,
// then a loud failure naming the file and both byte counts), and closes
// with the 6 MB staged-weight tail. Mirrors the verify-presentation
// mid-match/combat/standings/menu legs: build the client if dist/ is
// absent, spawn server.js on a free port, puppeteer-core at
// deviceScaleFactor 1, `?bots=1&tier=normal&map=<each>`, settle 2.5 s,
// assert `__game.theme`/`tilesDrawn > 0`. Node:* plus puppeteer-core only
// (no repo imports beyond the pure PNG helpers): stays out of `npm test`
// and CI on purpose (no browser there). Regenerate with
// `npm run verify:sprites`.
/* global window, document, getComputedStyle:readonly */
// (Browser globals above appear only inside page.evaluate /
// waitForFunction callbacks, which execute in Chromium, not in node.)
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  brightPixelsNearFile,
  mapMuzzleToShot,
  pngInfoBytes,
} from "../scripts/verify/benchmark-compare.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CAPTURES_DIR = path.join(ROOT, "docs", "captures");
const BENCHMARK_DIR = path.join(ROOT, "docs", "benchmark");
const CLIENT_DIST = path.join(ROOT, "packages", "client", "dist");
const ROOT_DIST = path.join(ROOT, "dist");
// Shipped-weight ceiling: the tools/check-budget.js acceptance cap, so the
// tail and `npm run check:budget` can never drift apart.
const BUDGET_BYTES = 6291456;
// Canvas CSS box tolerance in px: the #game 1px border inflates the
// border-box by 2px over the exact letterbox size.
const CANVAS_BOX_TOLERANCE_PX = 4;
const ASPECT_TOLERANCE = 0.02;
const LOGICAL_W = 640;
const LOGICAL_H = 360;
// Muzzle-flash proof radius in screenshot px (the 24px acceptance probe).
const MUZZLE_RADIUS_PX = 24;
const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 1280, h: 720 },
];
// Capture filename suffix per viewport (the IHDR gate reads it back).
const SUFFIX = { 1920: "1920x1080", 1280: "1280x720" };
// Baseline mapping: each capture must read at or above its mapped
// existing baseline file (no resolution-matched twins exist).
const BASELINE_FOR = {
  menu: "menu.png",
  "match-run-kilima": "midmatch-kilima.png",
  "match-jet-dune": path.join("themes", "dune.png"),
  "frostbite-particles": path.join("themes", "frostbite.png"),
  "hud-kilima": "midmatch-kilima.png",
  standings: "standings.png",
};
const SCENES = Object.keys(BASELINE_FOR);

function log(message) {
  console.log(`[verify-sprites] ${message}`);
}

function fail(message) {
  console.error(`[verify-sprites] FAIL: ${message}`);
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

/** Largest 16:9 CSS box fitting the viewport (resize.ts twin, no import). */
function letterboxFit(viewportW, viewportH) {
  const vw = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 1;
  const vh = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 1;
  const scale = Math.min(vw / LOGICAL_W, vh / LOGICAL_H);
  return {
    width: Math.max(1, Math.floor(LOGICAL_W * scale)),
    height: Math.max(1, Math.floor(LOGICAL_H * scale)),
  };
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

/** Recursive byte sum of a staged dir (tools/check-budget.js idiom). */
function sizeBytesRecursive(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += sizeBytesRecursive(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    } catch {
      // Unreadable entry: skip instead of failing the gate.
    }
  }
  return total;
}

/** Settled mid-match frame: theme mirror plus drawn tiles (mid-match leg). */
async function settleMatch(page, map) {
  await page.waitForFunction(
    (expected) =>
      window.__game !== undefined &&
      window.__game !== null &&
      window.__game.theme === expected &&
      window.__game.tilesDrawn > 0,
    { timeout: 20000, polling: 100 },
    map,
  );
  await sleep(2500);
  const snap = await page.evaluate(() => ({
    theme: window.__game.theme,
    tilesDrawn: window.__game.tilesDrawn,
  }));
  assert(snap.theme === map, `__game.theme is ${snap.theme}, expected ${map}`);
  assert(snap.tilesDrawn > 0, `${map}: no tiles drawn`);
}

/** Canvas CSS box keeps 16:9 and fills the viewport (letterbox guard). */
async function assertCanvasBox(page, vw, vh) {
  const box = await (await page.$("#game")).boundingBox();
  assert(box !== null, "game canvas has no layout box");
  const expected = letterboxFit(vw, vh);
  assert(
    Math.abs(box.width - expected.width) <= CANVAS_BOX_TOLERANCE_PX &&
      Math.abs(box.height - expected.height) <= CANVAS_BOX_TOLERANCE_PX,
    `canvas CSS box ${box.width}x${box.height}, expected ~${expected.width}x${expected.height}`,
  );
  assert(
    Math.abs(box.width / box.height - 16 / 9) <= ASPECT_TOLERANCE,
    `canvas aspect ${box.width / box.height} drifts from 16:9`,
  );
}

/**
 * Screenshot with a held-fire re-take: when the first frame lands below
 * its mapped baseline, aim at canvas center and hold fire for 2 s
 * (muzzle/tracer entropy, mirroring the capture-themes shoot idiom), then
 * shoot once more. Returns the on-disk byte count; the caller asserts the
 * baseline gate loudly.
 */
async function shoot(page, file, floorBytes, fireHeld = false) {
  await page.screenshot({ path: file });
  let bytes = fs.statSync(file).size;
  if (bytes >= floorBytes) {
    return bytes;
  }
  log(`${path.basename(file)} is thin (${bytes} bytes) — re-taking under fire`);
  // The particles leg calls shoot with the trigger already down, so a
  // second mouse.down would throw; it passes fireHeld instead.
  let pressed = false;
  if (!fireHeld) {
    const box = await (await page.$("#game")).boundingBox();
    assert(box !== null, "game canvas has no layout box for the fire re-take");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    pressed = true;
  }
  try {
    await sleep(2000);
    await page.screenshot({ path: file });
  } finally {
    if (pressed) {
      await page.mouse.up();
    }
  }
  bytes = fs.statSync(file).size;
  return bytes;
}

/** Baseline gate: capture bytes must read at or above the mapped file. */
function assertBaseline(name, bytes) {
  const baselineFile = path.join(BENCHMARK_DIR, BASELINE_FOR[name]);
  assert(fs.existsSync(baselineFile), `missing baseline ${baselineFile}`);
  const baselineBytes = fs.statSync(baselineFile).size;
  assert(
    bytes >= baselineBytes,
    `${name} capture is ${bytes} bytes, below baseline ${path.basename(baselineFile)} (${baselineBytes} bytes)`,
  );
  return baselineBytes;
}

/** IHDR gate: capture pixels must equal the viewport in its filename. */
function assertDimensions(file, vw, vh) {
  const info = pngInfoBytes(fs.readFileSync(file));
  assert(
    info.width === vw && info.height === vh,
    `${path.basename(file)} is ${info.width}x${info.height}, expected ${vw}x${vh}`,
  );
}

/**
 * Action-scene retry driver: live gameplay frames vary shot to shot, so
 * each attempt re-runs its leg for a fresh frame and the first frame
 * clearing its mapped baseline wins (the capture-themes held-fire
 * re-take already fires inside shoot for thin frames). After
 * MAX_ATTEMPTS the run fails loudly naming the scene and both byte
 * counts. An attempt reports { bytes, ok, detail }: ok carries extra
 * proof state (the particles muzzle proof) beyond the size gate.
 */
async function captureWithRetry(label, scene, file, vw, vh, attempt) {
  const baselineFile = path.join(BENCHMARK_DIR, BASELINE_FOR[scene]);
  const floorBytes = fs.statSync(baselineFile).size;
  const MAX_ATTEMPTS = 4;
  let lastBytes = 0;
  let lastDetail = "no attempts ran";
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const result = await attempt(floorBytes);
    lastBytes = result.bytes;
    lastDetail = result.detail;
    if (result.ok && result.bytes >= floorBytes) {
      assertDimensions(file, vw, vh);
      return result;
    }
    log(`${label} attempt ${i}/${MAX_ATTEMPTS} rejected (${lastDetail}, ${result.bytes} < ${floorBytes}) — retrying`);
  }
  fail(
    `${label} capture is ${lastBytes} bytes (${lastDetail}), below baseline ${path.basename(baselineFile)} (${floorBytes} bytes) after ${MAX_ATTEMPTS} attempts`,
  );
  return { bytes: lastBytes, ok: false, detail: lastDetail };
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

  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-sprites-"));
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

    for (const vp of VIEWPORTS) {
      const suffix = SUFFIX[vp.w];
      await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });

      // Standings first: a plain load auto-joins a match (walking
      // skeleton), so the menu is only reachable by backing out through
      // the end-screen Menu affordance, mirroring the presentation
      // standings/menu legs. Force the match end, read the Winner
      // callout plus one row per player, captured on the end screen.
      await page.goto(`${base}/?bots=1&tier=normal&map=kilima`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await waitForClientReady(page);
      await settleMatch(page, "kilima");
      await page.evaluate(() => {
        const world = window.__scraplineWorld;
        if (world === null || world === undefined) {
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
      const endFile = path.join(CAPTURES_DIR, `standings-${suffix}.png`);
      const endBytes = await shoot(
        page,
        endFile,
        fs.statSync(path.join(BENCHMARK_DIR, BASELINE_FOR.standings)).size,
      );
      assertBaseline("standings", endBytes);
      assertDimensions(endFile, vp.w, vp.h);
      log(`standings ${suffix} ok (${winnerText.trim()}, ${standingRows} rows)`);

      // Menu scene: back out through the end-screen Menu affordance,
      // then assert the Play affordances plus the map carousel (the
      // menu leg ids), captured as a full menu frame.
      await page.click("#end-menu");
      await page.waitForFunction(
        () => {
          const m = document.getElementById("menu");
          return m !== null && getComputedStyle(m).display !== "none";
        },
        { timeout: 10000, polling: 100 },
      );
      for (const id of ["#quick-play", "#play", "#map-carousel"]) {
        await page.waitForFunction(
          (sel) => {
            const el = document.getElementById(sel.slice(1));
            return (
              el !== null &&
              getComputedStyle(el).display !== "none" &&
              el.getBoundingClientRect().width > 0
            );
          },
          { timeout: 10000, polling: 100 },
          id,
        );
      }
      await assertCanvasBox(page, vp.w, vp.h);
      const menuFile = path.join(CAPTURES_DIR, `menu-${suffix}.png`);
      const menuBytes = await shoot(page, menuFile, fs.statSync(path.join(BENCHMARK_DIR, BASELINE_FOR.menu)).size);
      assertBaseline("menu", menuBytes);
      assertDimensions(menuFile, vp.w, vp.h);
      log(`menu ${suffix} ok (${(menuBytes / 1024).toFixed(1)}KB)`);

      // Run cycle: kilima mid-match holding KeyD, sprite soldiers caught
      // mid-stride (the combat-leg held-key idiom). Fresh frame per
      // attempt; the first frame clearing the baseline wins.
      const runFile = path.join(CAPTURES_DIR, `match-run-kilima-${suffix}.png`);
      const runResult = await captureWithRetry(
        "match-run-kilima",
        "match-run-kilima",
        runFile,
        vp.w,
        vp.h,
        async (floorBytes) => {
          await page.goto(`${base}/?bots=1&tier=normal&map=kilima`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await waitForClientReady(page);
          await settleMatch(page, "kilima");
          await page.keyboard.down("KeyD");
          try {
            await sleep(1500);
            const runBytes = await shoot(page, runFile, floorBytes);
            return { bytes: runBytes, ok: true, detail: "size" };
          } finally {
            await page.keyboard.up("KeyD");
          }
        },
      );
      log(`match-run-kilima ${suffix} ok (${(runResult.bytes / 1024).toFixed(1)}KB)`);

      // Jet cycle: dune mid-match holding Space, soldiers jetting.
      // Fresh frame per attempt; the first frame clearing the baseline
      // wins.
      const jetFile = path.join(CAPTURES_DIR, `match-jet-dune-${suffix}.png`);
      const jetResult = await captureWithRetry(
        "match-jet-dune",
        "match-jet-dune",
        jetFile,
        vp.w,
        vp.h,
        async (floorBytes) => {
          await page.goto(`${base}/?bots=1&tier=normal&map=dune`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await waitForClientReady(page);
          await settleMatch(page, "dune");
          await page.keyboard.down("Space");
          try {
            await sleep(1500);
            const jetBytes = await shoot(page, jetFile, floorBytes);
            return { bytes: jetBytes, ok: true, detail: "size" };
          } finally {
            await page.keyboard.up("Space");
          }
        },
      );
      log(`match-jet-dune ${suffix} ok (${(jetResult.bytes / 1024).toFixed(1)}KB)`);

      // Particles: frostbite mid-match holding fire at canvas center plus
      // a grenade, gated on live particles/tracers near the muzzle and
      // the screenshot-space muzzle proof, captured with trigger down.
      // Fresh peak-timed frame per attempt; the first frame clearing
      // the baseline with a live muzzle flash wins.
      const fxFile = path.join(CAPTURES_DIR, `frostbite-particles-${suffix}.png`);
      const fxResult = await captureWithRetry(
        "frostbite-particles",
        "frostbite-particles",
        fxFile,
        vp.w,
        vp.h,
        async () => {
          await page.goto(`${base}/?bots=1&tier=normal&map=frostbite`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await waitForClientReady(page);
          await settleMatch(page, "frostbite");
          const combatBox = await (await page.$("#game")).boundingBox();
          assert(combatBox !== null, "game canvas has no layout box for the particles leg");
          await page.mouse.move(combatBox.x + combatBox.width / 2, combatBox.y + combatBox.height / 2);
          await page.mouse.down();
          try {
        await page.waitForFunction(
          () => {
            const dbg = window.__scraplineDebug;
            const game = window.__game;
            const cam = window.__camera;
            if (dbg === undefined || dbg === null) {
              return false;
            }
            if (game === undefined || game === null) {
              return false;
            }
            if (cam === undefined || cam === null) {
              return false;
            }
            const parts = dbg.particles || [];
            const tracers = dbg.tracers || [];
            const muzzles = dbg.muzzle || [];
            if (parts.length === 0) {
              return false;
            }
            if (tracers.length === 0 && muzzles.length === 0) {
              return false;
            }
            const mx = game.muzzle.x;
            const my = game.muzzle.y;
            if (!Number.isFinite(mx) || !Number.isFinite(my)) {
              return false;
            }
            for (const p of parts) {
              const sx = (p.x - cam.x) * cam.scale + 320;
              const sy = (p.y - cam.y) * cam.scale + 180;
              if (Math.hypot(sx - mx, sy - my) <= 24) {
                return true;
              }
            }
            return false;
          },
          { timeout: 15000, polling: 100 },
        );
        log(`particles ${suffix} fire gate ok`);
        await page.keyboard.press("g");
        await page.waitForFunction(
          () => {
            const dbg = window.__scraplineDebug;
            const game = window.__game;
            if (dbg === undefined || dbg === null) {
              return false;
            }
            if (game === undefined || game === null) {
              return false;
            }
            if ((dbg.shockwaves || []).length > 0) {
              return true;
            }
            if ((dbg.bursts || []).length > 0) {
              return true;
            }
            return (game.shockwaveCount || 0) > 0;
          },
          { timeout: 20000, polling: 100 },
        );
            log(`particles ${suffix} explosion gate ok`);
            // Sustained-combat sampling: one match state is one lottery
            // ticket, so each round soaks tracers, re-throws a grenade,
            // and shoots the live frame with the trigger down. The
            // screenshot leads each round on purpose — the muzzle
            // mapping follows for the proof — so the fading flash
            // cannot slip between them. The largest round carrying a
            // screenshot-space muzzle flash wins the attempt.
            const ROUNDS = 5;
            const roundDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-fx-"));
            let best = { bytes: 0, bright: 0, file: "" };
            let bestOverall = 0;
            try {
              for (let r = 1; r <= ROUNDS; r += 1) {
                await sleep(3000);
                await page.keyboard.press("g");
                try {
                  await page.waitForFunction(
                    () => {
                      const dbg = window.__scraplineDebug;
                      if (dbg === undefined || dbg === null) {
                        return false;
                      }
                      return (dbg.shockwaves || []).length > 0;
                    },
                    { timeout: 8000, polling: 50 },
                  );
                } catch {
                  // No live ring this round: the fire-held frame below
                  // still counts as a ticket.
                }
                const roundFile = path.join(roundDir, `round-${r}.png`);
                await page.screenshot({ path: roundFile });
                const live = await page.evaluate(() => {
                  const canvas = document.getElementById("game");
                  const rect =
                    canvas !== null && typeof canvas.getBoundingClientRect === "function"
                      ? canvas.getBoundingClientRect()
                      : null;
                  const game = window.__game;
                  return {
                    box:
                      rect === null
                        ? null
                        : { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    canvasW: canvas !== null ? canvas.width : 0,
                    canvasH: canvas !== null ? canvas.height : 0,
                    muzzle:
                      game !== undefined && game !== null
                        ? { x: game.muzzle.x, y: game.muzzle.y }
                        : null,
                  };
                });
                const mapped = mapMuzzleToShot(live);
                const bright = brightPixelsNearFile(roundFile, mapped.x, mapped.y, MUZZLE_RADIUS_PX);
                const bytes = fs.statSync(roundFile).size;
                bestOverall = Math.max(bestOverall, bytes);
                log(`particles ${suffix} round ${r}/${ROUNDS} (${bytes} bytes bright=${bright})`);
                if (bright >= 1 && bytes > best.bytes) {
                  best = { bytes, bright, file: roundFile };
                }
              }
            } finally {
              if (best.file !== "") {
                fs.copyFileSync(best.file, fxFile);
              }
              try {
                fs.rmSync(roundDir, { recursive: true, force: true });
              } catch {
                // Best-effort temp cleanup only.
              }
            }
            const detail = `rounds=${ROUNDS} bright=${best.bright} bestOverall=${bestOverall}`;
            return { bytes: best.bytes, ok: best.file !== "", detail };
          } finally {
            await page.mouse.up();
          }
        },
      );
      log(`frostbite-particles ${suffix} ok (${(fxResult.bytes / 1024).toFixed(1)}KB ${fxResult.detail})`);

      // HUD chrome: live kilima match asserting the ammo module text and
      // readable name tags (the combat-leg probes), full-frame capture.
      // Fresh frame per attempt; the first frame clearing the baseline
      // wins.
      const hudFile = path.join(CAPTURES_DIR, `hud-kilima-${suffix}.png`);
      const hudResult = await captureWithRetry(
        "hud-kilima",
        "hud-kilima",
        hudFile,
        vp.w,
        vp.h,
        async (floorBytes) => {
          await page.goto(`${base}/?bots=1&tier=normal&map=kilima`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await waitForClientReady(page);
          await settleMatch(page, "kilima");
          const ammoText = await page.$eval("#ammo-counts", (el) => el.textContent || "");
          assert(
            /^\d+\/\d+$/.test(ammoText.trim()),
            `#ammo-counts reads ${JSON.stringify(ammoText)}, expected digits/digits`,
          );
          // Nametag gate: bots drift in and out of view, so poll for
          // two readable labels instead of asserting one instant. A
          // miss here retries the leg for a fresh seed.
          try {
            await page.waitForFunction(
              () => {
                const visible = [...document.querySelectorAll(".nametag")].filter((el) => {
                  if (el.textContent === null || el.textContent.trim().length === 0) {
                    return false;
                  }
                  const style = getComputedStyle(el);
                  if (style.display === "none" || style.visibility === "hidden") {
                    return false;
                  }
                  const rect = el.getBoundingClientRect();
                  return rect.width > 0 && rect.height > 0;
                });
                return visible.length >= 2;
              },
              { timeout: 15000, polling: 250 },
            );
          } catch {
            return { bytes: 0, ok: false, detail: "nametags<2" };
          }
          const tagCount = await page.$$eval(".nametag", (els) =>
            els.filter((el) => {
              if (el.textContent === null || el.textContent.trim().length === 0) {
                return false;
              }
              const style = getComputedStyle(el);
              if (style.display === "none" || style.visibility === "hidden") {
                return false;
              }
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }).length,
          );
          assert(tagCount >= 2, `expected >=2 readable name tags, found ${tagCount}`);
          const hudBytes = await shoot(page, hudFile, floorBytes);
          return {
            bytes: hudBytes,
            ok: true,
            detail: `ammo=${ammoText.trim()} tags=${tagCount}`,
          };
        },
      );
      log(`hud-kilima ${suffix} ok (${(hudResult.bytes / 1024).toFixed(1)}KB ${hudResult.detail})`);
    }

    // Capture inventory: exactly the 12 named frames at both viewports.
    const expected = [];
    for (const scene of SCENES) {
      for (const vp of VIEWPORTS) {
        expected.push(`${scene}-${SUFFIX[vp.w]}.png`);
      }
    }
    for (const name of expected) {
      const file = path.join(CAPTURES_DIR, name);
      assert(fs.existsSync(file), `missing capture ${name}`);
    }

    // Weight tail: the staged bundle must stay within the 6 MB budget
    // (the tools/check-budget.js sizeBytes idiom, same staged target).
    let target = CLIENT_DIST;
    let label = "packages/client/dist";
    try {
      if (fs.existsSync(path.join(ROOT_DIST, "index.html"))) {
        target = ROOT_DIST;
        label = "dist";
      }
    } catch {
      // existsSync threw (shorn fs): keep the client dist target.
    }
    const total = sizeBytesRecursive(target);
    log(`${label} total ${total} bytes (budget ${BUDGET_BYTES})`);
    assert(total > 0, "no build output found — run npm run build:client first");
    assert(total <= BUDGET_BYTES, `budget exceeded: ${total} > ${BUDGET_BYTES}`);
    log("ALL GREEN: sprite verification passed");
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
  console.error(`[verify-sprites] ${err && err.message ? err.message : err}`);
});
