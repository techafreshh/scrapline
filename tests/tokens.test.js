// Token system contract tests (issue #311): black-box HTTP probes for
// the /tokens.css single source of truth plus static scans proving every
// UI surface consumes variables with zero raw hex outside the token file.
// Mirrors tests/pwa.test.js (freePort + spawned server.js + get() helpers).
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
const PUBLIC = path.join(ROOT, "packages", "client", "public");
const SRC_HTML = path.join(ROOT, "packages", "client", "index.html");
const COMBINED = path.join(ROOT, "packages", "server", "src", "server.ts");

/** Recursive collector for every *.css file under dir. */
function collectCssFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectCssFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
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

test("GET /tokens.css returns 200 CSS carrying the PRD palette and spacing", async () => {
  const tokens = await get("/tokens.css");
  assert.equal(tokens.status, 200);
  assert.match(tokens.contentType, /text\/css/);
  assert.match(tokens.text, /#0b0f1a/);
  assert.match(tokens.text, /#00E5FF/);
  assert.match(tokens.text, /#FF6B35/);
  assert.match(tokens.text, /--spacing-16/);
});

test("HEAD /tokens.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/tokens.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("GET / links the tokens stylesheet for the bundled-CSS path", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /tokens\.css/);
});

test("no public CSS outside tokens.css carries a raw six-digit hex", () => {
  const files = collectCssFiles(PUBLIC);
  assert.ok(
    files.includes(path.join(PUBLIC, "tokens.css")),
    "tokens.css must live in public/",
  );
  const others = files.filter(
    (file) => file !== path.join(PUBLIC, "tokens.css"),
  );
  assert.ok(others.length >= 1, "expected at least one public CSS file besides tokens.css");
  for (const file of others) {
    const source = fs.readFileSync(file, "utf8");
    const name = path.relative(PUBLIC, file);
    assert.doesNotMatch(
      source,
      /#[0-9a-fA-F]{6}/,
      `${name} must consume token variables, not raw hex`,
    );
  }
});

test("source index.html body rule resolves to the navy token variable", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(source, /body\s*\{[^}]*var\(--color-bg/);
});

test("combined server source serves the /tokens.css route", () => {
  const source = fs.readFileSync(COMBINED, "utf8");
  assert.match(source, /\/tokens\.css/);
});
