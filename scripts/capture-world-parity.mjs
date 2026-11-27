// World-parity captures for issue #403: one settled 1280x720 mid-match
// frame per theme into docs/benchmark/, captured under live fire plus a
// jetpack burn so the frame shows muzzle flash, tracers, impact sparks,
// and the jet flame at mockup density. Asserts per-theme decoration
// density (>=100 world-space decorations), live combat fx (pooled
// particles plus tracers/muzzles near the __game muzzle), a visible jet
// flame, and the 30 fps floor. Prints a JSON probe summary for the
// written diff in docs/benchmark/world-parity-403.md.
//
// Node + puppeteer-core only (no repo imports): stays out of `npm test`
// and CI on purpose, mirroring scripts/capture-themes.mjs. Regenerate
// with `node scripts/capture-world-parity.mjs`.
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT_DIR = path.join(ROOT, "docs", "benchmark");
const MAPS = ["kilima", "dune", "frostbite"];
const MIN_DECORATIONS = 100;
const MIN_FPS = 30;
const MIN_PNG_BYTES = 50 * 1024;

function log(message) {
  console.log(`[world-parity] ${message}`);
}

function fail(message) {
  console.error(`[world-parity] FAIL: ${message}`);
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
      // Unreadable candidate: fall through.
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

async function waitForClientReady(page) {
  await page.waitForFunction(() => typeof window.__scraplineTick === "number", {
    timeout: 15000,
    polling: 100,
  });
}

async function run() {
  const builtIndex = path.join(ROOT, "packages", "client", "dist", "index.html");
  assert(fs.existsSync(builtIndex), "missing packages/client/dist/index.html (run npm run build first)");
  const chromePath = resolveChrome();
  assert(chromePath !== null, "no system Chromium found (CHROME_PATH, /usr/bin/chromium)");
  log(`chromium: ${chromePath}`);
  let puppeteer = null;
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    fail("missing puppeteer-core — run `npm install` first.");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-parity-"));
  let browser = null;
  const summary = {};
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
      defaultViewport: { width: 1280, height: 720 },
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

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
      await sleep(2000);
      // Hold fire at canvas center (window mousedown sets fireMouse) and
      // burn the jetpack briefly so the captured frame shows the muzzle
      // flash, tracers, impact sparks, and the jet flame together.
      const box = await (await page.$("#game")).boundingBox();
      assert(box !== null, `${map}: game canvas has no layout box`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.keyboard.down("Space");
      try {
        // Fire gate: cumulative emitter counts prove muzzle flashes and
        // impact sparks fired, pooled particles plus tracers/muzzles are
        // live this frame, and a jet flame burns on a player (the 2-draw
        // muzzle and 9-draw spark TTLs make an all-live single poll
        // flaky, so the cumulative counts carry the firing proof).
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
            const em =
              typeof game.emitterCounts === "function" ? game.emitterCounts() : null;
            if (em === null || em.muzzle <= 0 || em.impact <= 0) {
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
            const players = dbg.players || [];
            return players.some((p) => p.flame !== null && p.flame !== undefined);
          },
          { timeout: 25000, polling: 100 },
        );
        const snap = await page.evaluate(() => {
          const game = window.__game;
          const dbg = window.__scraplineDebug;
          return {
            theme: game.theme,
            decorationCount: game.decorationCount,
            particleCount: dbg.particleCount,
            tracers: (dbg.tracers || []).length,
            muzzles: (dbg.muzzle || []).length,
            sparks: (dbg.sparks || []).length,
            particles: (dbg.particles || []).length,
            emitters:
              typeof game.emitterCounts === "function" ? game.emitterCounts() : null,
            flame: dbg.players
              ? dbg.players.map((p) => p.flame !== null && p.flame !== undefined)
              : [],
            fps: game.fps,
          };
        });
        assert(snap.theme === map, `${map}: theme is ${snap.theme}`);
        assert(
          snap.decorationCount >= MIN_DECORATIONS,
          `${map}: decorationCount ${snap.decorationCount} < ${MIN_DECORATIONS}`,
        );
        assert(
          snap.particles > 0 && (snap.tracers > 0 || snap.muzzles > 0),
          `${map}: no live combat fx (particles=${snap.particles} tracers=${snap.tracers} muzzles=${snap.muzzles})`,
        );
        assert(
          snap.emitters !== null && snap.emitters.impact > 0,
          `${map}: no impact sparks fired (emitter impact=${snap.emitters?.impact})`,
        );
        assert(
          snap.flame.some(Boolean),
          `${map}: no jet flame live on any player`,
        );
        assert(
          Number.isFinite(snap.fps) && snap.fps >= MIN_FPS,
          `${map}: fps ${snap.fps} below floor ${MIN_FPS}`,
        );
        const shot = path.join(OUT_DIR, `world-parity-403-${map}-1280x720.png`);
        await page.screenshot({ path: shot });
        const bytes = fs.statSync(shot).size;
        assert(bytes > MIN_PNG_BYTES, `${map}.png is ${bytes} bytes, expected >50KB`);
        summary[map] = { ...snap, bytes };
        log(
          `${map} ok (decor=${snap.decorationCount} particles=${snap.particles} ` +
            `tracers=${snap.tracers} muzzles=${snap.muzzles} sparks=${snap.sparks} ` +
            `fps=${snap.fps} ${(bytes / 1024).toFixed(1)}KB)`,
        );
      } finally {
        await page.keyboard.up("Space");
        await page.mouse.up();
      }
    }
    console.log(`[world-parity] SUMMARY ${JSON.stringify(summary)}`);
    log("ALL GREEN: world-parity captures passed");
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
      // Profile cleanup best-effort only.
    }
  }
}

run().catch((err) => {
  console.error(`[world-parity] ${err?.stack ?? err}`);
  process.exitCode = 1;
});
