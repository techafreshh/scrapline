import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function parseArg(name: string, fallback: number): number {
  const args = process.argv.slice(2);
  const flag = `--${name}`;
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === flag && i + 1 < args.length) {
      const value = Number(args[i + 1]);
      if (Number.isInteger(value)) {
        return value;
      }
    } else if (arg.startsWith(prefix)) {
      const value = Number(arg.slice(prefix.length));
      if (Number.isInteger(value)) {
        return value;
      }
    }
  }
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

async function runWorker(): Promise<void> {
  const { replayHash } = await import("../packages/core/src/replay");
  const seed = parseArg("seed", 1234);
  const ticks = parseArg("ticks", 10000);
  console.log(`hash=${replayHash(seed, ticks)}`);
}

function runChild(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`worker exited ${code}: ${err.slice(0, 500)}`));
      }
    });
  });
}

async function runParent(): Promise<void> {
  const seed = parseArg("seed", 1234);
  const ticks = parseArg("ticks", 10000);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const self = path.join(here, "bench-repro.ts");
  const workerArgs = (extra: string[]) => [self, "--worker", ...extra];
  const [first, second] = await Promise.all([
    runChild(workerArgs([`--ticks=${ticks}`, `--seed=${seed}`])),
    runChild(workerArgs([`--ticks=${ticks}`, `--seed=${seed}`])),
  ]);
  const firstMatch = first.match(/hash=([0-9a-f]{8})/);
  const secondMatch = second.match(/hash=([0-9a-f]{8})/);
  const firstHash = firstMatch?.[1] ?? null;
  const secondHash = secondMatch?.[1] ?? null;
  if (firstHash !== null) {
    console.log(`seed=${seed} ticks=${ticks} hash=${firstHash}`);
  }
  const match = firstHash !== null && firstHash === secondHash;
  console.log(`hash match: ${match ? "true" : "false"}`);
  if (!match) {
    console.error(`mismatch: ${firstHash} vs ${secondHash}`);
    process.exit(1);
  }
}

if (hasFlag("worker")) {
  runWorker().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  runParent().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
