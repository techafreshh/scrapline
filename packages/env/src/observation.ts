// Egocentric 92-float observation encoder (schema version "1.0").
//
// Layout: self 15 (hp, fuel, vx, vy, onGround, sin/cos aim, weapon
// one-hot x6, mag fraction, reloading) + 3 nearest *visible* enemies x6
// (dx, dy, rel vx, rel vy, hp, dist) + 4 nearest projectiles x5 (dx, dy,
// vx, vy, isGrenade) + 4 nearest active pickups x5 (dx, dy,
// weapon/health/grenades one-hot x3) + 16-ray TileMap.raycast lidar
// fractions + 3 match features (own score, best-opp score, time-left
// fraction). Occluded or missing entries zero-pad in place; every entry
// is Math.fround-rounded (float32-representable) and clamped to [-1, 2].

import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../../core/src/constants";
import { WEAPONS, type WeaponId } from "../../core/src/weapons";
import type { World } from "../../core/src/world";

/** Observation schema version (primary contract). */
export const SCHEMA_VERSION = "1.0";

/** Deprecated numeric version; kept so #19 callers keep compiling. */
export const OBS_VERSION = 1;

/** Fixed observation length. */
export const OBS_LENGTH = 92;

/** Weapon one-hot order (insertion order of the frozen WEAPONS table). */
export const WEAPON_ORDER: readonly WeaponId[] = Object.freeze([
  "pistol",
  "smg",
  "rifle",
  "shotgun",
  "sniper",
  "rocket",
]);

/** Lidar ray count. */
export const LIDAR_RAYS = 16;

/** Lidar ray length in pixels. */
export const LIDAR_RANGE_PX = 900;

/** Finite clamp for every entry: finite, then into [-1, 2]. */
function clean(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < -1) {
    return -1;
  }
  if (value > 2) {
    return 2;
  }
  return value;
}

/**
 * Build the fixed 92-float egocentric observation for `agentId`.
 * Unknown agents read player 0; occluded or missing entities zero-pad
 * in place.
 */
