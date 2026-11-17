// Combined-server launcher (issue #260): `npm start` boots with zero
// build output present. Prefers the built bundle when it exists, else
// execs the TypeScript source via the repo's tsx devDependency. PORT,
// --port, and all argv/env handling stays inside the server's existing
// resolvePort, so this launcher forwards everything transparently.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DIST_SERVER = path.join(ROOT, "packages", "server", "dist", "server.js");
const SRC_SERVER = path.join(ROOT, "packages", "server", "src", "server.ts");

const args = process.argv.slice(2);
let child;
if (fs.existsSync(DIST_SERVER)) {
  child = spawn(process.execPath, [DIST_SERVER, ...args], {
    env: process.env,
    stdio: "inherit",
  });
} else {
  const localTsx = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx",
  );
  if (fs.existsSync(localTsx)) {
    child = spawn(localTsx, [SRC_SERVER, ...args], {
      env: process.env,
      stdio: "inherit",
    });
  } else {
    child = spawn("npx", ["tsx", SRC_SERVER, ...args], {
      env: process.env,
      stdio: "inherit",
    });
  }
}

// Transparent signal forwarding so Ctrl-C/TERM reaches the server.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    try {
      child.kill(signal);
    } catch {
      // Child already gone; the exit handler below finishes the job.
    }
  });
}

child.on("error", (err) => {
  console.error(`scrapline: failed to start combined server: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
