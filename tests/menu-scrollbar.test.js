// Menu scrollbar contract tests (issue #389): Firefox parity for the menu
// column. chrome.css groups .sl-panel and .menu-column for the
// ::-webkit-scrollbar faces but previously declared the standard
// scrollbar-color/scrollbar-width face for .sl-panel only, leaving
// Firefox on the default-width native bar. These probes assert the
// standard face covers .menu-column with the same token pair and thin
// width, WebKit grouping stays intact, and the served bytes carry it.
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
const CHROME_CSS = path.join(ROOT, "packages", "client", "public", "components", "chrome.css");

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
  assert.ok(start !== -1, `expected selector ${selector} in chrome.css`);
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

/**
 * Bodies of every rule whose selector list names the standard scrollbar
 * face (declares scrollbar-width). Scans raw rule blocks instead of the
 * first literal hit so the grouped .sl-panel/.menu-column standard rule
 * is found even beside the .locker-grid standard rule.
 */
function standardBodies(source) {
  const bodies = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match = null;
  while ((match = rule.exec(source)) !== null) {
    if (/scrollbar-width\s*:/.test(match[2])) {
      bodies.push({ selectors: match[1], body: match[2] });
    }
  }
  assert.ok(bodies.length > 0, "expected at least one scrollbar-width rule in chrome.css");
  return bodies;
}

/** The standard-face rule covering .sl-panel (and, fixed, .menu-column). */
function panelStandardRule(source) {
  const candidates = standardBodies(source).filter(({ selectors }) =>
    selectors.includes(".sl-panel"),
  );
  assert.ok(candidates.length > 0, "expected a .sl-panel scrollbar-width rule in chrome.css");
  return candidates[0];
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

test("static .menu-column carries the Firefox standard face with token-only values", () => {
  const source = fs.readFileSync(CHROME_CSS, "utf8");
  const { selectors, body } = panelStandardRule(source);
  assert.ok(selectors.includes(".menu-column"), "standard scrollbar rule must list .menu-column");
  assert.ok(
    selectors.includes("#stage .menu-column"),
    "standard scrollbar rule must list #stage .menu-column",
  );
  assert.equal(
    declarationValue(body, "scrollbar-color"),
    "var(--color-edge) var(--color-track)",
    "Firefox thumb/groove must stay the edge-over-track token pair",
  );
  assert.equal(declarationValue(body, "scrollbar-width"), "thin", "Firefox width must stay thin");
  assert.doesNotMatch(body, /#[0-9a-fA-F]{6}/, "scrollbar face stays token-only");
});

test("static WebKit faces still group .sl-panel and .menu-column", () => {
  const source = fs.readFileSync(CHROME_CSS, "utf8");
  const widthBody = ruleBody(source, "#stage .sl-panel::-webkit-scrollbar,");
  assert.equal(declarationValue(widthBody, "width"), "12px");
  for (const face of ["::-webkit-scrollbar", "::-webkit-scrollbar-track", "::-webkit-scrollbar-thumb"]) {
    const start = source.indexOf(`#stage .sl-panel${face},`);
    assert.ok(start !== -1, `expected grouped WebKit ${face} rule in chrome.css`);
    const open = source.indexOf("{", start);
    const selectors = source.slice(start, open);
    assert.ok(selectors.includes(".sl-panel"), `WebKit ${face} rule must list .sl-panel`);
    assert.ok(selectors.includes(".menu-column"), `WebKit ${face} rule must list .menu-column`);
  }
  const trackBody = ruleBody(source, "#stage .sl-panel::-webkit-scrollbar-track,");
  assert.equal(declarationValue(trackBody, "background-color"), "var(--color-track)");
  const thumbBody = ruleBody(source, "#stage .sl-panel::-webkit-scrollbar-thumb,");
  assert.equal(declarationValue(thumbBody, "background-color"), "var(--color-edge)");
});

test("GET /components/chrome.css serves the .menu-column standard face", async () => {
  const chrome = await get("/components/chrome.css");
  assert.equal(chrome.status, 200);
  assert.match(chrome.contentType, /text\/css/);
  const { selectors, body } = panelStandardRule(chrome.text);
  assert.ok(selectors.includes(".menu-column"), "served chrome.css must list .menu-column");
  assert.equal(
    declarationValue(body, "scrollbar-color"),
    "var(--color-edge) var(--color-track)",
  );
  assert.equal(declarationValue(body, "scrollbar-width"), "thin");
});
