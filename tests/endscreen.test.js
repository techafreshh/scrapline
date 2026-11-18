// Token-styled end screen contract tests (issue #320): black-box HTTP
// probes for /overlays/endscreen.css plus static scans proving the
// standings stripes carry the accent winner highlight, Play again owns
// the accent fill while Menu recedes to a ghost, and the token guard
// rails hold. Mirrors tests/menu-cta.test.js (freePort + spawned
// server.js + get() + ruleBody/declarationValue).
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
const ENDSCREEN_CSS = path.join(
  ROOT,
  "packages",
  "client",
  "public",
  "overlays",
  "endscreen.css",
);
const SRC_HTML = path.join(ROOT, "packages", "client", "index.html");
const MAIN_TS = path.join(ROOT, "packages", "client", "src", "main.ts");
const COMBINED = path.join(ROOT, "packages", "server", "src", "server.ts");

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

/** Body of the first rule matching a literal selector in a CSS source. */
function ruleBody(source, selector) {
  const start = source.indexOf(selector);
  assert.ok(start !== -1, `expected selector ${selector} in endscreen.css`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  assert.ok(open !== -1 && close !== -1, `expected rule block for ${selector}`);
  return source.slice(open + 1, close);
}

/** First declaration value for a property inside a rule body. */
function declarationValue(body, property) {
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);?`).exec(body);
  return match === null ? null : match[1].trim();
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

test("GET /overlays/endscreen.css returns 200 CSS carrying the hooks", async () => {
  const sheet = await get("/overlays/endscreen.css");
  assert.equal(sheet.status, 200);
  assert.match(sheet.contentType, /text\/css/);
  assert.match(sheet.text, /\.standings-row/);
  assert.match(sheet.text, /#restart/);
  assert.match(sheet.text, /#end-menu/);
});

test("HEAD /overlays/endscreen.css returns 200 with a CSS content-type", async () => {
  const res = await fetch(base + "/overlays/endscreen.css", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/css/);
});

test("static endscreen.css stripes rows and highlights the winner", () => {
  const source = fs.readFileSync(ENDSCREEN_CSS, "utf8");
  assert.match(source, /\.standings-row/);
  assert.match(source, /nth-child\(even\)/);
  assert.match(source, /\.standings-row\.winner/);
  const odd = ruleBody(source, ".standings-row,");
  assert.notEqual(
    declarationValue(odd, "background"),
    declarationValue(ruleBody(source, ".standings-row:nth-child(even)"), "background"),
    "zebra backgrounds must differ between odd and even rows",
  );
  const winner = ruleBody(source, ".standings-row.winner,");
  const winnerFill =
    `${declarationValue(winner, "background") || ""} ${declarationValue(winner, "border-color") || ""}`;
  assert.match(winnerFill, /0,\s*229,\s*255/, "winner must carry the accent cyan");
});

test("static endscreen.css gives Play again the accent fill", () => {
  const source = fs.readFileSync(ENDSCREEN_CSS, "utf8");
  const body = ruleBody(source, "#restart,");
  assert.match(
    declarationValue(body, "background") || "",
    /var\(--accent/,
    "Play again background must reference the accent token",
  );
  const hover = ruleBody(source, "#restart:hover,");
  assert.match(
    declarationValue(hover, "box-shadow") || "",
    /0 0/,
    "Play again hover must set a glow box-shadow containing 0 0",
  );
});

test("static endscreen.css keeps Menu a transparent ghost", () => {
  const source = fs.readFileSync(ENDSCREEN_CSS, "utf8");
  const body = ruleBody(source, "#end-menu,");
  assert.equal(
    declarationValue(body, "background"),
    "transparent",
    "Menu background must stay transparent",
  );
  assert.ok(ruleBody(source, "#end-menu:hover,").length > 0);
});

test("static endscreen.css consumes tokens with no stacking takeovers", () => {
  const source = fs.readFileSync(ENDSCREEN_CSS, "utf8");
  assert.doesNotMatch(
    source,
    /#[0-9a-fA-F]{6}/,
    "endscreen.css must consume token variables, not raw hex",
  );
  assert.doesNotMatch(source, /z-index/, "stacking stays owned by layers.css");
  assert.doesNotMatch(source, /background-image/, "endscreen.css must never tile an image");
  assert.doesNotMatch(
    source,
    /background-repeat\s*:\s*repeat\b/,
    "endscreen.css must never set background-repeat: repeat",
  );
  assert.match(
    source,
    /var\(--spacing-/,
    "endscreen.css must space from the token scale",
  );
});

test("GET / links the sheet and mounts the end screen with CTA plus ghost", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /\/overlays\/endscreen\.css/);
  assert.match(root.text, /id="end-screen"/);
  assert.match(root.text, /id="restart"[^>]*sl-btn/);
  assert.match(root.text, /id="end-menu"[^>]*sl-btn/);
  assert.match(root.text, /id="end-standings"/);
});

test("source index.html links the sheet beside the other overlay sheets", () => {
  const source = fs.readFileSync(SRC_HTML, "utf8");
  assert.match(source, /\/overlays\/endscreen\.css/);
  for (const sheet of ["setup", "settings", "howto", "challenges", "locker"]) {
    assert.match(source, new RegExp(`/overlays/${sheet}\\.css`), `${sheet}.css link must survive`);
  }
});

test("static showEndScreen emits the standings hooks the probes query", () => {
  const source = fs.readFileSync(MAIN_TS, "utf8");
  const from = source.indexOf("function showEndScreen(): void {");
  const to = source.indexOf("function browserStorage()", from);
  assert.ok(from !== -1 && to > from, "expected the showEndScreen slice");
  const body = source.slice(from, to);
  assert.ok(body.includes("ensureStandings(document)"), "standings container must rebuild");
  assert.ok(body.includes('"standings"'), "table must carry the standings hook");
  assert.ok(body.includes("standings-row"), "rows must carry the standings-row hook");
  assert.ok(body.includes("standings-row winner"), "first row must append winner");
});

test("static end-menu path destroys standings before reshowing the menu", () => {
  const source = fs.readFileSync(MAIN_TS, "utf8");
  const from = source.indexOf('document.getElementById("end-menu")');
  assert.ok(from !== -1, "expected the end-menu wiring");
  const body = source.slice(from, from + 1200);
  assert.ok(body.includes("destroyStandings(document)"), "Menu must destroy standings");
});

test("combined server source serves the /overlays/* route", () => {
  const source = fs.readFileSync(COMBINED, "utf8");
  assert.match(source, /\/overlays\//);
});
