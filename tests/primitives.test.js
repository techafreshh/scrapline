// Panel/Button primitive contract tests (issue #312): black-box HTTP
// probes for the /components/* stylesheets plus static scans proving the
// three button state selectors exist with distinct values, the disabled
// rule dims below 1.0, and the panel is a constrained translucent card.
// Mirrors tests/tokens.test.js (freePort + spawned server.js + get()).
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
const COMPONENTS = path.join(ROOT, "packages", "client", "public", "components");
const PANEL_CSS = path.join(COMPONENTS, "panel.css");
const BUTTON_CSS = path.join(COMPONENTS, "button.css");
const TOKENS_CSS = path.join(ROOT, "packages", "client", "public", "tokens.css");
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
  assert.ok(start !== -1, `expected selector ${selector}`);
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

test("GET /components/panel.css and /components/button.css return 200 CSS", async () => {
  for (const sheet of ["/components/panel.css", "/components/button.css"]) {
    const res = await get(sheet);
    assert.equal(res.status, 200, `expected 200 for ${sheet}`);
    assert.match(res.contentType, /text\/css/, `expected CSS for ${sheet}`);
    assert.ok(res.text.length > 0, `expected a body for ${sheet}`);
  }
});

test("HEAD /components/*.css returns 200 with a CSS content-type", async () => {
  for (const sheet of ["/components/panel.css", "/components/button.css"]) {
    const res = await fetch(base + sheet, { method: "HEAD" });
    assert.equal(res.status, 200, `expected 200 HEAD for ${sheet}`);
    assert.match(res.headers.get("content-type") || "", /text\/css/);
  }
});

test("button states exist with pairwise-distinct background/box-shadow values", () => {
  const source = fs.readFileSync(BUTTON_CSS, "utf8");
  const values = [];
  for (const selector of [".sl-btn:hover", ".sl-btn:active", ".sl-btn:focus-visible"]) {
    const body = ruleBody(source, selector);
    const background = declarationValue(body, "background");
    const shadow = declarationValue(body, "box-shadow");
    const value = background !== null ? `background:${background}` : null;
    const alt = shadow !== null ? `box-shadow:${shadow}` : null;
    assert.ok(
      value !== null || alt !== null,
      `${selector} must set a background or box-shadow`,
    );
    values.push([value, alt].filter((v) => v !== null).join("|"));
  }
  assert.equal(new Set(values).size, 3, "state values must be pairwise distinct");
});

test("button disabled rule dims below full opacity", () => {
  const source = fs.readFileSync(BUTTON_CSS, "utf8");
  assert.match(source, /\.sl-btn:disabled/);
  const body = ruleBody(source, ".sl-btn:disabled");
  const opacity = declarationValue(body, "opacity");
  assert.ok(opacity !== null, "disabled rule must set opacity");
  const numeric = Number.parseFloat(opacity);
  assert.ok(Number.isFinite(numeric) && numeric < 1.0, "disabled opacity must be < 1.0");
});

test("button base keeps a consistent minimum hit area", () => {
  const source = fs.readFileSync(BUTTON_CSS, "utf8");
  const body = ruleBody(source, ".sl-btn");
  const minHeight = declarationValue(body, "min-height");
  assert.ok(minHeight !== null, "base rule must set min-height");
  assert.ok(Number.parseFloat(minHeight) >= 44, "min-height must be >= 44px");
  assert.ok(declarationValue(body, "padding") !== null, "base rule must set padding");
});

test("panel is a constrained translucent card that never tiles", () => {
  const source = fs.readFileSync(PANEL_CSS, "utf8");
  assert.match(source, /\.sl-panel/);
  const body = ruleBody(source, ".sl-panel");
  const background = declarationValue(body, "background");
  assert.ok(background !== null, "panel must set a background");
  if (background.includes("var(")) {
    const tokenName = /var\((--[^)]+)\)/.exec(background)[1];
    const tokens = fs.readFileSync(TOKENS_CSS, "utf8");
    const tokenValue = new RegExp(`${tokenName}\\s*:\\s*([^;]+);`).exec(tokens)[1];
    const alpha = /rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/.exec(tokenValue);
    assert.ok(
      alpha !== null && Number.parseFloat(alpha[1]) < 1.0,
      "panel token background must carry alpha < 1.0",
    );
  } else {
    const alpha = /rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/.exec(background);
    assert.ok(
      alpha !== null && Number.parseFloat(alpha[1]) < 1.0,
      "panel background must carry alpha < 1.0",
    );
  }
  assert.doesNotMatch(source, /background-image/, "panel must not tile a background image");
  assert.match(source, /max-height/, "panel must cap its height");
  assert.ok(!/\b[6-9]\d\dpx\b/.test(source), "panel must not size at/above 600px");
  assert.ok(!/\b\d{4,}px\b/.test(source), "panel must not use four-digit pixel sizes");
});

test("no file under public/components/ carries a raw six-digit hex", () => {
  const files = fs.readdirSync(COMPONENTS).filter((n) => n.endsWith(".css"));
  assert.ok(files.includes("panel.css"), "panel.css must live in public/components/");
  assert.ok(files.includes("button.css"), "button.css must live in public/components/");
  for (const name of files) {
    const source = fs.readFileSync(path.join(COMPONENTS, name), "utf8");
    assert.doesNotMatch(
      source,
      /#[0-9a-fA-F]{6}/,
      `${name} must consume token variables, not raw hex`,
    );
  }
});

test("GET / links both primitive stylesheets", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /\/components\/panel\.css/);
  assert.match(root.text, /\/components\/button\.css/);
});

test("GET / mounts panel cards and primitive buttons", async () => {
  const root = await get("/");
  assert.equal(root.status, 200);
  assert.match(root.text, /class="sl-panel"/);
  assert.match(root.text, /class="sl-btn"/);
});

test("combined server source serves the /components/ route", () => {
  const source = fs.readFileSync(COMBINED, "utf8");
  assert.match(source, /\/components\//);
});