export function buildObs(world: World, agentId = 0): number[] {
  const obs: number[] = [];
  const players = world.players;
  const agent = players.find((p) => p.id === agentId) ?? players[0];
  const ax = agent !== undefined ? agent.x + PLAYER_WIDTH / 2 : 0;
  const ay = agent !== undefined ? agent.y + PLAYER_HEIGHT / 2 : 0;
  const avx = agent !== undefined ? agent.vx : 0;
  const avy = agent !== undefined ? agent.vy : 0;
  const aim = agent !== undefined ? agent.aim : 0;

  // Self (15).
  if (agent === undefined) {
    for (let i = 0; i < 15; i += 1) {
      obs.push(0);
    }
  } else {
    const stat = WEAPONS[agent.weapon] ?? WEAPONS.pistol;
    obs.push(agent.hp / 100);
    obs.push(agent.fuel / 100);
    obs.push(agent.vx / 1150);
    obs.push(agent.vy / 1150);
    obs.push(agent.onGround ? 1 : 0);
    obs.push(Math.sin(agent.aim));
    obs.push(Math.cos(agent.aim));
    for (const name of WEAPON_ORDER) {
      obs.push(agent.weapon === name ? 1 : 0);
    }
    obs.push(stat.mag > 0 ? agent.magAmmo / stat.mag : 0);
    obs.push(agent.reloading ? 1 : 0);
  }

  // 3 nearest visible enemies (18): alive with a wall-free line of
  // sight from the agent center; occluded slots zero-pad.
  const others = players
    .filter(
      (p) => agent !== undefined && p.id !== agent.id && p.alive === true,
    )
    .filter((p) => {
      const ex = p.x + PLAYER_WIDTH / 2;
      const ey = p.y + PLAYER_HEIGHT / 2;
      return world.map.raycast(ax, ay, ex, ey).hit === false;
    })
    .map((p) => ({
      p,
      dist: Math.hypot(p.x + PLAYER_WIDTH / 2 - ax, p.y + PLAYER_HEIGHT / 2 - ay),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);
  for (let i = 0; i < 3; i += 1) {
    const entry = others[i];
    if (entry === undefined) {
      for (let k = 0; k < 6; k += 1) {
        obs.push(0);
      }
      continue;
    }
    const ex = entry.p.x + PLAYER_WIDTH / 2;
    const ey = entry.p.y + PLAYER_HEIGHT / 2;
    obs.push((ex - ax) / 1280);
    obs.push((ey - ay) / 640);
    obs.push((entry.p.vx - avx) / 1150);
    obs.push((entry.p.vy - avy) / 1150);
    obs.push(entry.p.hp / 100);
    obs.push(entry.dist / 1800);
  }

  // 4 nearest projectiles (20): dx, dy, vx, vy, isGrenade (1 grenade,
  // 0 rocket; the sim only ever spawns those two kinds).
  const shots = world.projectiles
    .map((pr) => ({ pr, dist: Math.hypot(pr.x - ax, pr.y - ay) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 4);
  for (let i = 0; i < 4; i += 1) {
    const entry = shots[i];
    if (entry === undefined) {
      for (let k = 0; k < 5; k += 1) {
        obs.push(0);
      }
      continue;
    }
    obs.push((entry.pr.x - ax) / 1280);
    obs.push((entry.pr.y - ay) / 640);
    obs.push(entry.pr.vx / 1150);
    obs.push(entry.pr.vy / 1150);
    obs.push(entry.pr.kind === "grenade" ? 1 : 0);
  }

  // 4 nearest active pickups (20).
  const pads = world.pickups
    .filter((pk) => pk.active)
    .map((pk) => ({ pk, dist: Math.hypot(pk.x - ax, pk.y - ay) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 4);
  for (let i = 0; i < 4; i += 1) {
    const entry = pads[i];
    if (entry === undefined) {
      for (let k = 0; k < 5; k += 1) {
        obs.push(0);
      }
      continue;
    }
    obs.push((entry.pk.x - ax) / 1280);
    obs.push((entry.pk.y - ay) / 640);
    obs.push(entry.pk.kind === "weapon" ? 1 : 0);
    obs.push(entry.pk.kind === "health" ? 1 : 0);
    obs.push(entry.pk.kind === "grenades" ? 1 : 0);
  }

  // 16-ray lidar (16): full-circle fan around the current aim.
  const twoPi = Math.PI * 2;
  for (let k = 0; k < LIDAR_RAYS; k += 1) {
    const ray = aim + (k * twoPi) / LIDAR_RAYS;
    const ex = ax + Math.cos(ray) * LIDAR_RANGE_PX;
    const ey = ay + Math.sin(ray) * LIDAR_RANGE_PX;
    obs.push(world.map.raycast(ax, ay, ex, ey).t);
  }

  // Match features (3).
  const selfIdx = agent === undefined ? -1 : players.indexOf(agent);
  const own = selfIdx >= 0 ? (world.scores[selfIdx] ?? 0) : 0;
  let bestOpp = 0;
  for (let i = 0; i < world.scores.length; i += 1) {
    if (i !== selfIdx) {
      bestOpp = Math.max(bestOpp, world.scores[i] ?? 0);
    }
  }
  const limit = world.scoreLimit > 0 ? world.scoreLimit : 25;
  const timeLeft =
    world.timeLimitTicks > 0
      ? (world.timeLimitTicks - world.tick) / world.timeLimitTicks
      : 0;
  obs.push(own / limit);
  obs.push(bestOpp / limit);
  obs.push(Math.min(1, Math.max(0, timeLeft)));

  return obs.map((value) => clean(Math.fround(value)));
}

/**
 * Deprecated alias of buildObs; kept so #19 callers keep compiling.
 */
export function buildObservation(world: World, agentId = 0): number[] {
  return buildObs(world, agentId);
}
