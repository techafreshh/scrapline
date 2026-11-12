// Black-box protocol probes for the headless env-server plus unit
// coverage for the action decoder and the observation encoder.
import { describe, expect, it, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { World } from "../../core/src/world";
import {
  ACTION_DIMS,
  ACTION_LENGTH,
  AIM_STEP,
  decodeAction,
} from "../src/action";
import { OBS_LENGTH, OBS_VERSION, buildObservation } from "../src/observation";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const DIST_SERVER = path.join(REPO_ROOT, "packages", "env", "dist", "env-server.js");
const SRC_SERVER = path.join(REPO_ROOT, "packages", "env", "src", "env-server.ts");

function readMapRows(name: string): string[] {
  const text = fs.readFileSync(
    path.join(REPO_ROOT, "packages", "core", "src", "maps", `${name}.txt`),
    "utf8",
  );
  const rows = text.split("\n").map((row) => row.replace(/\r$/, ""));
  if (rows.length > 0 && rows[rows.length - 1] === "") {
    rows.pop();
  }
  return rows;
}

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

  sendRaw(line: string): void {
    this.child.stdin?.write(`${line}\n`);
  }

  next(timeoutMs = 2000): Promise<Record<string, unknown>> {
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

  waitExit(timeoutMs = 2000): Promise<number | null> {
    if (this.child.exitCode !== null) {
      return Promise.resolve(this.child.exitCode);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for server exit"));
      }, timeoutMs);
      this.child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  kill(): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("proc killed"));
    }
    if (this.child.exitCode === null) {
      this.child.kill();
    }
  }
}

const live: EnvProc[] = [];

afterEach(() => {
  while (live.length > 0) {
    (live.pop() as EnvProc).kill();
  }
});

function launch(): EnvProc {
  const proc = new EnvProc();
  live.push(proc);
  return proc;
}

describe("action decoder", () => {
  it("freezes the MultiDiscrete dims and length", () => {
    expect([...ACTION_DIMS]).toEqual([3, 9, 2, 2, 2, 2, 2, 2]);
    expect(ACTION_LENGTH).toBe(8);
  });

  it("decodes the issue example to moveX 1, zero aim delta, jet+fire", () => {
    const input = decodeAction([2, 4, 1, 0, 1, 0, 0, 0], 0);
    expect(input.moveX).toBe(1);
    expect(input.aim).toBe(0);
    expect(input.buttons ?? 0).toBe(1 | 4);
  });

  it("accumulates the aim delta onto prevAim", () => {
    const input = decodeAction([1, 8, 0, 0, 0, 0, 0, 0], 0.5);
    expect(input.moveX).toBe(0);
    expect(Math.abs((input.aim ?? 0) - (0.5 + 4 * AIM_STEP)) < 0.01).toBe(true);
  });

  it("clamps out-of-range indices and never throws", () => {
    const input = decodeAction([99, -5, 7, -3, 2.9, 0, 0, 0], Number.NaN);
    expect(Number.isFinite(input.moveX ?? 0)).toBe(true);
    expect(Number.isFinite(input.aim ?? 0)).toBe(true);
    expect(input.moveX).toBe(1);
    expect((input.buttons ?? 0) & (1 | 4)).toBe(1 | 4);
    expect(decodeAction(null)).toBeDefined();
    expect(decodeAction("nope")).toBeDefined();
    expect(decodeAction(undefined)).toBeDefined();
  });
});

