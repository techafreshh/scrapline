// Walking-skeleton contract tests: live HTTP probes against a spawned
// server plus a source-shape check on the deterministic World stub.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

let child = null;
let base = "";
let port = 0;

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

async function get(pathname) {
  return getUrl(base + pathname);
}

async function getFrom(host, pathname) {
  const h = host.includes(":") ? `[${host}]` : host;
  return getUrl(`http://${h}:${port}${pathname}`);
}

async function getUrl(url) {
  const res = await fetch(url);
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
    cwd: path.join(__dirname, ".."),
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
      lastError = new Error(`unexpected health response: ${health.status} ${health.text}`);
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

test("GET /api/health returns 200 JSON containing status ok", async () => {
  const health = await get("/api/health");
  assert.equal(health.status, 200);
  assert.match(health.contentType, /application\/json/);
  assert.match(health.text, /"status":"ok"/);
  assert.match(health.text, /"ok":true/);
  assert.match(health.text, /"rooms":/);
  assert.ok(Number(JSON.parse(health.text).rooms) >= 0, "rooms must be a non-negative number");
});

test("GET /health returns 200 JSON containing status ok", async () => {
  const health = await get("/health");
  assert.equal(health.status, 200);
  assert.match(health.contentType, /application\/json/);
  assert.match(health.text, /"status":"ok"/);
  assert.match(health.text, /"ok":true/);
  assert.match(health.text, /"rooms":/);
  assert.ok(Number(JSON.parse(health.text).rooms) >= 0, "rooms must be a non-negative number");
});

test("GET /api/health answers on every loopback (localhost and ::1)", async () => {
  for (const host of ["localhost", "::1"]) {
    const health = await getFrom(host, "/api/health");
    assert.equal(health.status, 200, `health via ${host}`);
    assert.match(health.contentType, /application\/json/, `content-type via ${host}`);
    assert.match(health.text, /"status":"ok"/, `body via ${host}`);
  }
});

test("GET /health answers on every loopback (localhost and ::1)", async () => {
  for (const host of ["localhost", "::1"]) {
    const health = await getFrom(host, "/health");
    assert.equal(health.status, 200, `health via ${host}`);
    assert.match(health.contentType, /application\/json/, `content-type via ${host}`);
    assert.match(health.text, /"status":"ok"/, `body via ${host}`);
  }
});

test("GET / serves the Play vs bots menu and the game canvas", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /Play vs bots/);
  assert.match(root.text, /<canvas/);
  assert.match(root.text, /id="game"/);
  assert.match(root.text, /id="play"/);
});

test("GET /main.js serves the client bundle with the input mirror", async () => {
  const loop = await get("/main.js");
  assert.equal(loop.status, 200);
  assert.match(loop.contentType, /javascript/);
  assert.match(loop.text, /__scraplineInput/);
  assert.match(loop.text, /__scraplineTick/);
});

test("GET /healthz returns 200 JSON containing ok true", async () => {
  const health = await get("/healthz");
  assert.equal(health.status, 200);
  assert.match(health.contentType, /application\/json/);
  assert.match(health.text, /"ok":true/);
});

test("GET /favicon.ico returns 200 PNG app icon", async () => {
  const res = await fetch(base + "/favicon.ico");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /image\/png/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(Array.from(buf.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test("HEAD /favicon.ico returns 200 PNG content-type", async () => {
  const res = await fetch(base + "/favicon.ico", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /image\/png/);
});

test("GET / includes the literal canvas tag", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.ok(root.text.includes('<canvas id="game">'), "page must contain <canvas id=\"game\">");
});

test("plain boot lands on the menu; explicit match query auto-joins", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "client", "src", "main.ts"),
    "utf8",
  );
  assert.match(source, /__game/);
  assert.match(source, /window\.__game\s*=/);
  assert.match(source, /state.*playing/);
  assert.match(source, /playerCount/);
  // The gated auto-join path still exists with persist: false.
  assert.match(source, /startMatch\(autoJoinSetup\(\), \{ persist: false \}\)/);
  // The boot call is gated on an explicit bots/tier/map query presence
  // check — a plain `/` load never starts a match.
  assert.match(source, /function hasExplicitSetupQuery/);
  assert.match(source, /URLSearchParams/);
  assert.match(source, /query\.get\("bots"\)\s*!==\s*null/);
  assert.match(source, /query\.get\("tier"\)\s*!==\s*null/);
  assert.match(source, /query\.get\("map"\)\s*!==\s*null/);
  assert.match(source, /if\s*\(\s*hasExplicitSetupQuery\(\)\s*\)/);
});

