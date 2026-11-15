#!/usr/bin/env node
// Online two-tab smoke probe (issue #219): browser-only, reference-runner
// leg proving two live tabs share one room and render each other's
// remote soldiers, plus the 60 s fps-with-ambient-high sampling rule.
// Launches system Chromium via puppeteer-core (node:* otherwise), spawns
// the authoritative game server (dist bundle first, tsx source fallback,
// online-two-client.mjs idiom) fronted by a probe-local static file
// server that mirrors server.js's staged-first bundle chain and pipes
// same-origin /room upgrades to the game server — root server.js serves
// no WebSocket endpoint, so the probe fronts it locally instead of
// changing product code. Clicks the static `#play-online` button on two
// 1920x1080 pages, asserts both publish connected with a growing
// snapshot feed and a remote row within 2 s, holds pointer input and
// asserts 10 s of connected/remote/growing feed with
// interpDelayMs === 100, then samples `__game.fps` for 60 s on frostbite
// with quality high (mean >= 50, ambient bed live every sample) and
// spot-checks the kilima bird crossing. Stays out of `npm test` and CI
// on purpose (no browser there), mirroring verify-presentation.
// Exits 0 with ALL GREEN (or skip-green without Chromium), or 1 with a
// one-line FAIL reason.
/* global window, document, getComputedStyle:readonly */
// (Browser globals above appear only inside page.evaluate /
// waitForFunction callbacks, which execute in Chromium, not in node.)
import { spawn, execSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
// Staged static bundle (root dist/, copied by tools/stage-dist.js),
// falling back to the workspace build (server.js idiom).
const ROOT_DIST = path.join(ROOT, "dist");
const DIST = path.join(ROOT, "packages", "client", "dist");
// Authoritative game server (online-two-client.mjs idiom).
const DIST_SERVER = path.join(ROOT, "packages", "server", "dist", "server.js");
// Two-tab play-entry budget: both tabs connected with a remote row.
const TABS_BUDGET_MS = 2000;
// Held-input leg: 10 s of remote rendering at 500 ms per sample.
const TABS_HOLD_MS = 10000;
const TABS_SAMPLE_MS = 500;
// Interpolation delay both tabs must mirror (net/interpolation.ts).
const EXPECTED_INTERP_DELAY_MS = 100;
// Fps leg: frostbite on quality high, 60 s at 500 ms per sample.
const FPS_SAMPLES = 120;
const FPS_SAMPLE_MS = 500;
// Fps floor with ambient on high (reference runner, SwiftShader).
const MIN_FPS = 50;
// Kilima bird spot-check budget after the fps leg.
const BIRD_BUDGET_MS = 5000;

function log(message) {
  console.log(`[online-tabs] ${message}`);
}

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Free loopback port (verify-presentation idiom). */
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

/** First readable body across the staged-to-workspace fallback chain. */
function tryReadFirst(...files) {
  for (const file of files) {
    try {
      return fs.readFileSync(file);
    } catch {
      // Missing link in the chain: try the next fallback.
    }
  }
  return null;
}

/** Poll an /api/health endpoint until it reports ok (skeleton idiom). */
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

/**
 * Probe-local page server: mirrors server.js's staged-first bundle chain
 * for the two routes the legs need, answers the health stub, and pipes
 * same-origin /room upgrades to the authoritative game server (TCP pipe,
 * handshake bytes replayed verbatim). Probe-local so product code —
 * root server.js serves no WebSocket endpoint — stays untouched.
 */
function startPageServer(gamePort) {
  const send = (req, res, status, contentType, body) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    res.writeHead(status, {
      "content-type": contentType,
      "content-length": buf.length,
    });
    res.end(req.method === "HEAD" ? undefined : buf);
  };
  const listener = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const readable = req.method === "GET" || req.method === "HEAD";
    if (readable && (url.pathname === "/health" || url.pathname === "/api/health")) {
      send(req, res, 200, "application/json", '{"ok":true,"status":"ok","rooms":0}');
      return;
    }
    if (readable && url.pathname === "/healthz") {
      send(req, res, 200, "application/json", '{"ok":true}');
      return;
    }
    if (readable && (url.pathname === "/" || url.pathname === "/index.html")) {
      const built = tryReadFirst(
        path.join(ROOT_DIST, "index.html"),
        path.join(DIST, "index.html"),
      );
      if (built !== null) {
        send(req, res, 200, "text/html; charset=utf-8", built);
        return;
      }
      send(req, res, 500, "text/plain; charset=utf-8", "missing client bundle");
      return;
    }
    if (readable && url.pathname === "/main.js") {
      const built = tryReadFirst(path.join(ROOT_DIST, "main.js"), path.join(DIST, "main.js"));
      if (built !== null) {
        send(req, res, 200, "text/javascript; charset=utf-8", built);
        return;
      }
      send(req, res, 500, "text/plain; charset=utf-8", "missing client bundle");
      return;
    }
    send(req, res, 404, "text/plain; charset=utf-8", "not found");
  });
  listener.on("upgrade", (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url || "/", "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/room") {
      try {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      } catch {
        // Client already gone.
      }
      socket.destroy();
      return;
    }
    const peer = net.connect(gamePort, "127.0.0.1");
    const destroyBoth = () => {
      try {
        socket.destroy();
      } catch {
        // Already gone.
      }
      try {
        peer.destroy();
      } catch {
        // Already gone.
      }
    };
    peer.once("connect", () => {
      let handshake = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      const raw = req.rawHeaders || [];
      for (let i = 0; i + 1 < raw.length; i += 2) {
        handshake += `${raw[i]}: ${raw[i + 1]}\r\n`;
      }
      handshake += "\r\n";
      peer.write(handshake);
      if (head && head.length > 0) {
        peer.write(head);
      }
      socket.pipe(peer);
      peer.pipe(socket);
    });
    peer.once("error", destroyBoth);
    socket.once("error", destroyBoth);
    socket.once("close", () => {
      try {
        peer.destroy();
      } catch {
        // Already gone.
      }
    });
  });
  return listener;
}

