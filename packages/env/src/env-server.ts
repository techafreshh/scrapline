#!/usr/bin/env node
// Headless RL gateway: one World per process speaking JSON-lines on stdio.
//
// Protocol (stdout carries only protocol lines, diagnostics go to stderr):
//   {"op":"reset","seed":1234,"tier":"normal","bots":3,"map":"kilima"}
//     -> {"obs":[...92 floats...],"info":{"tick":0,"scores":[...]}}
//   {"op":"step","action":[2,4,1,0,1,0,0,0]}
//     -> {"obs":[...],"reward":0.5,"terminated":false,"truncated":false,
//         "info":{"tick":1,"scores":[...],"events":[...]}}. One step
//         advances exactly one 60 Hz world tick.
//   {"op":"close"} -> exits 0 without writing anything further.
// Malformed JSON, unknown ops, and pre-reset steps reply {"error":...}
// without exiting.

import * as fs from "node:fs";
import * as path from "node:path";
import { World, type WorldInput } from "../../core/src/world";
import { BotBrain } from "../../core/src/bots/brain";
import {
  Director,
  type BotView,
  type VictimView,
} from "../../core/src/bots/director";
import { actionToInput } from "./action";
import { buildObs } from "./observation";

/** Live episode: world plus the per-episode brains, director, and views. */
interface Episode {
  world: World;
  brains: BotBrain[];
  director: Director;
  botViews: BotView[];
  prevScores: number[];
  prevHp: number[];
  prevAlive: boolean[];
  prevAim: number;
}

let episode: Episode | null = null;

/** Cached ASCII rows per map name (unknown names fall back to default). */
const mapCache = new Map<string, string[] | null>();

/** Read packages/core/src/maps/<name>.txt once; null when unknown. */
function mapRowsFor(name: unknown): string[] | null {
  if (typeof name !== "string") {
    return null;
  }
  const key = name.trim().toLowerCase();
  if (key.length === 0) {
    return null;
  }
  if (mapCache.has(key)) {
    return mapCache.get(key) ?? null;
  }
  // From src/ or dist/ alike, ../../core reaches packages/core.
  const file = path.join(
    __dirname,
    "..",
    "..",
    "core",
    "src",
    "maps",
    `${key}.txt`,
  );
  let rows: string[] | null;
  try {
    const text = fs.readFileSync(file, "utf8");
    const list = text.split("\n").map((row) => row.replace(/\r$/, ""));
    if (list.length > 0 && list[list.length - 1] === "") {
      list.pop();
    }
    rows = list;
  } catch {
    rows = null;
  }
  mapCache.set(key, rows);
  return rows;
}

/** Floor to an int, falling back when missing or non-finite. */
function intOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  return fallback;
}

/** Clamp an int field into [lo, hi], falling back when missing. */
function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = intOr(value, fallback);
  if (n < lo) {
    return lo;
  }
  if (n > hi) {
    return hi;
  }
  return n;
}

