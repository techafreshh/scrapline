// Contract probes for the bench tools: tiny-scale runs asserting the exact
// literal output strings the acceptance scenarios grep for.
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

function runBench(args: string[], timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("npx", ["tsx", ...args], { cwd: REPO_ROOT, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`bench failed: ${String(err.message)} stdout=${stdout.slice(0, 500)} stderr=${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

describe("bench:repro", () => {
  it("prints hash match: true for two cross-process replays", async () => {
    const stdout = await runBench(["tools/bench-repro.ts", "--ticks", "200", "--seed", "7"]);
    expect(stdout).toContain("hash match: true");
  });
});

describe("bench:throughput", () => {
  it("prints ticks/s and p95_ms at small scale", async () => {
    const stdout = await runBench(["tools/bench-throughput.ts", "--envs", "2", "--steps", "20"]);
    expect(stdout).toMatch(/\d+ ticks\/s/);
    expect(stdout).toMatch(/p95_ms=\d/);
    const rateMatch = stdout.match(/(\d+) ticks\/s/);
    expect(rateMatch).not.toBeNull();
    expect(Number((rateMatch as RegExpMatchArray)[1])).toBeGreaterThanOrEqual(1000);
  });
});