test("presentation verifier pins the exact health probe", () => {
  const verifier = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "verify-presentation.mjs"),
    "utf8",
  );
  assert.match(verifier, /\/api\/health must report ok true/);
  assert.match(verifier, /"\/health must report ok true/);
});

test("repo ships zero *.png/*.jpg images (benchmark/capture refs excepted)", () => {
  const root = path.join(__dirname, "..");
  const hits = [];
  // Allowlisted exception (#161, #205, #272): committed benchmark references
  // live under docs/benchmark/ (plus the per-map themes/ captures) and the
  // sprite-verification captures live under docs/captures/;
  // committed CC0 vendor packs live under packages/client/assets/vendor/
  // (see packages/client/assets/LICENSES.md); every other image fails.
  // Atlas exception (#261): the curated vendor atlas ships committed PNGs
  // under packages/client/assets/atlas/ plus staged dist copies; the 6 MB
  // atlas-weight gate owns that weight instead of this test.
  // Slice-input exception (#346): the generated reference JPEGs under
  // docs/ui-prompts/results/ are the slicer tool's input corpus (inputs,
  // not shipped assets); they stay committed until sliced to PNG-8.
  const resultsRoot = path.join("docs", "ui-prompts", "results") + path.sep;
  const vendorRoot = path.join("packages", "client", "assets", "vendor") + path.sep;
  // Menu-kit exception (#348): the sliced ME-* plates ship committed PNGs
  // under packages/client/assets/ui/ plus staged dist copies; the 6 MB
  // asset-weight gate owns that weight instead of this test.
  const menuKitRoot = path.join("packages", "client", "assets", "ui") + path.sep;
  // Staged dist copies of the same kit (build-atlas stages ui/ into
  // dist/assets/ui/; `npm run build` mirrors it to the root dist/).
  const menuKitDistRoots = [
    path.join("packages", "client", "dist", "assets", "ui") + path.sep,
    path.join("dist", "assets", "ui") + path.sep,
  ];
  const isMenuKit = (rel) =>
    rel.startsWith(menuKitRoot) || menuKitDistRoots.some((root) => rel.startsWith(root));
  // App-icon exception (#351): the sliced IC-08 PWA icons ship committed
  // PNGs under packages/client/public/icons/ plus staged dist copies;
  // the 6 MB asset-weight gate owns that weight instead of this test.
  const appIconRoots = [
    path.join("packages", "client", "public", "icons") + path.sep,
    path.join("packages", "client", "dist", "icons") + path.sep,
    path.join("dist", "icons") + path.sep,
  ];
  const isAppIcon = (rel) => appIconRoots.some((root) => rel.startsWith(root));
  const capturesRoot = path.join("docs", "captures") + path.sep;
  const atlasSeg = `${path.sep}atlas${path.sep}`;
  // UI v8 regression exception (#349): the chrome-regression captures
  // live under docs/benchmark/ui-v8/ as benchmark evidence alongside
  // the themes/ captures.
  const uiV8Root = path.join("docs", "benchmark", "ui-v8") + path.sep;
  const isBenchmarkRef = (rel) =>
    rel.toLowerCase().endsWith(".png") &&
    (rel === path.join("docs", "benchmark", path.basename(rel)) ||
      rel ===
        path.join("docs", "benchmark", "themes", path.basename(rel)) ||
      rel.startsWith(uiV8Root));
  const isSpriteCapture = (rel) =>
    rel.toLowerCase().endsWith(".png") && rel.startsWith(capturesRoot);
  const isSliceInput = (rel) =>
    rel.toLowerCase().endsWith(".jpg") && rel.startsWith(resultsRoot);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "artifacts" || entry.name === "captures") {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (lower.endsWith(".png") || lower.endsWith(".jpg")) {
          const rel = path.relative(root, full);
          if (!isBenchmarkRef(rel) && !isSpriteCapture(rel) && !isSliceInput(rel) && !rel.startsWith(vendorRoot) && !isMenuKit(rel) && !isAppIcon(rel) && !rel.includes(atlasSeg)) {
            hits.push(rel);
          }
        }
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, [], `expected zero images, found: ${hits.join(", ")}`);
});

test("core World source exports class World with step() and hash()", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "core", "src", "world.ts"),
    "utf8",
  );
  assert.match(source, /export\s+(class|const).*World|class\s+World/);
  assert.match(source, /class\s+World/);
  assert.match(source, /\bstep\s*\(/);
  assert.match(source, /\bhash\s*\(/);
});
