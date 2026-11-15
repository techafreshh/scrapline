// Presentation verification lap: headless-Chromium captures plus guards.
// Launches system Chromium via puppeteer-core (node:* only otherwise),
// screenshots 1920x1080 and 1280x720 frames to artifacts/ (menu, setup,
// carousel close-up, one mid-match frame per map with a kilima combat
// re-take under live fire, fullscreen on/off, standings), asserts the
// canvas CSS letterbox, the fps guardrail (30 fps mean over 5 s in
// combat), particles near the muzzle on fire/explosion, glow, readable
// name tags, the ammo module text, and the prior health/state probes,
// then writes artifacts/verify.json with status ALL GREEN plus the
// per-capture muzzle-to-screenshot map the benchmark compare consumes.
// Zero repo dependencies beyond puppeteer-core (devDependency): stays out
// of `npm test` and CI on purpose (no browser there), mirroring the
// tools/feel-parity.js harness idiom.
/* global window, document, getComputedStyle, HTMLElement:readonly */
// (Browser globals above appear only inside page.evaluate /
// waitForFunction callbacks, which execute in Chromium, not in node.)
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  brightPixelsNearFile,
  mapMuzzleToShot,
} from "./verify/benchmark-compare.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const VERIFY_JSON = path.join(ARTIFACTS_DIR, "verify.json");
// Non-trivial frame budget: blank/black captures stay far below it.
const MIN_PNG_BYTES = 5 * 1024;
// Pairwise mid-match distinctness floor: warm/cool/neutral grades land
// near 35%+ pixel delta, so 5% proves distinct themes with wide margin.
const MIN_HISTOGRAM_DELTA = 0.05;
// Runtime fps floor: healthy SwiftShader runs report ~60 via __game.fps,
// so the combat-leg 5 s mean must clear 30 with wide margin.
const MIN_FPS = 30;
// Canvas CSS box tolerance in px: the #game 1px border inflates the
// border-box by 2px over the exact letterbox size.
const CANVAS_BOX_TOLERANCE_PX = 4;
const ASPECT_TOLERANCE = 0.02;
const LOGICAL_W = 640;
const LOGICAL_H = 360;
const MAPS = ["kilima", "dune", "frostbite"];

function log(message) {
  console.log(`[verify-presentation] ${message}`);
}

