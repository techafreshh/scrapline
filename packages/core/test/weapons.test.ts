import { describe, expect, it } from "vitest";
import {
  WEAPON_PISTOL_INTERVAL_TICKS,
  WEAPON_RIFLE_INTERVAL_TICKS,
  WEAPON_ROCKET_INTERVAL_TICKS,
  WEAPON_SHOTGUN_INTERVAL_TICKS,
  WEAPON_SMG_INTERVAL_TICKS,
  WEAPON_SNIPER_INTERVAL_TICKS,
} from "../src/constants";
import { WEAPONS } from "../src/weapons";
import type { Pickup, Player, Projectile, Prop } from "../src/entities";

describe("WEAPONS table", () => {
  it("has exactly the six weapon keys", () => {
    expect(Object.keys(WEAPONS).sort()).toEqual([
      "pistol",
      "rifle",
      "rocket",
      "shotgun",
      "smg",
      "sniper",
    ]);
    expect(Object.keys(WEAPONS)).toHaveLength(6);
  });

  it("has sniper damage 95 and pistol damage 20", () => {
    expect(WEAPONS.sniper.damage).toBe(95);
    expect(WEAPONS.pistol.damage).toBe(20);
  });

  it("has shotgun pellets 8", () => {
    expect(WEAPONS.shotgun.pellets).toBe(8);
  });

  it("has finite positive damage/cooldown/mag/reload/range and non-negative spread", () => {
    for (const weapon of Object.values(WEAPONS)) {
      for (const field of ["damage", "cooldownTicks", "mag", "reload", "range"] as const) {
        expect(Number.isFinite(weapon[field])).toBe(true);
        expect(weapon[field]).toBeGreaterThan(0);
      }
      expect(Number.isFinite(weapon.spread)).toBe(true);
      expect(weapon.spread).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(weapon.pellets)).toBe(true);
      expect(weapon.pellets).toBeGreaterThanOrEqual(1);
    }
  });

  it("matches the cooldown constants", () => {
    expect(WEAPONS.pistol.cooldownTicks).toBe(WEAPON_PISTOL_INTERVAL_TICKS);
    expect(WEAPONS.smg.cooldownTicks).toBe(WEAPON_SMG_INTERVAL_TICKS);
    expect(WEAPONS.rifle.cooldownTicks).toBe(WEAPON_RIFLE_INTERVAL_TICKS);
    expect(WEAPONS.shotgun.cooldownTicks).toBe(WEAPON_SHOTGUN_INTERVAL_TICKS);
    expect(WEAPONS.sniper.cooldownTicks).toBe(WEAPON_SNIPER_INTERVAL_TICKS);
    expect(WEAPONS.rocket.cooldownTicks).toBe(WEAPON_ROCKET_INTERVAL_TICKS);
  });

  it("exports serializable entity types", () => {
    const player: Player = {
      id: 1,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      hp: 100,
      fuel: 100,
      aim: 0,
      weapon: "pistol",
      onGround: true,
      crouching: false,
      alive: true,
      magAmmo: 12,
      reloading: false,
      respawnTicks: 0,
    };
    const projectile: Projectile = {
      id: 1,
      kind: "pistol",
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      damage: 20,
      ownerId: 1,
      lifeTicks: 60,
    };
    const pickup: Pickup = {
      id: 1,
      kind: "weapon",
      x: 0,
      y: 0,
      weapon: "rifle",
      amount: 0,
      active: true,
      respawnTicks: 0,
    };
    const prop: Prop = {
      id: 1,
      kind: "barrel",
      x: 0,
      y: 0,
      w: 32,
      h: 32,
      hp: 50,
      alive: true,
      respawnTicks: 0,
    };
    expect(JSON.parse(JSON.stringify({ player, projectile, pickup, prop }))).toEqual({
      player,
      projectile,
      pickup,
      prop,
    });
  });
});