/** Read the window.__online probe mirror (null when unpublished). */
function readOnline(page) {
  return page.evaluate(() => {
    const mirror = window.__online;
    if (mirror === undefined || mirror === null) {
      return null;
    }
    return {
      connected: mirror.connected,
      inputsSent: mirror.inputsSent,
      snapshotsReceived: mirror.snapshotsReceived,
      interpDelayMs: mirror.interpDelayMs,
      remoteCount: mirror.remoteCount,
    };
  });
}

/** Click a button in-page (no CDP input path to starve under load). */
function clickId(page, id) {
  return page.evaluate((target) => {
    const button = document.getElementById(target);
    if (button === null) {
      throw new Error(`missing #${target}`);
    }
    button.click();
  }, id);
}

async function main() {
  const chromePath = resolveChrome();
  if (chromePath === null) {
    log("no system Chromium found (CHROME_PATH, /usr/bin/chromium) — skipping");
    console.log("ONLINE TABS: ALL GREEN (skipped, no Chromium)");
    return;
  }
  let builtIndex = path.join(DIST, "index.html");
  if (!fs.existsSync(path.join(ROOT_DIST, "index.html")) && !fs.existsSync(builtIndex)) {
    log("dist/ missing — running `npm run build:client` first.");
    execSync("npm run build:client", { cwd: ROOT, stdio: "inherit" });
  }
  log(`chromium: ${chromePath}`);
  let puppeteer = null;
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    fail("missing puppeteer-core — run `npm install` first");
  }

  // Authoritative game server: build the bundle when absent (51 ms via
  // esbuild), then spawn node directly — no tsx wrapper, so game.kill()
  // closes the pipes and the probe exits instead of orphaning (#218's
  // npx fallback hangs the parent loop on boxes without the bundle).
  if (!fs.existsSync(DIST_SERVER)) {
    log("server bundle missing — running the `@scrapline/server` build first.");
    execSync("npm run build --workspace=@scrapline/server", { cwd: ROOT, stdio: "inherit" });
  }
  if (!fs.existsSync(DIST_SERVER)) {
    fail("missing packages/server/dist/server.js after build");
  }
  const gamePort = await freePort();
  const game = spawn(process.execPath, [DIST_SERVER], {
    env: { ...process.env, PORT: String(gamePort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pagePort = await freePort();
  const base = `http://127.0.0.1:${pagePort}`;
  const pageServer = startPageServer(gamePort);
  await new Promise((resolve, reject) => {
    pageServer.once("error", reject);
    pageServer.listen(pagePort, "127.0.0.1", resolve);
  });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-tabs-"));
  let browser = null;
  try {
    await waitForHealth(`http://127.0.0.1:${gamePort}`, 10000);
    log(`game server healthy (page origin at ${base})`);

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--mute-audio",
        "--enable-unsafe-swiftshader",
      ],
      userDataDir: profileDir,
      defaultViewport: { width: 1920, height: 1080 },
    });

    // Two-tab leg: two pages join the same view room via #play-online.
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await pageA.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await pageB.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    for (const [page, name] of [
      [pageA, "A"],
      [pageB, "B"],
    ]) {
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector("#play-online", { timeout: 15000 });
      await clickId(page, "play-online");
      log(`tab ${name} clicked #play-online`);
    }
    // Both tabs connected (15 s wall clock; headless-WS parity).
    for (const [page, name] of [
      [pageA, "A"],
      [pageB, "B"],
    ]) {
      const deadline = Date.now() + 15000;
      let connected = false;
      let last = null;
      while (Date.now() < deadline) {
        try {
          last = await readOnline(page);
        } catch {
          last = null;
        }
        if (last !== null && last.connected === true) {
          connected = true;
          break;
        }
        await sleep(200);
      }
      if (!connected) {
        fail(`tab ${name} never published __online.connected === true (last=${JSON.stringify(last)})`);
      }
      log(`tab ${name} connected`);
    }
    // One snapshot carrying both pids within 2 s: each tab sees a
    // remote row and a growing snapshot feed.
    {
      const firstA = await readOnline(pageA);
      const firstB = await readOnline(pageB);
      if (firstA === null || firstB === null) {
        fail("window.__online unpublished right after connect");
      }
      const deadline = Date.now() + TABS_BUDGET_MS;
      let lastA = firstA;
      let lastB = firstB;
      let shared = false;
      while (Date.now() < deadline) {
        try {
          lastA = await readOnline(pageA);
        } catch {
          // Starved runtime: retry inside the budget.
        }
        try {
          lastB = await readOnline(pageB);
        } catch {
          // Starved runtime: retry inside the budget.
        }
        if (
          lastA !== null &&
          lastB !== null &&
          lastA.remoteCount >= 1 &&
          lastB.remoteCount >= 1 &&
          lastA.snapshotsReceived > firstA.snapshotsReceived &&
          lastB.snapshotsReceived > firstB.snapshotsReceived
        ) {
          shared = true;
          break;
        }
        await sleep(100);
      }
      if (!shared) {
        fail(
          `both pids in one snapshot never arrived (A=${JSON.stringify(lastA)} B=${JSON.stringify(lastB)})`,
        );
      }
      log(
        `shared room ok (A remote=${lastA.remoteCount} snaps=${lastA.snapshotsReceived}, ` +
          `B remote=${lastB.remoteCount} snaps=${lastB.snapshotsReceived})`,
      );
    }
    // Held-input leg: pointer down on both canvases, then 10 s of
    // connected + remote + growing feed with interpDelayMs === 100.
    for (const page of [pageA, pageB]) {
      const box = await page.evaluate(() => {
        const canvas = document.getElementById("game");
        const rect =
          canvas !== null && typeof canvas.getBoundingClientRect === "function"
            ? canvas.getBoundingClientRect()
            : null;
        return rect === null ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      if (box !== null) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
      }
    }
    {
      let prevA = (await readOnline(pageA))?.snapshotsReceived ?? 0;
      let prevB = (await readOnline(pageB))?.snapshotsReceived ?? 0;
      const startA = prevA;
      const startB = prevB;
      const samples = Math.floor(TABS_HOLD_MS / TABS_SAMPLE_MS);
      for (let i = 0; i < samples; i += 1) {
        await sleep(TABS_SAMPLE_MS);
        let nowA = null;
        let nowB = null;
        try {
          nowA = await readOnline(pageA);
        } catch {
          fail(`tab A mirror unreadable mid-hold (sample ${i})`);
        }
        try {
          nowB = await readOnline(pageB);
        } catch {
          fail(`tab B mirror unreadable mid-hold (sample ${i})`);
        }
        for (const [snap, prev, name] of [
          [nowA, prevA, "A"],
          [nowB, prevB, "B"],
        ]) {
          if (snap.connected !== true) {
            fail(`tab ${name} disconnected mid-hold (sample ${i})`);
          }
          if (!(snap.remoteCount >= 1)) {
            fail(`tab ${name} lost its remote row mid-hold (sample ${i})`);
          }
          if (!(snap.snapshotsReceived >= prev)) {
            fail(`tab ${name} snapshot feed went backwards mid-hold (sample ${i})`);
          }
          if (snap.interpDelayMs !== EXPECTED_INTERP_DELAY_MS) {
            fail(`tab ${name} interpDelayMs is ${snap.interpDelayMs}, expected 100 (sample ${i})`);
          }
        }
        prevA = nowA.snapshotsReceived;
        prevB = nowB.snapshotsReceived;
      }
      if (!(prevA > startA && prevB > startB)) {
        fail(`snapshot feed stalled over the 10 s hold (A ${startA}->${prevA}, B ${startB}->${prevB})`);
      }
      log(`10 s hold ok (A ${startA}->${prevA}, B ${startB}->${prevB}, interp 100ms)`);
    }
    for (const page of [pageA, pageB]) {
      try {
        await page.mouse.up();
      } catch {
        // Pointer release best-effort only.
      }
      await page.close();
    }

    // Fps-with-ambient leg: frostbite on quality high, 60 s at 500 ms.
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    try {
      await page.goto(`${base}/?bots=1&tier=normal&map=frostbite`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForFunction(
        () =>
          window.__game !== undefined &&
          window.__game !== null &&
          window.__game.theme === "frostbite" &&
          window.__game.tilesDrawn > 0,
        { timeout: 20000, polling: 100 },
      );
      // Force quality high through the settings toggle (verify-presentation idiom).
      let quality = await page.evaluate(() => window.__game.quality);
      if (quality !== "high") {
        await clickId(page, "settings-open");
        await page.waitForFunction(
          () => {
            const s = document.getElementById("settings");
            return s !== null && getComputedStyle(s).display !== "none";
          },
          { timeout: 10000, polling: 100 },
        );
        for (let i = 0; i < 2 && quality !== "high"; i += 1) {
          await clickId(page, "btn-quality");
          await sleep(300);
          quality = await page.evaluate(() => window.__game.quality);
        }
        await clickId(page, "settings-close");
      }
      if (quality !== "high") {
        fail(`quality stuck at ${quality}, expected high for the fps leg`);
      }
      await sleep(2500);
      const fps = [];
      let ambientMin = Infinity;
      for (let i = 0; i < FPS_SAMPLES; i += 1) {
        const sample = await page.evaluate(() => ({
          fps: window.__game.fps,
          ambientCount: window.__game.ambientCount,
        }));
        if (!(sample.ambientCount > 0)) {
          fail(`ambient bed empty on frostbite with quality high (sample ${i})`);
        }
        ambientMin = Math.min(ambientMin, sample.ambientCount);
        fps.push(sample.fps);
        await sleep(FPS_SAMPLE_MS);
      }
      const mean = fps.reduce((a, b) => a + b, 0) / fps.length;
      log(
        `fps frostbite/high: mean=${mean.toFixed(1)} min=${Math.min(...fps).toFixed(1)} ` +
          `ambientMin=${ambientMin} samples=${fps.length}`,
      );
      if (!(Number.isFinite(mean) && mean >= MIN_FPS)) {
        fail(`mean fps ${mean.toFixed(1)} below floor ${MIN_FPS} (quality high, ambient on)`);
      }

      // Kilima spot-check: the bird crossing reads live within 5 s.
      await page.goto(`${base}/?bots=1&tier=normal&map=kilima`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForFunction(
        () => window.__game !== undefined && window.__game !== null && window.__game.tilesDrawn > 0,
        { timeout: 20000, polling: 100 },
      );
      let birds = 0;
      try {
        await page.waitForFunction(() => window.__game.ambientBirdCount > 0, {
          timeout: BIRD_BUDGET_MS,
          polling: 100,
        });
        birds = await page.evaluate(() => window.__game.ambientBirdCount);
      } catch {
        fail("kilima ambientBirdCount stayed 0 past the 5 s spot-check");
      }
      log(`kilima birds ok (ambientBirdCount=${birds})`);
    } finally {
      await page.close();
    }

    console.log("ONLINE TABS: ALL GREEN");
  } finally {
    if (browser !== null) {
      try {
        await browser.close();
      } catch {
        // Closing a half-launched browser must not mask the run result.
      }
    }
    try {
      pageServer.close();
    } catch {
      // Listener teardown best-effort only.
    }
    if (game !== null) {
      try {
        game.kill();
      } catch {
        // Already gone.
      }
    }    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup only.
    }
  }
}

main().catch((err) => {
  console.error(`FAIL: ${String((err && err.message) || err)}`);
  process.exit(1);
});
