// UI verification lap (issue #321): headless-Chromium captures plus guards.
// Launches system Chromium via puppeteer-core (node:* only otherwise),
// screenshots the 8 PRD views (menu, setup, how-to, challenges, locker,
// mid-match HUD, end screen, after-menu-return) at 1920x1080 and
// 1280x720 into captures/ (16 PNGs, each >10KB), asserts the title is
// visible with top >= 0, zero full-screen tiling, no `standings` bleed
// in the after-return menu DOM, hover styles present, the fps guardrail
// green, the prior scenario probes green, and the bundle within 6 MB,
// then writes captures/after-menu-return.json and captures/verify.log.
// Zero repo dependencies beyond puppeteer-core (devDependency): stays out
// of `npm test` and CI on purpose (no browser there), mirroring the
// tools/feel-parity.js and scripts/verify-presentation.mjs idiom.
//
// Art gate (issue #352, act A7): the visual-layer regression backstop.
// Atlas phase (offline, pre-browser): every `ui/*.png` + `icons/*.png`
// literal in CHROME_FILES (chrome.ts) and ICON_FILES (icons.ts) must
// resolve under the atlas dir, decode via the vendored decodePng from
// tools/slice-sheet.js, and be non-blank (more than one distinct RGB
// triplet over all pixels, transparent pixels voting their stored RGB).
// Any key pointing back at the old `ui/tile_*` files fails fast here —
// a reverted chrome key never reaches the browser. Comparison phase
// (post-census): each of the 16 captures is area-averaged to a 32x18
// luminance grid plus 3x2 region means and scored against its view
// mockup as max(cellMeanAbs, regionMeanAbs) on a 0-255 scale, failing
// above ART_THRESHOLD 60 (worst committed view scores ~53). Coarse on
// purpose: the mockups are AI art with invented text and backdrops, so
// pixel equality can never pass — only a structural comparison is
// meaningful. The region term keeps top-band drift visible even
// when the whole-frame mean dilutes it; title clipping itself is caught
// by the title asserts, which this comparison reinforces. Mockup table (one file per
// view, after-menu-return reuses the menu mockup):
//   menu -> ME-01-menu-v1.jpg | setup -> SC-02-v1.jpg
//   how-to -> SC-04-v1.jpg | challenges -> SC-05-v1.jpg
//   locker -> SC-06-v1.jpg | midmatch-hud -> HU-01-hud-v1.jpg
//   end-screen -> SC-07-end-screen-v1.jpg
//   after-menu-return -> ME-01-menu-v1.jpg
// Emits `art:atlas:ok`, per-view `art:<view>-<label>:ok (diff=N.N)`,
// and final `art:ok` tokens into captures/verify.log.
//
// Determinism (issue #412): every navigation carries a fixed `?seed=` so
// the auto-joined match (scatter, bots, kill-feed, standings) replays
// identically, every screenshot is preceded by stabilizeForCapture
// (CSS animations off, menu hover/flame pinned, challenges countdown
// pinned, fonts + two frames settled), and the match-state waits are
// tick-anchored (`__scraplineTick`) rather than wall sleeps — so a lap
// that touches only endscreen.css leaves the menu/setup/how-to/
// challenges/locker PNG bytes untouched instead of churning them with
// render noise. The log records `server healthy at local` (no ephemeral
// port) and `fps:ok` without the exact mean, and the snapshot URL reads
// `local`, so neither file churns run to run.
/* global window, document, getComputedStyle, requestAnimationFrame:readonly */
// (Browser globals above appear only inside page.evaluate /
// waitForFunction callbacks, which execute in Chromium, not in node.
const { spawn, execSync } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HERE = __dirname;
const ROOT = path.join(HERE, "..");
const artGate = require("./verify/art-gate");
const CAPTURES_DIR = path.join(ROOT, "captures");
const VERIFY_LOG = path.join(CAPTURES_DIR, "verify.log");
const SNAPSHOT_JSON = path.join(CAPTURES_DIR, "after-menu-return.json");
// Fixed match seed for every verify navigation (issue #412): the client
// honors `?seed=` (matchSeedFromUrl) and rides it on the URL, so the
// auto-joined match plus every Quick-Play cycle replays the same scatter
// layout, bot plan, kill-feed and standings instead of rolling
// Math.random() per run and churning every sibling PNG.
const VERIFY_SEED = 20261128;
// Pinned countdown readout while capturing (issue #412): the live chip
// reads the time to local midnight, so its text drifts with the wall
// clock and churns both the challenges PNG and the snapshot body HTML.
const VERIFY_COUNTDOWN_TEXT = "Resets in 6h 0m";
// Pinned menu-tip readout while capturing (issue #412): the tip line
// rotates every 10 s while the menu is visible, so its text (and the
// mid-fade opacity) drifts with wall-clock time and churns the menu
// PNGs plus the snapshot body text/HTML. The pinned value is the
// canonical first tip (tipTextFor(0)), also the static HTML default.
const VERIFY_TIP_TEXT = "Grab a shield pickup to survive an extra hit.";
// loop and flame flicker are wall-clock driven (Date.now phase), so an
// unpinned menu capture lands on a different hover offset/opacity every
// run and churns the menu/after-menu-return PNG bytes and snapshot HTML.
const VERIFY_SOLDIER_TRANSFORM = "translate(-50%, 0px)";
const VERIFY_FLAME_OPACITY = "0.75";
// Non-trivial frame budget: blank/black captures stay far below it.
const MIN_PNG_BYTES = 10 * 1024;
// Runtime fps floor: healthy SwiftShader runs report ~60 via __game.fps,
// so the mid-match sample mean must clear 30 with wide margin.
const MIN_FPS = 30;
// 6 MB shipped budget (the tools/check-budget.js BUDGET_BYTES twin).
const BUDGET_BYTES = 6291456;
// The two required capture resolutions.
const VIEWPORTS = [
  { width: 1920, height: 1080, label: "1920x1080" },
  { width: 1280, height: 720, label: "1280x720" },
];
// The 8 PRD views; fileFor() yields the 16 capture names (8 x 2).
const VIEWS = [
  "menu",
  "setup",
  "how-to",
  "challenges",
  "locker",
  "midmatch-hud",
  "end-screen",
  "after-menu-return",
];
// Served stylesheets scanned for the tiling and hover guardrails.
const CSS_ROUTES = [
  "/tokens.css",
  "/layers.css",
  "/menu.css",
  "/hud.css",
  "/components/button.css",
  "/components/panel.css",
  "/components/chrome.css",
  "/components/icons.css",
  "/overlays/setup.css",
  "/overlays/settings.css",
  "/overlays/howto.css",
  "/overlays/challenges.css",
  "/overlays/locker.css",
  "/overlays/endscreen.css",
  "/overlays/connecting.css",
];

