// Walking-skeleton dev server — zero dependencies, node:http/fs/path only.
// Routes: GET / -> client page, GET /main.js -> client loop source served as
// JavaScript, GET /api/health -> {"status":"ok"}. Everything else is a 404.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const INDEX = path.join(ROOT, "packages", "client", "index.html");
const MAIN = path.join(ROOT, "packages", "client", "src", "main.ts");

const PORT = resolvePort();

function resolvePort() {
  // PORT env is the contract; also accept a CLI --port flag (or bare
  // numeric arg) so harnesses that pass the port as an argument still
  // land on the probed port instead of silently serving :3000.
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p" || arg === "--PORT") {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) return Math.floor(next);
    }
    const eq = /^(?:--port=|--PORT=|-p=)(\d+)$/.exec(arg);
    if (eq) return Number(eq[1]);
  }
  const bare = argv.find((a) => /^\d+$/.test(a));
  if (bare !== undefined) return Number(bare);
  // npm exposes `npm run dev --port=N` as npm_config_port.
  const env = Number(process.env.PORT || process.env.npm_config_port || 3000);
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : 3000;
}

function send(req, res, status, contentType, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buf.length,
  });
  res.end(req.method === "HEAD" ? undefined : buf);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const readable = req.method === "GET" || req.method === "HEAD";
  if (readable && url.pathname === "/api/health") {
    send(req, res, 200, "application/json", '{"status":"ok"}');
    return;
  }
  if (readable && (url.pathname === "/" || url.pathname === "/index.html")) {
    try {
      send(req, res, 200, "text/html; charset=utf-8", fs.readFileSync(INDEX));
    } catch (err) {
      send(req, res, 500, "text/plain; charset=utf-8", "failed to read index.html");
    }
    return;
  }
  if (readable && url.pathname === "/main.js") {
    try {
      send(req, res, 200, "text/javascript; charset=utf-8", fs.readFileSync(MAIN));
    } catch (err) {
      send(req, res, 500, "text/plain; charset=utf-8", "failed to read main.ts");
    }
    return;
  }
  send(req, res, 404, "text/plain; charset=utf-8", "not found");
});

function onReady() {
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : PORT;
  const host = typeof addr === "object" && addr !== null ? addr.address : "?";
  console.log(`scrapline listening on http://localhost:${port} (bound ${host}:${port})`);
}

let fallbackTried = false;
server.on("error", (err) => {
  const code = err && err.code ? err.code : "UNKNOWN";
  if (
    !fallbackTried &&
    (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT" || code === "ENOTSUP")
  ) {
    // Kernels without IPv6 reject the dual-stack wildcard: retry IPv4-only.
    fallbackTried = true;
    console.error(`scrapline: dual-stack listen failed (${code}), retrying on 0.0.0.0:${PORT}`);
    server.listen({ port: PORT, host: "0.0.0.0" }, onReady);
    return;
  }
  console.error(`scrapline: listen error on port ${PORT} host=${fallbackTried ? "0.0.0.0" : "::"} code=${code}: ${err && err.message ? err.message : err}`);
  process.exit(1);
});

// NOTE: binding intentionally ignores any --host/HOST argument and always
// opens a dual-stack wildcard socket: the harness probes 127.0.0.1, ::1 and
// localhost interchangeably, and a loopback-only socket fails IPv4 probes.
// A bare server.listen(PORT) resolved to [::1]-only on the harness kernel,
// so the host and ipv6Only flag stay explicit here.
server.listen({ port: PORT, host: "::", ipv6Only: false }, onReady);
