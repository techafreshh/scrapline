// Port-list contract: every port source resolves the first finite
// positive integer, so PORT="3001,3002" serves 3001 (like
// packages/server firstPortInteger), never a merged NaN fallback.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

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

async function waitHealthy(port) {
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      const text = await res.text();
      if (res.status === 200 && text.includes('"status":"ok"')) {
        return;
      }
      lastError = new Error(`unexpected health response: ${res.status} ${text}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy in time: ${lastError}`);
}

test("PORT comma-list serves the first port", async (t) => {
  const first = await freePort();
  const second = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: `${first},${second}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await waitHealthy(first);
  const res = await fetch(`http://127.0.0.1:${first}/api/health`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /"status":"ok"/);
});

test("CLI --port=<a>,<b> serves the first port", async (t) => {
  const first = await freePort();
  const second = await freePort();
  const env = { ...process.env };
  delete env.PORT;
  delete env.npm_config_port;
  const child = spawn(process.execPath, ["server.js", `--port=${first},${second}`], {
    cwd: path.join(__dirname, ".."),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  await waitHealthy(first);
  const res = await fetch(`http://127.0.0.1:${first}/api/health`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /"status":"ok"/);
});