/** Write one protocol line to stdout (never to stderr). */
function writeLine(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** Current hp per player-array position (dead players read 0). */
function hpList(world: World): number[] {
  return world.players.map((p) => (p.alive ? p.hp : 0));
}

/** Handle `reset`: build a fresh world, brains, and director. */
function handleReset(msg: Record<string, unknown>): unknown {
  const seed = intOr(msg["seed"], 0);
  const tier = typeof msg["tier"] === "string" ? msg["tier"] : "normal";
  const bots = clampInt(msg["bots"], 0, 16, 3);
  const rampRaw = msg["ramp"];
  const ramp =
    typeof rampRaw === "number" && Number.isFinite(rampRaw)
      ? Math.max(0, rampRaw)
      : 0;
  const rows = mapRowsFor(msg["map"]);
  const world =
    rows !== null ? new World({ seed, map: rows }) : new World({ seed });
  const total = bots + 1;
  const width = world.map.widthPixels;
  for (let i = 0; i < total; i += 1) {
    const x = total === 1 ? width / 2 : 80 + (i * (width - 160)) / (total - 1);
    world.addPlayer(x);
  }
  const brains: BotBrain[] = [];
  const botViews: BotView[] = [];
  for (let i = 0; i < bots; i += 1) {
    brains.push(new BotBrain({ tier, seed: seed + i + 1, id: i + 1, ramp }));
    botViews.push({ id: i + 1 });
  }
  const director = new Director(seed ^ 0x9e37);
  episode = {
    world,
    brains,
    director,
    botViews,
    prevScores: world.scores.slice(),
    prevHp: hpList(world),
    prevAlive: world.players.map((p) => p.alive),
    prevAim: 0,
  };
  return {
    obs: buildObs(world, 0),
    info: { tick: world.tick, scores: world.scores.slice() },
  };
}

/** Handle `step`: decode the agent input, tick bots, advance one tick. */
function handleStep(msg: Record<string, unknown>): unknown {
  const active = episode;
  if (active === null) {
    return { error: "no active episode: send reset first" };
  }
  const { world, brains, director, botViews } = active;
  const victims: VictimView[] = world.players.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    alive: p.alive,
  }));
  for (const view of botViews) {
    const player = world.players.find((p) => p.id === view.id);
    if (player !== undefined) {
      view.x = player.x;
      view.y = player.y;
      view.alive = player.alive;
    }
  }
  director.assignTargets(botViews, victims, world.map);

  let agentInput: WorldInput;
  try {
    agentInput = actionToInput(msg["action"], active.prevAim);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "invalid action" };
  }
  active.prevAim = agentInput.aim ?? 0;

  const botInputs = brains.map((brain, k) => {
    const view = botViews[k] as BotView;
    const player = world.players[k + 1];
    const enemies = world.players
      .filter((p) => player === undefined || p.id !== player.id)
      .map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        hp: p.hp,
        alive: p.alive,
      }));
    return brain.tick({
      self: {
        id: view.id,
        x: player?.x ?? 0,
        y: player?.y ?? 0,
        vx: player?.vx ?? 0,
        vy: player?.vy ?? 0,
        hp: player?.hp ?? 0,
        weapon: player?.weapon ?? "pistol",
        aim: player?.aim ?? 0,
        alive: player?.alive ?? false,
        magAmmo: player?.magAmmo ?? 0,
        grenades: player?.grenades ?? 0,
        cooldownTicks: player?.cooldownTicks ?? 0,
        reloading: player?.reloading ?? false,
        grenadeCooldownTicks: player?.grenadeCooldownTicks ?? 0,
        attackToken: view.attackToken ?? null,
        roamPoint: view.roamPoint ?? null,
        grenadeAllowed: view.grenadeAllowed ?? true,
        fuel: player?.fuel ?? 0,
        onGround: player?.onGround ?? false,
      },
      enemies,
      projectiles: world.projectiles.map((pr) => ({
        kind: pr.kind,
        x: pr.x,
        y: pr.y,
        vx: pr.vx,
        vy: pr.vy,
        ownerId: pr.ownerId,
        lifeTicks: pr.lifeTicks,
      })),
      pickups: world.pickups.map((pk) => ({
        kind: pk.kind,
        x: pk.x,
        y: pk.y,
        weapon: pk.weapon,
        active: pk.active,
      })),
      map: world.map,
      tick: world.tick,
    });
  });

  const scoresBefore = active.prevScores.slice();
  const hpBefore = active.prevHp.slice();
  const aliveBefore = active.prevAlive.slice();
  const ownBefore = hpBefore[0] ?? 0;
  let oppBefore = 0;
  for (let i = 1; i < hpBefore.length; i += 1) {
    oppBefore += hpBefore[i] ?? 0;
  }

  const events = world.step([agentInput, ...botInputs]);

  const scores = world.scores.slice();
  const hpAfter = hpList(world);
  const kills = Math.max(0, (scores[0] ?? 0) - (scoresBefore[0] ?? 0));
  const died = aliveBefore[0] === true && world.players[0]?.alive === false ? 1 : 0;
  let oppAfter = 0;
  for (let i = 1; i < hpAfter.length; i += 1) {
    oppAfter += hpAfter[i] ?? 0;
  }
  const damageDealt = Math.max(0, oppBefore - oppAfter);
  const damageTaken = Math.max(0, ownBefore - (hpAfter[0] ?? 0));
  let reward =
    kills - died + 0.005 * damageDealt - 0.0025 * damageTaken;
  const terminated = world.matchOver;
  if (terminated) {
    reward += world.standings()[0] === 0 ? 2 : -2;
  }

  active.prevScores = scores;
  active.prevHp = hpAfter;
  active.prevAlive = world.players.map((p) => p.alive);

  return {
    obs: buildObs(world, 0),
    reward,
    terminated,
    truncated: false,
    info: { tick: world.tick, scores, events },
  };
}

/** Dispatch one parsed line; `close` exits 0 and writes nothing. */
function dispatch(msg: unknown): void {
  if (typeof msg !== "object" || msg === null) {
    writeLine({ error: "expected a JSON object with an op field" });
    return;
  }
  const op = (msg as Record<string, unknown>)["op"];
  if (op === "reset") {
    writeLine(handleReset(msg as Record<string, unknown>));
  } else if (op === "step") {
    writeLine(handleStep(msg as Record<string, unknown>));
  } else if (op === "close") {
    process.exit(0);
  } else {
    writeLine({ error: `unknown op: ${String(op)}` });
  }
}

/** Parse and dispatch one raw input line (blank lines are ignored). */
function handleLine(line: string): void {
  if (line.trim().length === 0) {
    return;
  }
  try {
    dispatch(JSON.parse(line) as unknown);
  } catch (err) {
    console.error(
      `scrapline-env: invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    writeLine({ error: "invalid JSON" });
  }
}

process.stdin.setEncoding("utf8");
let pending = "";
process.stdin.on("data", (chunk: string) => {
  pending += chunk;
  let idx = pending.indexOf("\n");
  while (idx >= 0) {
    const line = pending.slice(0, idx);
    pending = pending.slice(idx + 1);
    try {
      handleLine(line);
    } catch (err) {
      console.error(
        `scrapline-env: handler failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      writeLine({ error: "internal error" });
    }
    idx = pending.indexOf("\n");
  }
});
process.stdin.on("end", () => {
  process.exit(0);
});
process.stdin.resume();