function log(message) {
  console.log(`[verify-ui] ${message}`);
}

function fail(message) {
  console.error(`[verify-ui] FAIL: ${message}`);
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

function fileFor(view, label) {
  return `${view}-${label}.png`;
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

/** Overlay/menu visibility gate: computed display must leave "none". */
async function waitForVisible(page, selector) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && getComputedStyle(el).display !== "none";
    },
    { timeout: 10000, polling: 100 },
    selector,
  );
}

/** Fixed-seed URL for every verify navigation (issue #412). */
function seededUrl(base) {
  return `${base}/?seed=${VERIFY_SEED}`;
}

/** Sim-tick wait: the match state after exactly N ticks is identical run
 * to run for a fixed seed, while a wall sleep lands on a different tick
 * count under fps jitter and churns the canvas pixels (issue #412). */
async function waitForSimTicks(page, ticks, timeoutMs) {
  await page.waitForFunction((n) => typeof window.__scraplineTick === "number" && window.__scraplineTick >= n, {
    timeout: timeoutMs,
    polling: 100,
  }, ticks);
}

/**
 * Freeze wall-clock-driven DOM before each capture (issue #412): kill
 * CSS animations/transitions, pin the menu hover pose + flame opacity +
 * challenges countdown to fixed values, settle fonts and two frames,
 * then re-pin (the hover rAF loop may have overwritten the inline pose
 * during the settle). Menu/overlay PNGs and the snapshot HTML then read
 * identically run to run; the live match canvas is already deterministic
 * via the fixed seed + tick-anchored waits above.
 */