describe("observation encoder", () => {
  it("pins schema version 1 and length 90", () => {
    expect(OBS_VERSION).toBe(1);
    expect(OBS_LENGTH).toBe(90);
  });

  it("emits 90 finite floats on every bundled map and the default arena", () => {
    for (const name of ["kilima", "dune", "frostbite"]) {
      const world = new World({ seed: 7, map: readMapRows(name) });
      for (let i = 0; i < 4; i += 1) {
        world.addPlayer(120 + i * 200);
      }
      world.step([{ fire: true, aim: 0 }, {}, {}, {}]);
      const obs = buildObservation(world, 0);
      expect(obs.length).toBe(90);
      for (const value of obs) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    const bare = new World({ seed: 7 });
    bare.addPlayer();
    const obs = buildObservation(bare, 0);
    expect(obs.length).toBe(90);
    expect(obs.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("zero-pads missing enemies, projectiles, and pickups", () => {
    const world = new World({ seed: 3 });
    world.addPlayer();
    const obs = buildObservation(world, 0);
    expect(obs.length).toBe(90);
    // Enemy section (15..32) is all padding with a single player.
    expect(obs.slice(15, 33).every((value) => value === 0)).toBe(true);
  });
});

describe("env-server protocol", () => {
  it("reset replies within 2s with obs length 85-95 and info.tick 0", async () => {
    const proc = launch();
    proc.send({ op: "reset", seed: 1234, tier: "normal", bots: 3, map: "kilima" });
    const reply = await proc.next();
    const obs = reply["obs"] as number[];
    expect(Array.isArray(obs)).toBe(true);
    expect(obs.length).toBeGreaterThanOrEqual(85);
    expect(obs.length).toBeLessThanOrEqual(95);
    expect(obs.length).toBe(OBS_LENGTH);
    expect(obs.every((value) => Number.isFinite(value))).toBe(true);
    const info = reply["info"] as Record<string, unknown>;
    expect(info["tick"]).toBe(0);
    expect(info["scores"]).toEqual([0, 0, 0, 0]);
  });

  it("step replies with numeric reward and same-length obs", async () => {
    const proc = launch();
    proc.send({ op: "reset", seed: 1234, tier: "normal", bots: 3, map: "kilima" });
    const first = await proc.next();
    const firstObs = first["obs"] as number[];
    proc.send({ op: "step", action: [2, 4, 1, 0, 1, 0, 0, 0] });
    const reply = await proc.next();
    expect(typeof reply["reward"]).toBe("number");
    expect(Number.isFinite(reply["reward"] as number)).toBe(true);
    const obs = reply["obs"] as number[];
    expect(obs.length).toBe(firstObs.length);
    expect(reply["terminated"]).toBe(false);
    expect(reply["truncated"]).toBe(false);
    const info = reply["info"] as Record<string, unknown>;
    expect(info["tick"]).toBe(1);
    expect(Array.isArray(info["scores"])).toBe(true);
    expect(Array.isArray(info["events"])).toBe(true);
  });

  it("close exits with code 0 within 2s", async () => {
    const proc = launch();
    proc.send({ op: "reset", seed: 1, tier: "normal", bots: 1, map: "kilima" });
    await proc.next();
    proc.send({ op: "close" });
    await expect(proc.waitExit()).resolves.toBe(0);
  });

  it("replays deterministically across procs for seed and action log", async () => {
    const actions = [
      [2, 4, 1, 0, 1, 0, 0, 0],
      [0, 3, 0, 1, 0, 0, 0, 0],
      [1, 5, 1, 0, 1, 0, 0, 0],
    ];
    const run = async (): Promise<number[]> => {
      const proc = launch();
      proc.send({ op: "reset", seed: 99, tier: "hard", bots: 2, map: "dune" });
      await proc.next();
      let obs: number[] = [];
      for (const action of actions) {
        proc.send({ op: "step", action });
        const reply = await proc.next();
        obs = reply["obs"] as number[];
      }
      return obs;
    };
    expect(await run()).toEqual(await run());
  });

  it("recovers from malformed lines with an error reply", async () => {
    const proc = launch();
    proc.sendRaw("this is not json");
    const reply = await proc.next();
    expect(typeof reply["error"]).toBe("string");
    proc.send({ op: "reset", seed: 5, tier: "easy", bots: 1, map: "nope" });
    const reset = await proc.next();
    expect(Array.isArray(reset["obs"])).toBe(true);
    expect((reset["info"] as Record<string, unknown>)["tick"]).toBe(0);
  });

  it("rejects steps before reset and unknown ops without exiting", async () => {
    const proc = launch();
    proc.send({ op: "step", action: [1, 4, 0, 0, 0, 0, 0, 0] });
    const denied = await proc.next();
    expect(typeof denied["error"]).toBe("string");
    proc.send({ op: "dance" });
    const unknown = await proc.next();
    expect(typeof unknown["error"]).toBe("string");
    proc.send({ op: "close" });
    await expect(proc.waitExit()).resolves.toBe(0);
  });
});
