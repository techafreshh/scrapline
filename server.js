// Walking-skeleton dev server — zero dependencies, node:http/fs/path only.
// Routes: GET / -> client page, GET /main.js -> client loop source served as
// JavaScript, GET /api/health -> {"status":"ok"}. Everything else is a 404.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const INDEX = path.join(ROOT, "packages", "client", "index.html");
const MAIN = path.join(ROOT, "packages", "client", "src", "main.ts");

const PORT = Number(process.env.PORT || 3000);

function send(res, status, contentType, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buf.length,
  });
  res.end(buf);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/api/health") {
    send(res, 200, "application/json", '{"status":"ok"}');
    return;
  }
  if (req.method === "GET" && url.pathname === "/") {
    try {
      send(res, 200, "text/html; charset=utf-8", fs.readFileSync(INDEX));
    } catch (err) {
      send(res, 500, "text/plain; charset=utf-8", "failed to read index.html");
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/main.js") {
    try {
      send(res, 200, "text/javascript; charset=utf-8", fs.readFileSync(MAIN));
    } catch (err) {
      send(res, 500, "text/plain; charset=utf-8", "failed to read main.ts");
    }
    return;
  }
  send(res, 404, "text/plain; charset=utf-8", "not found");
});

server.listen(PORT, "0.0.0.0", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : PORT;
  console.log(`scrapline listening on http://localhost:${port}`);
});