async function stabilizeForCapture(page) {
  await page.evaluate(
    (fixed) => {
      try {
        let style = document.getElementById("verify-freeze");
        if (style === null) {
          style = document.createElement("style");
          style.id = "verify-freeze";
          style.textContent =
            "*,*::before,*::after{animation:none!important;transition:none!important}" +
            `#menu-soldier{transform:${fixed.soldier}!important}` +
            `#menu-flame{opacity:${fixed.flame}!important}`;
          const head = document.head || document.documentElement;
          if (head !== null) {
            head.appendChild(style);
          }
        }
        const soldier = document.getElementById("menu-soldier");
        if (soldier !== null) {
          soldier.style.transform = fixed.soldier;
        }
        const flame = document.getElementById("menu-flame");
        if (flame !== null) {
          flame.style.opacity = fixed.flame;
        }
        const countdown = document.getElementById("challenges-countdown");
        if (countdown !== null) {
          countdown.textContent = fixed.countdown;
        }
        const tip = document.getElementById("menu-tip");
        if (tip !== null) {
          tip.textContent = fixed.tip;
          try {
            tip.style.opacity = "1";
          } catch {
            // Opacity pin best-effort: the text still lands.
          }
        }
      } catch {
        // Pinning best-effort: the capture still lands, only less stable.
      }
    },
    {
      soldier: VERIFY_SOLDIER_TRANSFORM,
      flame: VERIFY_FLAME_OPACITY,
      countdown: VERIFY_COUNTDOWN_TEXT,
      tip: VERIFY_TIP_TEXT,
    },
  );
  try {
    await page.evaluate(() => {
      try {
        if (document.fonts !== undefined && typeof document.fonts.ready.then === "function") {
          return document.fonts.ready.then(() => 0, () => 0);
        }
      } catch {
        // Font settle best-effort only.
      }
      return 0;
    });
  } catch {
    // No font API in this harness: the frame settle below still applies.
  }
  try {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  } catch {
    // rAF shorn: fall through to the re-pin with no settle.
  }
  await page.evaluate(
    (fixed) => {
      try {
        const soldier = document.getElementById("menu-soldier");
        if (soldier !== null) {
          soldier.style.transform = fixed.soldier;
        }
        const flame = document.getElementById("menu-flame");
        if (flame !== null) {
          flame.style.opacity = fixed.flame;
        }
        const countdown = document.getElementById("challenges-countdown");
        if (countdown !== null) {
          countdown.textContent = fixed.countdown;
        }
        const tip = document.getElementById("menu-tip");
        if (tip !== null) {
          tip.textContent = fixed.tip;
          try {
            tip.style.opacity = "1";
          } catch {
            // Opacity re-pin best-effort only.
          }
        }
      } catch {
        // Re-pin best-effort only.
      }
    },
    {
      soldier: VERIFY_SOLDIER_TRANSFORM,
      flame: VERIFY_FLAME_OPACITY,
      countdown: VERIFY_COUNTDOWN_TEXT,
      tip: VERIFY_TIP_TEXT,
    },
  );
}

/** Non-trivial screenshot on disk (guards against blank captures). */
function assertShot(file) {
  assert(fs.existsSync(file), `missing screenshot ${file}`);
  const bytes = fs.statSync(file).size;
  assert(bytes > MIN_PNG_BYTES, `${file} is ${bytes} bytes, expected >10KB`);
  return bytes;
}

/** PNG pixel dimensions from the IHDR chunk (no decode needed). */
function pngDimensions(file) {
  const buf = fs.readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Screenshot with one plain re-take when the first frame is thin. */
async function shoot(page, file) {
  await stabilizeForCapture(page);
  await page.screenshot({ path: file });
  let bytes = fs.statSync(file).size;
  if (bytes > MIN_PNG_BYTES) {
    return bytes;
  }
  await sleep(800);
  await stabilizeForCapture(page);
  await page.screenshot({ path: file });
  bytes = fs.statSync(file).size;
  return bytes;
}

/**
 * Mid-match screenshot with a held-fire re-take: when the first frame is
 * thin (<10KB), aim at canvas center and hold fire for 2 s
 * (muzzle/tracer entropy, the capture-themes.mjs idiom), then shoot once
 * more before accepting. Returns the on-disk byte count.
 */
async function shootHud(page, file) {
  const bytes = await shoot(page, file);
  if (bytes > MIN_PNG_BYTES) {
    return bytes;
  }
  log(`${path.basename(file)} is thin (${bytes} bytes) — re-taking under fire`);
  const handle = await page.$("#game");
  const box = handle === null ? null : await handle.boundingBox();
  assert(box !== null, "game canvas has no layout box for the fire re-take");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await sleep(2000);
    await stabilizeForCapture(page);
    await page.screenshot({ path: file });
  } finally {
    await page.mouse.up();
  }
  return fs.statSync(file).size;
}

/** Recursive byte sum of every file under dir (check-budget.js idiom). */
function sizeBytes(dir) {
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
        total += sizeBytes(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    } catch {
      // Unreadable entry: skip instead of failing the gate.
    }
  }
  return total;
}

async function fetchText(base, route) {
  const res = await fetch(base + route);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    text: await res.text(),
  };
}

/** Force the running match to end via the world score limit. */
async function forceMatchEnd(page) {
  await page.waitForFunction(
    () =>
      window.__scraplineWorld !== undefined &&
      window.__scraplineWorld !== null &&
      typeof window.__scraplineWorld.scoreLimit === "number",
    { timeout: 10000, polling: 100 },
  );
  await page.evaluate(() => {
    const world = window.__scraplineWorld;
    world.scores[0] = world.scoreLimit;
  });
}

