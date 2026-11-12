import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
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

function parseStr(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const flag = `--${name}`;
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === flag && i + 1 < args.length) {
      return String(args[i + 1]);
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return fallback;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DIST_SERVER = path.join(REPO_ROOT, "packages", "env", "dist", "env-server.js");
const SRC_SERVER = path.join(REPO_ROOT, "packages", "env", "src", "env-server.ts");

// Fixed 10-action MultiDiscrete log mirrored from rl/tests/test_env.py so the
// load is deterministic and comparable across runs.
const ACTIONS: number[][] = [
  [2, 4, 1, 0, 1, 0, 0, 0],
  [0, 3, 0, 1, 0, 0, 0, 0],
  [1, 5, 1, 0, 1, 0, 0, 0],
  [2, 4, 0, 0, 0, 1, 0, 0],
  [1, 4, 0, 0, 1, 0, 0, 1],
  [0, 6, 1, 1, 0, 0, 0, 0],
  [2, 2, 0, 0, 0, 0, 1, 0],
  [1, 7, 0, 1, 1, 0, 0, 0],
  [2, 4, 1, 0, 0, 0, 0, 0],
  [0, 4, 0, 0, 1, 0, 0, 1],
];

interface PendingWaiter {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Spawned env-server with line-framed JSON send/receive. */
class EnvProc {
  readonly child: ChildProcess;
  private buffer = "";
  private readonly queue: Record<string, unknown>[] = [];
  private readonly waiters: PendingWaiter[] = [];

  constructor() {
    if (fs.existsSync(DIST_SERVER)) {
      this.child = spawn(process.execPath, [DIST_SERVER], {
        cwd: REPO_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      this.child = spawn("npx", ["tsx", SRC_SERVER], {
        cwd: REPO_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let idx = this.buffer.indexOf("\n");
      while (idx >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line.length > 0) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line) as Record<string, unknown>;
          } catch {
            parsed = { error: `non-JSON protocol line: ${line.slice(0, 80)}` };
          }
          const waiter = this.waiters.shift();
          if (waiter !== undefined) {
            clearTimeout(waiter.timer);
            waiter.resolve(parsed);
          } else {
            this.queue.push(parsed);
          }
        }
        idx = this.buffer.indexOf("\n");
      }
    });
  }

  send(value: unknown): void {
    this.child.stdin?.write(`${JSON.stringify(value)}\n`);
  }

  next(timeoutMs = 15000): Promise<Record<string, unknown>> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for protocol line"));
      }, timeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  shutdown(): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("proc shut down"));
    }
    try {
      this.child.stdin?.write(`${JSON.stringify({ op: "close" })}\n`);
    } catch {
      // Ignore write failures during shutdown.
    }
    if (this.child.exitCode === null) {
      this.child.kill();
    }
  }
}

async function main(): Promise<void> {
  const envs = parseArg("envs", 8);
  const steps = parseArg("steps", 500);
  const seed = parseArg("seed", 1234);
  const bots = parseArg("bots", 3);
  const map = parseStr("map", "kilima");
  const tier = parseStr("tier", "normal");

  const procs: EnvProc[] = [];
  try {
    for (let i = 0; i < envs; i += 1) {
      procs.push(new EnvProc());
    }
    await Promise.all(
      procs.map((proc, i) => {
        proc.send({ op: "reset", seed: seed + i, tier, bots, map });
        return proc.next();
      }),
    );

    const latencies: number[] = [];
    const start = process.hrtime.bigint();
    for (let s = 0; s < steps; s += 1) {
      const action = ACTIONS[s % ACTIONS.length];
      await Promise.all(
        procs.map(async (proc) => {
          const t0 = process.hrtime.bigint();
          proc.send({ op: "step", action });
          await proc.next();
          const t1 = process.hrtime.bigint();
          latencies.push(Number(t1 - t0) / 1e6);
        }),
      );
    }
    const end = process.hrtime.bigint();
    const elapsedS = Number(end - start) / 1e9;
    const totalTicks = envs * steps;
    const rate = elapsedS > 0 ? totalTicks / elapsedS : 0;

    latencies.sort((a, b) => a - b);
    const pick = (q: number): number =>
      latencies.length > 0 ? (latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] as number) : 0;
    const p50 = pick(0.5);
    const p95 = pick(0.95);
    const mean = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const max = latencies.length > 0 ? (latencies[latencies.length - 1] as number) : 0;

    console.log(
      `throughput: ${Math.round(rate)} ticks/s (${envs} envs x ${steps} steps in ${elapsedS.toFixed(2)}s)`,
    );
    console.log(`p50_ms=${p50.toFixed(3)} p95_ms=${p95.toFixed(3)} mean_ms=${mean.toFixed(3)} max_ms=${max.toFixed(3)}`);
  } finally {
    for (const proc of procs) {
      proc.shutdown();
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