function fail(message) {
  console.error(`[verify-presentation] FAIL: ${message}`);
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

/** Decode an 8-bit non-interlaced PNG into raw RGB channel bytes. */
function decodePngRgb(file) {
  const buf = fs.readFileSync(file);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    assert(buf[i] === signature[i], `${file} is not a PNG`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      assert(data[12] === 0, `${file} must be non-interlaced`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert(bitDepth === 8, `${file} must be 8-bit (got ${bitDepth})`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert(channels > 0, `${file} must be RGB/RGBA (color type ${colorType})`);
  const raw = Buffer.from(zlib.inflateSync(Buffer.concat(idat)));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const current = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const previous =
      y === 0 ? Buffer.alloc(stride) : pixels.subarray((y - 1) * stride, y * stride);
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      let value = 0;
      if (filter === 0) {
        value = current[i];
      } else if (filter === 1) {
        value = (current[i] + a) & 255;
      } else if (filter === 2) {
        value = (current[i] + b) & 255;
      } else if (filter === 3) {
        value = (current[i] + ((a + b) >> 1)) & 255;
      } else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        value = (current[i] + predictor) & 255;
      } else {
        fail(`${file} uses unknown PNG filter ${filter}`);
      }
      row[i] = value;
    }
  }
  return { width, height, channels, pixels };
}

/** Fraction of pixels whose RGB triple differs (alpha ignored). */
function histogramDelta(first, second) {
  if (first.width !== second.width || first.height !== second.height) {
    return 1;
  }
  const count = first.width * first.height;
  let different = 0;
  for (let i = 0; i < count; i += 1) {
    const o1 = i * first.channels;
    const o2 = i * second.channels;
    if (
      first.pixels[o1] !== second.pixels[o2] ||
      first.pixels[o1 + 1] !== second.pixels[o2 + 1] ||
      first.pixels[o1 + 2] !== second.pixels[o2 + 2]
    ) {
      different += 1;
    }
  }
  return different / count;
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

/** Non-trivial screenshot on disk (guards against blank captures). */
function assertShot(file) {
  assert(fs.existsSync(file), `missing screenshot ${file}`);
  const bytes = fs.statSync(file).size;
  assert(bytes > MIN_PNG_BYTES, `${file} is ${bytes} bytes, expected >5KB`);
  return bytes;
}

/** PNG pixel dimensions from the IHDR chunk (no decode needed). */
function pngDimensions(file) {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Record the screenshot-space mapping for one capture: shot dims plus
 * the live canvas box, backing-store size, and __game muzzle, so the
 * benchmark compare can map the muzzle into screenshot pixels.
 */
async function recordCapture(page, store, name) {
  const file = path.join(ARTIFACTS_DIR, name);
  const dims = pngDimensions(file);
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
  store[name] = { shotW: dims.width, shotH: dims.height, ...live };
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

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const checks = {};
  // Per-capture muzzle-to-screenshot map (benchmark-compare input).
  const captures = {};
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-verify-"));
  let browser = null;
  try {
    await waitForHealth(base, 10000);
    log(`server healthy at ${base}`);

    // Prior health/state probes: the skeleton contract still passes.
    const health = await (await fetch(`${base}/api/health`)).text();
    assert(health.includes('"status":"ok"'), "/api/health must report status ok");
    assert(health.includes('"ok":true'), "/api/health must report ok true");
    const rootHealth = await (await fetch(`${base}/health`)).text();
    assert(rootHealth.includes('"status":"ok"'), "/health must report status ok");
    assert(rootHealth.includes('"ok":true'), "/health must report ok true");
    const healthz = await (await fetch(`${base}/healthz`)).text();
    assert(healthz.includes('"ok":true'), "/healthz must report ok true");
    const rootRes = await fetch(`${base}/`);
    const rootHtml = await rootRes.text();
    assert(rootRes.status === 200, `GET / returned ${rootRes.status}`);
    assert(/Play vs bots/.test(rootHtml), "GET / must serve the Play vs bots menu");
    assert(rootHtml.includes('<canvas id="game">'), "GET / must serve the bare canvas tag");
    const mainRes = await fetch(`${base}/main.js`);
    const mainJs = await mainRes.text();
    assert(mainRes.status === 200, `GET /main.js returned ${mainRes.status}`);
    assert(/__scraplineInput/.test(mainJs), "/main.js must carry the input mirror");
    assert(/__scraplineTick/.test(mainJs), "/main.js must carry the tick mirror");
    checks.health = { apiHealth: true, health: true, healthz: true, menu: true, mainJs: true };
    log("health/state probes ok");

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
    // then a settled themed frame (theme mirror + drawn tiles + fps).
    const fpsSamples = [];
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
      // Settle the sim plus the fps EMA before capturing the frame.
      await sleep(2500);
      const snap = await page.evaluate(() => ({
        theme: window.__game.theme,
        tilesDrawn: window.__game.tilesDrawn,
        decorationCount: window.__game.decorationCount,
        backwallCount: window.__game.backwallCount,
        skyTop: window.__game.skyTop,
        vignetteAlpha: window.__game.vignetteAlpha,
        fps: window.__game.fps,
        resolution: window.__game.rendererResolution,
        tick: window.__game.tick,
        state: window.__game.state,
      }));
      assert(snap.theme === map, `__game.theme is ${snap.theme}, expected ${map}`);
      assert(snap.tilesDrawn > 0, `${map}: no tiles drawn`);
      assert(snap.decorationCount >= 3, `${map}: decorationCount is ${snap.decorationCount}`);
      assert(
        Number.isFinite(snap.fps) && snap.fps >= MIN_FPS,
        `${map}: fps guardrail failed (fps=${snap.fps}, floor=${MIN_FPS})`,
      );
      assert(
        snap.resolution >= 1 && snap.resolution <= 2,
        `${map}: rendererResolution ${snap.resolution} outside the [1,2] DPR clamp`,
      );
      assert(snap.tick > 0, `${map}: sim tick did not advance`);
      assert(snap.state === "playing", `${map}: __game.state is ${snap.state}`);
      fpsSamples.push({ map, fps: snap.fps });
      const shot = path.join(ARTIFACTS_DIR, `midmatch-${map}.png`);
      await page.screenshot({ path: shot });
      const bytes = assertShot(shot);
      await recordCapture(page, captures, `midmatch-${map}.png`);
      log(`midmatch ${map} ok (theme=${map} tiles=${snap.tilesDrawn} fps=${snap.fps} ${(bytes / 1024).toFixed(1)}KB)`);
    }
    checks.midmatch = { maps: MAPS.slice(), fpsSamples };

    // Kilima combat leg (#161): live fire plus a grenade, then the
    // particle/glow/nametag/ammo/fps probes and the combat capture that
    // re-takes midmatch-kilima.png with muzzle-flash particles visible.
    await page.goto(`${base}/?bots=1&tier=normal&map=kilima`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await waitForClientReady(page);
    await page.waitForFunction(
      () =>
        window.__game !== undefined &&
        window.__game !== null &&
        window.__game.theme === "kilima" &&
        window.__game.tilesDrawn > 0,
      { timeout: 20000, polling: 100 },
    );
    await sleep(1500);
    // Aim at canvas center and hold fire: the window mousedown path
    // sets fireMouse, so tracers/muzzles/particles spawn every draw.
    const combatBox = await (await page.$("#game")).boundingBox();
    assert(combatBox !== null, "game canvas has no layout box for the combat leg");
    await page.mouse.move(
      combatBox.x + combatBox.width / 2,
      combatBox.y + combatBox.height / 2,
    );
    await page.mouse.down();
    try {
      // Fire gate: pooled particles plus tracers/muzzles live, with one
      // particle projected within 24px of the __game muzzle (backing px).
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
      log("combat fire gate ok (particles + tracers/muzzles near muzzle)");
      // Grenade beat: tap g, then await explosion evidence (a live
      // shockwave ring, death-burst fallout, or the shockwave counter).
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
      log("combat explosion gate ok (grenade shockwave live)");
      // Fps meter leg: sample __game.fps 10x at 500ms during combat;
      // the guardrail mean must clear 30 fps.
      const fpsCombat = [];
      for (let i = 0; i < 10; i += 1) {
        await sleep(500);
        fpsCombat.push(await page.evaluate(() => window.__game.fps));
      }
      const fpsMean = fpsCombat.reduce((a, b) => a + b, 0) / fpsCombat.length;
      assert(
        fpsCombat.every((v) => Number.isFinite(v)) && fpsMean >= MIN_FPS,
        `combat fps mean ${fpsMean.toFixed(1)} below floor ${MIN_FPS} (samples ${fpsCombat.join(",")})`,
      );
      // Glow gate: static additive lights painted this frame.
      const lightCount = await page.evaluate(() => window.__game.lightCount);
      assert(lightCount > 0, `glow guardrail failed (lightCount=${lightCount})`);
      // Ammo module: mag/reserve counts render `32/96`-style.
      const ammoText = await page.$eval("#ammo-counts", (el) => el.textContent || "");
      assert(
        /^\d+\/\d+$/.test(ammoText.trim()),
        `#ammo-counts reads ${JSON.stringify(ammoText)}, expected digits/digits`,
      );
      // Name tags: at least two readable labels on screen.
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
      // Combat capture while still holding fire: overwrites the settled
      // midmatch-kilima.png with muzzle-flash particles visible.
      const combatShot = path.join(ARTIFACTS_DIR, "midmatch-kilima.png");
      await page.screenshot({ path: combatShot });
      assertShot(combatShot);
      await recordCapture(page, captures, "midmatch-kilima.png");
      // Screenshot-space muzzle proof: a bright pixel within 24px of
      // the mapped muzzle must exist in the captured PNG itself.
      const mapped = mapMuzzleToShot(captures["midmatch-kilima.png"]);
      const bright = brightPixelsNearFile(combatShot, mapped.x, mapped.y, 24);
      assert(bright >= 1, "no bright pixel within 24px of the muzzle in midmatch-kilima.png");
      checks.combat = {
        fpsSamples: fpsCombat,
        fpsMean: Math.round(fpsMean * 10) / 10,
        lightCount,
        ammo: ammoText.trim(),
        tags: tagCount,
        brightNearMuzzle: bright,
        muzzle: captures["midmatch-kilima.png"].muzzle,
      };
      log(`combat ok (fps mean=${fpsMean.toFixed(1)} ammo=${ammoText.trim()} tags=${tagCount} bright=${bright})`);
    } finally {
      await page.mouse.up();
    }

    // Canvas CSS scale guardrail at 1920x1080: the letterbox box keeps
    // 16:9 and fills the viewport exactly (up to the 1px canvas border).
    const box1920 = await (await page.$("#game")).boundingBox();
    assert(box1920 !== null, "game canvas has no layout box at 1920x1080");
    const expected1920 = letterboxFit(1920, 1080);
    assert(
      Math.abs(box1920.width - expected1920.width) <= CANVAS_BOX_TOLERANCE_PX &&
        Math.abs(box1920.height - expected1920.height) <= CANVAS_BOX_TOLERANCE_PX,
      `canvas CSS box ${box1920.width}x${box1920.height}, expected ~${expected1920.width}x${expected1920.height}`,
    );
    assert(
      Math.abs(box1920.width / box1920.height - 16 / 9) <= ASPECT_TOLERANCE,
      `canvas aspect ${box1920.width / box1920.height} drifts from 16:9`,
    );
    checks.canvasCss1920 = { box: box1920, expected: expected1920 };
    log(`canvas CSS ok at 1920x1080 (${Math.round(box1920.width)}x${Math.round(box1920.height)})`);

    // Fullscreen leg: the persisted intent flips and the label renders;
    // headless denials of the Fullscreen API still persist + render.
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
    await page.click("#btn-fullscreen");
    // Intent key (settings.ts FULLSCREEN_KEY): inline here because the
    // waitForFunction callback cannot close over node module scope.
    await page.waitForFunction(
      () => window.localStorage.getItem("scrapline.fullscreen") === "1",
      { timeout: 5000, polling: 100 },
    );
    const onLabel = await page.$eval("#btn-fullscreen", (el) => el.textContent || "");
    assert(/Fullscreen: ON/.test(onLabel), `fullscreen label reads ${JSON.stringify(onLabel)}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "fullscreen-on.png") });
    assertShot(path.join(ARTIFACTS_DIR, "fullscreen-on.png"));
    await recordCapture(page, captures, "fullscreen-on.png");
    await page.click("#btn-fullscreen");
    await page.waitForFunction(
      () => window.localStorage.getItem("scrapline.fullscreen") === "0",
      { timeout: 5000, polling: 100 },
    );
    const offLabel = await page.$eval("#btn-fullscreen", (el) => el.textContent || "");
    assert(/Fullscreen: OFF/.test(offLabel), `fullscreen label reads ${JSON.stringify(offLabel)}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "fullscreen-off.png") });
    assertShot(path.join(ARTIFACTS_DIR, "fullscreen-off.png"));
    await recordCapture(page, captures, "fullscreen-off.png");
    checks.fullscreen = { on: "Fullscreen: ON", off: "Fullscreen: OFF" };
    log("fullscreen on/off ok");
    await page.click("#settings-close");

    // Standings leg: force the match end, read the Winner callout.
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
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "standings.png") });
    assertShot(path.join(ARTIFACTS_DIR, "standings.png"));
    await recordCapture(page, captures, "standings.png");
    checks.standings = { winner: winnerText.trim(), rows: standingRows };
    log(`standings ok (${winnerText.trim()}, ${standingRows} rows)`);

    // Menu + setup legs: back out through the end-screen menu affordance.
    await page.click("#end-menu");
    await page.waitForFunction(
      () => {
        const m = document.getElementById("menu");
        return m !== null && getComputedStyle(m).display !== "none";
      },
      { timeout: 10000, polling: 100 },
    );
    for (const id of ["#quick-play", "#play", "#settings-open", "#howto-open"]) {
      const handle = await page.$(id);
      assert(handle !== null, `missing ${id} on the menu`);
    }
    const carouselHandle = await page.$("#map-carousel");
    assert(carouselHandle !== null, "missing #map-carousel on the menu");
    await carouselHandle.screenshot({ path: path.join(ARTIFACTS_DIR, "carousel.png") });
    assertShot(path.join(ARTIFACTS_DIR, "carousel.png"));
    await recordCapture(page, captures, "carousel.png");
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "menu.png") });
    assertShot(path.join(ARTIFACTS_DIR, "menu.png"));
    await recordCapture(page, captures, "menu.png");
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
    const tierCount = await page.$$eval("[data-tier]", (els) => els.length);
    const mapCount = await page.$$eval("[data-map]", (els) => els.length);
    assert(tierCount >= 3, `expected tier buttons, found ${tierCount}`);
    assert(mapCount >= 3, `expected map buttons, found ${mapCount}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "setup.png") });
    assertShot(path.join(ARTIFACTS_DIR, "setup.png"));
    await recordCapture(page, captures, "setup.png");
    checks.menuSetup = { tiers: tierCount, maps: mapCount };
    log("menu/setup ok");

    // 1280x720 leg: the second required capture size keeps the 16:9 box.
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.goto(`${base}/?bots=1&tier=normal&map=kilima`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await waitForClientReady(page);
    await page.waitForFunction(
      () => window.__game !== null && window.__game.tilesDrawn > 0,
      { timeout: 20000, polling: 100 },
    );
    await sleep(1500);
    const box720 = await (await page.$("#game")).boundingBox();
    assert(box720 !== null, "game canvas has no layout box at 1280x720");
    const expected720 = letterboxFit(1280, 720);
    assert(
      Math.abs(box720.width - expected720.width) <= CANVAS_BOX_TOLERANCE_PX &&
        Math.abs(box720.height - expected720.height) <= CANVAS_BOX_TOLERANCE_PX,
      `canvas CSS box ${box720.width}x${box720.height}, expected ~${expected720.width}x${expected720.height}`,
    );
    assert(
      Math.abs(box720.width / box720.height - 16 / 9) <= ASPECT_TOLERANCE,
      `canvas aspect ${box720.width / box720.height} drifts from 16:9`,
    );
    const shot720 = path.join(ARTIFACTS_DIR, "midmatch-1280x720.png");
    await page.screenshot({ path: shot720 });
    assertShot(shot720);
    await recordCapture(page, captures, "midmatch-1280x720.png");
    checks.canvasCss720 = { box: box720, expected: expected720 };
    log(`canvas CSS ok at 1280x720 (${Math.round(box720.width)}x${Math.round(box720.height)})`);

    // Capture inventory: every required frame exists and the pixel sizes
    // prove both capture resolutions (IHDR, independent of file bytes).
    const required = [
      "menu.png",
      "setup.png",
      "carousel.png",
      "midmatch-kilima.png",
      "midmatch-dune.png",
      "midmatch-frostbite.png",
      "fullscreen-on.png",
      "fullscreen-off.png",
      "standings.png",
      "midmatch-1280x720.png",
    ];
    const files = [];
    for (const name of required) {
      const file = path.join(ARTIFACTS_DIR, name);
      const bytes = assertShot(file);
      const dims = pngDimensions(file);
      files.push({ name, bytes, ...dims });
    }
    assert(files.length >= 10, `expected >=10 captures, found ${files.length}`);
    const dimsOf = (name) => files.find((f) => f.name === name);
    assert(
      dimsOf("menu.png").width === 1920 && dimsOf("menu.png").height === 1080,
      `menu.png must be 1920x1080, got ${dimsOf("menu.png").width}x${dimsOf("menu.png").height}`,
    );
    assert(
      dimsOf("midmatch-1280x720.png").width === 1280 &&
        dimsOf("midmatch-1280x720.png").height === 720,
      "midmatch-1280x720.png must be 1280x720",
    );
    checks.files = files;
    log(`capture inventory ok (${files.length} pngs)`);

    // Theme-distinctness guard: every mid-match pair differs by >5%.
    const decoded = new Map();
    for (const map of MAPS) {
      decoded.set(map, decodePngRgb(path.join(ARTIFACTS_DIR, `midmatch-${map}.png`)));
    }
    const histogram = [];
    for (let i = 0; i < MAPS.length; i += 1) {
      for (let j = i + 1; j < MAPS.length; j += 1) {
        const pair = `${MAPS[i]}-vs-${MAPS[j]}`;
        const delta = histogramDelta(decoded.get(MAPS[i]), decoded.get(MAPS[j]));
        assert(
          delta > MIN_HISTOGRAM_DELTA,
          `${pair} pixel delta ${(delta * 100).toFixed(2)}% is below the 5% theme floor`,
        );
        histogram.push({ pair, delta: Math.round(delta * 10000) / 10000 });
        log(`histogram ${pair}: ${(delta * 100).toFixed(2)}% differ`);
      }
    }
    checks.histogram = histogram;
    checks.captures = captures;

    const report = {
      status: "ALL GREEN",
      finishedAt: new Date().toISOString(),
      viewports: ["1920x1080", "1280x720"],
      checks,
    };
    fs.writeFileSync(VERIFY_JSON, `${JSON.stringify(report, null, 2)}\n`);
    log("ALL GREEN: presentation verification passed");
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
  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    fs.writeFileSync(
      VERIFY_JSON,
      `${JSON.stringify({ status: "FAIL", error: String((err && err.message) || err) }, null, 2)}\n`,
    );
  } catch {
    // Reporting the failure must not mask the original error.
  }
  if (process.exitCode === 0) {
    process.exitCode = 1;
  }
  console.error(`[verify-presentation] ${err && err.message ? err.message : err}`);
});