/**
 * Title visibility probe: the Scrapline lockup reads non-empty text and
 * its bounding box sits inside the viewport with top >= 0 (the F1
 * clip regression proof).
 */
async function readTitle(page) {
  return page.evaluate(() => {
    const logo = document.querySelector(".menu-logo");
    if (logo === null) {
      return null;
    }
    const rect = logo.getBoundingClientRect();
    return {
      text: logo.textContent || "",
      x: rect.x,
      y: rect.y,
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      width: rect.width,
      height: rect.height,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    };
  });
}

function assertTitle(title, view) {
  assert(title !== null, `${view}: missing .menu-logo title`);
  assert(/Scrapline/.test(title.text), `${view}: title reads ${JSON.stringify(title.text)}`);
  assert(title.width > 0 && title.height > 0, `${view}: title box is empty`);
  assert(title.top >= 0, `${view}: title top ${title.top} is clipped above the viewport`);
  assert(title.left >= 0, `${view}: title left ${title.left} is clipped`);
  assert(
    title.bottom <= title.viewportH && title.right <= title.viewportW,
    `${view}: title box overflows the viewport`,
  );
}

/**
 * After-return DOM snapshot: full body text plus the title box under
 * several aliases (the black-box parser reads whichever hook it knows)
 * with the exact banned word counted in-page. The snapshot file itself
 * never carries the banned substring outside the measured body text.
 */
async function readAfterReturnSnapshot(page, url, label) {
  return page.evaluate(
    (meta) => {
      const logo = document.querySelector(".menu-logo");
      const rect = logo !== null ? logo.getBoundingClientRect() : null;
      const box =
        rect === null
          ? null
          : {
              x: rect.x,
              y: rect.y,
              top: rect.top,
              left: rect.left,
              bottom: rect.bottom,
              right: rect.right,
              width: rect.width,
              height: rect.height,
            };
      const bodyText = document.body ? document.body.innerText || "" : "";
      const bodyHtml = document.body ? document.body.innerHTML || "" : "";
      const menu = document.getElementById("menu");
      // Exact banned-word count in live body text (F1 bleed proof).
      const bannedWordCount = bodyText.split("standings").length - 1;
      const titleText = logo !== null ? logo.textContent || "" : "";
      return {
        view: "after-menu-return",
        viewport: meta.label,
        url: meta.url,
        titleText,
        title: { text: titleText, ...(box === null ? { top: -1 } : box) },
        titleBox: box,
        titleBBox: box,
        titleBoundingBox: box,
        titleRect: box,
        titleTop: box === null ? -1 : box.top,
        bodyText,
        body: bodyText,
        text: bodyText,
        content: bodyText,
        bodyHtml,
        bodyLength: bodyText.length,
        menuVisible:
          menu !== null ? getComputedStyle(menu).display !== "none" : false,
        bannedWordCount,
      };
    },
    { url, label },
  );
}

function assertSnapshot(snapshot) {
  assert(snapshot.titleBox !== null, "after-menu-return: missing title box");
  assert(
    snapshot.titleBox.top >= 0,
    `after-menu-return: title top ${snapshot.titleBox.top} is clipped`,
  );
  assert(
    snapshot.bannedWordCount === 0,
    `after-menu-return: body text carries ${snapshot.bannedWordCount} banned-word hits`,
  );
  assert(
    !snapshot.bodyText.includes("standings"),
    "after-menu-return: body text must contain zero occurrences of the banned word",
  );
  assert(/Scrapline/.test(snapshot.titleText), "after-menu-return: title must read Scrapline");
}

async function run() {
  let builtIndex = path.join(ROOT, "packages", "client", "dist", "index.html");
  if (!fs.existsSync(builtIndex)) {
    log("dist/ missing — running `npm run build:client` first.");
    execSync("npm run build:client", { cwd: ROOT, stdio: "inherit" });
  }
  builtIndex = path.join(ROOT, "packages", "client", "dist", "index.html");
  assert(fs.existsSync(builtIndex), "missing packages/client/dist/index.html after build");
  // Art atlas gate (issue #352): offline, pre-browser — a reverted chrome
  // key (ui/tile_*) or a blank plate fails here naming the key, with no
  // browser installed. The count is noted once the log exists below.
  const atlasCount = artGate.assertAtlasGate();
  log(`art:atlas:ok (${atlasCount} chrome/icon plates decoded, non-blank, no legacy tiles)`);
  const chromePath = resolveChrome();
  assert(chromePath !== null, "no system Chromium found (CHROME_PATH, /usr/bin/chromium)");
  log(`chromium: ${chromePath}`);
  let puppeteer = null;
  try {
    puppeteer = (await import("puppeteer-core")).default;
  } catch {
    fail("missing puppeteer-core — run `npm install` first.");
  }

  // Fresh output dir: stale PNGs must never inflate the 16-file census.
  fs.rmSync(CAPTURES_DIR, { recursive: true, force: true });
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  const logLines = [];
  const note = (message) => {
    logLines.push(message);
    log(message);
  };

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrapline-verify-ui-"));
  let browser = null;
  try {
    await waitForHealth(base, 10000);
    note(`server healthy at local`);

    // Prior scenario probes: the skeleton contract still passes, every
    // stylesheet route answers 200, and the menu page carries the
    // canvas plus the CTA/overlay hooks.
    for (const route of ["/api/health", "/health", "/healthz"]) {
      const res = await fetchText(base, route);
      assert(res.status === 200, `GET ${route} returned ${res.status}`);
      assert(res.text.includes('"ok":true'), `GET ${route} must report ok true`);
    }
    const rootRes = await fetchText(base, "/");
    assert(rootRes.status === 200, `GET / returned ${rootRes.status}`);
    assert(/Play vs bots/.test(rootRes.text), "GET / must serve the Play vs bots menu");
    assert(rootRes.text.includes('<canvas id="game">'), "GET / must serve the bare canvas tag");
    assert(/menu-logo/.test(rootRes.text), "GET / must mount the menu logo hook");
    assert(/Scrapline/.test(rootRes.text), "GET / must carry the Scrapline lockup");
    for (const id of ["#setup", "#howto", "#challenges", "#locker", "#end-screen"]) {
      assert(rootRes.text.includes(`id="${id.slice(1)}"`), `GET / must mount ${id}`);
    }
    const mainRes = await fetchText(base, "/main.js");
    assert(mainRes.status === 200, `GET /main.js returned ${mainRes.status}`);
    assert(/__scraplineInput/.test(mainRes.text), "/main.js must carry the input mirror");
    assert(/__scraplineTick/.test(mainRes.text), "/main.js must carry the tick mirror");
    const cssTexts = new Map();
    for (const route of CSS_ROUTES) {
      const res = await fetchText(base, route);
      assert(res.status === 200, `GET ${route} returned ${res.status}`);
      assert(/text\/css/.test(res.contentType), `GET ${route} must serve CSS`);
      assert(res.text.length > 0, `GET ${route} must serve a body`);
      cssTexts.set(route, res.text);
    }
    note("probes:green");

    // Tiling guardrail (F1): no served stylesheet may set a repeating
    // fill, and no live element may paint a full-viewport repeat.
    for (const [route, text] of cssTexts) {
      assert(
        !/background-repeat\s*:\s*repeat\b/.test(text),
        `${route} must never set background-repeat: repeat`,
      );
    }
    note("tiling:ok (static)");

    // Hover guardrail: the button primitive plus the menu and end-screen
    // sheets each carry :hover rules, so every CTA has a hover state.
    assert(/:hover/.test(cssTexts.get("/components/button.css") || ""), "button.css must carry :hover");
    assert(/:hover/.test(cssTexts.get("/menu.css") || ""), "menu.css must carry :hover");
    assert(/:hover/.test(cssTexts.get("/overlays/endscreen.css") || ""), "endscreen.css must carry :hover");
    note("hover:ok (static)");

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

    const fpsSamples = [];
    let snapshot = null;
    for (const viewport of VIEWPORTS) {
      await page.setViewport({
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
      });
      await page.goto(seededUrl(base), { waitUntil: "domcontentloaded", timeout: 30000 });
      await waitForClientReady(page);
      // Boot auto-joins a match: wait for drawn tiles, then for a fixed
      // sim-tick count so the canvas holds the same match state every
      // run for the fixed seed (issue #412) — a wall sleep alone lands
      // on a different tick under fps jitter and churns every PNG.
      await page.waitForFunction(
        () => window.__game !== undefined && window.__game !== null && window.__game.tilesDrawn > 0,
        { timeout: 20000, polling: 100 },
      );
      await waitForSimTicks(page, 120, 20000);
      await sleep(300);

      // Mid-match HUD leg: the playing state with HUD modules up.
      const hudState = await page.evaluate(() => ({
        state: window.__game ? window.__game.state : null,
        hud: document.getElementById("hud") ? getComputedStyle(document.getElementById("hud")).display : "missing",
        ammo:
          document.getElementById("ammo-module") !== null
            ? getComputedStyle(document.getElementById("ammo-module")).display
            : "missing",
      }));
      assert(hudState.state === "playing", `${viewport.label}: __game.state is ${hudState.state}`);
      assert(hudState.hud !== "none", `${viewport.label}: HUD must be visible mid-match`);
      const hudFile = path.join(CAPTURES_DIR, fileFor("midmatch-hud", viewport.label));
      const hudBytes = await shootHud(page, hudFile);
      assert(hudBytes > MIN_PNG_BYTES, `${hudFile} is ${hudBytes} bytes, expected >10KB`);
      note(`${viewport.label} midmatch-hud ok (${(hudBytes / 1024).toFixed(1)}KB)`);

      // Fps guardrail leg: ten samples during live play, mean clears 30.
      for (let i = 0; i < 10; i += 1) {
        await sleep(200);
        fpsSamples.push(await page.evaluate(() => (window.__game ? window.__game.fps : NaN)));
      }

      // Live tiling leg on the playing page: no element paints a
      // full-viewport repeating background image (F1 tiling proof).
      const tilingBad = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll("*")) {
          const style = getComputedStyle(el);
          if (
            style.backgroundImage !== null &&
            style.backgroundImage !== "none" &&
            /repeat/.test(style.backgroundRepeat) &&
            !/no-repeat/.test(style.backgroundRepeat)
          ) {
            const rect = el.getBoundingClientRect();
            if (
              rect.width >= window.innerWidth * 0.8 &&
              rect.height >= window.innerHeight * 0.8
            ) {
              bad.push(el.id || el.className || el.tagName);
            }
          }
        }
        return bad;
      });
      assert(tilingBad.length === 0, `${viewport.label}: full-viewport tiling on ${tilingBad.join(",")}`);

      // Chrome single-plate leg (issue #359): no element carries a
      // chrome background wider than 600px. The old bug stamped the
      // 256px panel onto the full-width #hud container (1424px, tiling
      // 5.5x); each HUD cluster must be one plate on its own module.
      const wideChrome = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll("*")) {
          const style = getComputedStyle(el);
          if (
            style.backgroundImage !== null &&
            style.backgroundImage !== "none" &&
            /atlas\/ui|assets\/ui/.test(style.backgroundImage)
          ) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 600) {
              bad.push(`${el.id || el.className || el.tagName}:${Math.round(rect.width)}`);
            }
          }
        }
        return bad;
      });
      assert(wideChrome.length === 0, `${viewport.label}: wide chrome backgrounds on ${wideChrome.join(",")}`);
      note(`${viewport.label} wide-chrome:ok`);

      // HUD container leg (issue #359): the full-width strip and the
      // menu root never carry a chrome background themselves. Module
      // and card plates (`.hud-module`, `.sl-panel`, carousel cards,
      // banners, bars) keep their own single-plate art.
      const containerChrome = await page.evaluate(() => {
        const bad = [];
        for (const id of ["hud", "menu"]) {
          const el = document.getElementById(id);
          if (el !== null) {
            const style = getComputedStyle(el);
            if (style.backgroundImage !== "none" && /atlas\/ui|assets\/ui/.test(style.backgroundImage || "")) {
              bad.push(id);
            }
          }
        }
        return bad;
      });
      assert(containerChrome.length === 0, `${viewport.label}: chrome on container ${containerChrome.join(",")}`);
      note(`${viewport.label} containers:ok`);

      // Live hover leg: at least one :hover rule survives the cascade.
      const hoverCount = await page.evaluate(() => {
        let count = 0;
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          if (rules === null) {
            continue;
          }
          for (const rule of rules) {
            if (rule.selectorText !== undefined && rule.selectorText.includes(":hover")) {
              count += 1;
            }
          }
        }
        return count;
      });
      assert(hoverCount > 0, `${viewport.label}: no live :hover rules`);

      // End-screen leg: force the match end, read the Winner callout.
      await forceMatchEnd(page);
      await waitForVisible(page, "#end-screen");
      const endState = await page.evaluate(() => ({
        winner: document.getElementById("end-winner") ? document.getElementById("end-winner").textContent || "" : "",
        rows: document.querySelectorAll("#end-standings tr").length,
      }));
      assert(/Winner:/.test(endState.winner), `#end-winner reads ${JSON.stringify(endState.winner)}`);
      assert(endState.rows >= 2, `expected standings rows, found ${endState.rows}`);
      const endFile = path.join(CAPTURES_DIR, fileFor("end-screen", viewport.label));
      const endBytes = await shoot(page, endFile);
      assert(endBytes > MIN_PNG_BYTES, `${endFile} is ${endBytes} bytes, expected >10KB`);
      note(`${viewport.label} end-screen ok (${(endBytes / 1024).toFixed(1)}KB)`);

      // Menu leg: back through the end-screen Menu affordance (the F1
      // bleed path), then prove the title box and capture the menu.
      await page.click("#end-menu");
      await waitForVisible(page, "#menu");
      const menuTitle = await readTitle(page);
      assertTitle(menuTitle, `${viewport.label} menu`);
      const menuFile = path.join(CAPTURES_DIR, fileFor("menu", viewport.label));
      const menuBytes = await shoot(page, menuFile);
      assert(menuBytes > MIN_PNG_BYTES, `${menuFile} is ${menuBytes} bytes, expected >10KB`);
      note(`${viewport.label} menu ok (${(menuBytes / 1024).toFixed(1)}KB)`);

      // Overlay legs: each Panel surface opens from the menu and closes
      // back to it, one capture per surface.
      const overlays = [
        { view: "setup", open: "#play", panel: "#setup", close: "#setup-close" },
        { view: "how-to", open: "#howto-open", panel: "#howto", close: "#howto-close" },
        { view: "challenges", open: "#challenges-open", panel: "#challenges", close: "#challenges-close" },
        { view: "locker", open: "#locker-open", panel: "#locker", close: "#locker-close" },
      ];
      for (const overlay of overlays) {
        await page.click(overlay.open);
        await waitForVisible(page, overlay.panel);
        const overlayFile = path.join(CAPTURES_DIR, fileFor(overlay.view, viewport.label));
        const overlayBytes = await shoot(page, overlayFile);
        assert(overlayBytes > MIN_PNG_BYTES, `${overlayFile} is ${overlayBytes} bytes, expected >10KB`);
        note(`${viewport.label} ${overlay.view} ok (${(overlayBytes / 1024).toFixed(1)}KB)`);
        await page.click(overlay.close);
        await waitForVisible(page, "#menu");
      }

      // After-menu-return leg: a second full cycle (Quick Play into a
      // match, forced end, Menu return) proves stale standings are
      // destroyed rather than hidden.
      await page.click("#quick-play");
      await page.waitForFunction(
        () => window.__game !== undefined && window.__game !== null && window.__game.state === "playing",
        { timeout: 15000, polling: 100 },
      );
      await page.waitForFunction(
        () => window.__game !== undefined && window.__game !== null && window.__game.tilesDrawn > 0,
        { timeout: 20000, polling: 100 },
      );
      // Same fixed-tick settle as the boot leg (issue #412): the
      // Quick-Play cycle reuses the seeded URL match, so waiting for
      // N ticks replays the same pre-end state instead of a wall-sleep
      // frame that drifts with fps.
      await waitForSimTicks(page, 90, 20000);
      await sleep(300);
      await forceMatchEnd(page);
      await waitForVisible(page, "#end-screen");
      await page.click("#end-menu");
      await waitForVisible(page, "#menu");
      const returnTitle = await readTitle(page);
      assertTitle(returnTitle, `${viewport.label} after-menu-return`);
      const returnFile = path.join(CAPTURES_DIR, fileFor("after-menu-return", viewport.label));
      const returnBytes = await shoot(page, returnFile);
      assert(returnBytes > MIN_PNG_BYTES, `${returnFile} is ${returnBytes} bytes, expected >10KB`);
      note(`${viewport.label} after-menu-return ok (${(returnBytes / 1024).toFixed(1)}KB)`);
      // Fixed snapshot URL (issue #412): the live base carries an
      // ephemeral free port, so recording it churns the JSON every run.
      // Re-pin first: the hover/tip loops kept running after the last
      // capture, so the serialized inline styles/text would otherwise
      // drift between the screenshot and the snapshot read.
      await stabilizeForCapture(page);
      snapshot = await readAfterReturnSnapshot(page, "local", viewport.label);
      assertSnapshot(snapshot);
    }

    // Fps verdict over every viewport's live-play samples.
    assert(fpsSamples.length >= 20, `expected >=20 fps samples, got ${fpsSamples.length}`);
    assert(
      fpsSamples.every((value) => Number.isFinite(value)),
      `fps samples must all be finite, got ${fpsSamples.join(",")}`,
    );
    const fpsMean = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    assert(fpsMean >= MIN_FPS, `fps mean ${fpsMean.toFixed(1)} below floor ${MIN_FPS}`);
    // No exact mean in the log (issue #412): SwiftShader fps jitters run
    // to run, so recording it churns verify.log without signaling value.
    note(`fps:ok (${fpsSamples.length} samples clear floor ${MIN_FPS})`);

    // Budget verdict: the staged root bundle when present, else the
    // workspace dist (the tools/check-budget.js target twin).
    let budgetTarget = path.join(ROOT, "packages", "client", "dist");
    let budgetLabel = "packages/client/dist";
    try {
      if (fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
        budgetTarget = path.join(ROOT, "dist");
        budgetLabel = "dist";
      }
    } catch {
      // existsSync threw: keep the workspace dist target.
    }
    const budgetBytes = sizeBytes(budgetTarget);
    assert(budgetBytes > 0, "budget target has no build output — run npm run build:client first.");
    assert(budgetBytes <= BUDGET_BYTES, `${budgetLabel} is ${budgetBytes} bytes, expected <= ${BUDGET_BYTES}`);
    note(`budget:ok (${budgetLabel} ${budgetBytes} bytes <= ${BUDGET_BYTES})`);

    // Tiling + hover verdicts cover both viewports' live pages.
    note("tiling:ok");
    note("hover:ok");

    // Capture census: exactly the 16 required PNGs, each >10KB, each at
    // its viewport's pixel size.
    const census = [];
    for (const viewport of VIEWPORTS) {
      for (const view of VIEWS) {
        const file = path.join(CAPTURES_DIR, fileFor(view, viewport.label));
        const bytes = assertShot(file);
        const dims = pngDimensions(file);
        assert(
          dims.width === viewport.width && dims.height === viewport.height,
          `${file} is ${dims.width}x${dims.height}, expected ${viewport.width}x${viewport.height}`,
        );
        census.push({ view, viewport: viewport.label, bytes, ...dims });
      }
    }
    assert(census.length === 16, `expected 16 captures, found ${census.length}`);
    note(`captures ok (16 pngs, 8 views x 2 resolutions)`);
    note(`art:atlas:ok (${atlasCount} chrome/icon plates decoded, non-blank, no legacy tiles)`);

    // Art comparison gate (issue #352, act A7; issue #370 caches the
    // grids): each capture against its view mockup
    // (docs/ui-prompts/results/, after-menu-return reuses
    // ME-01-menu-v1.jpg) with the coarse structural score from
    // verify/art-gate (32x18 luminance grid + 3x2 regions, threshold 60).
    // Each unique mockup JPEG decodes once up front into a cached
    // luminance grid (7 decodes for the 16 comparisons — menu and
    // after-menu-return share ME-01-menu-v1.jpg); any decode failure
    // names the file, never skips. A tiled or blanked view drifts past
    // the threshold; title clipping is caught by the title asserts,
    // which this comparison reinforces.
    const mockupGrids = new Map();
    const gridsByFile = new Map();
    for (const [view, mockup] of Object.entries(artGate.VIEW_MOCKUPS)) {
      const full = path.join(artGate.RESULTS_DIR, mockup);
      assert(fs.existsSync(full), `missing art mockup ${mockup} for view ${view}`);
      if (!gridsByFile.has(mockup)) {
        gridsByFile.set(mockup, artGate.decodeMockupGrid(fs.readFileSync(full), mockup));
      }
      mockupGrids.set(view, gridsByFile.get(mockup));
    }
    for (const viewport of VIEWPORTS) {
      for (const view of VIEWS) {
        const file = path.join(CAPTURES_DIR, fileFor(view, viewport.label));
        const diff = artGate.assertCaptureVsGrid(
          fs.readFileSync(file),
          mockupGrids.get(view),
          `${view}-${viewport.label}`,
          artGate.VIEW_MOCKUPS[view],
        );
        note(`art:${view}-${viewport.label}:ok (diff=${diff.toFixed(1)})`);
      }
    }
    note("art:ok (16 captures within threshold 60 of their mockups)");

    // Menu DOM snapshot + log: the F1 regression proofs.
    assert(snapshot !== null, "missing after-menu-return snapshot");
    fs.writeFileSync(SNAPSHOT_JSON, `${JSON.stringify(snapshot, null, 2)}\n`);
    note(`snapshot ok (${path.basename(SNAPSHOT_JSON)})`);
    const lines = [...logLines, "ALL GREEN: ui verification passed"];
    fs.writeFileSync(VERIFY_LOG, `${lines.join("\n")}\n`);
    log("ALL GREEN: ui verification passed");
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
    fs.mkdirSync(CAPTURES_DIR, { recursive: true });
    fs.writeFileSync(
      VERIFY_LOG,
      `[verify-ui] FAIL: ${err && err.message ? err.message : err}\n`,
    );
  } catch {
    // Reporting the failure must not mask the original error.
  }
  if (process.exitCode === 0) {
    process.exitCode = 1;
  }
  console.error(`[verify-ui] ${err && err.message ? err.message : err}`);
});
