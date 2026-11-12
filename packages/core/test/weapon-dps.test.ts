import { describe, expect, it } from "vitest";
import {
  TICK_HZ,
  WEAPON_PISTOL_INTERVAL_TICKS,
  WEAPON_RIFLE_INTERVAL_TICKS,
  WEAPON_ROCKET_INTERVAL_TICKS,
  WEAPON_SHOTGUN_INTERVAL_TICKS,
  WEAPON_SMG_INTERVAL_TICKS,
  WEAPON_SNIPER_INTERVAL_TICKS,
} from "../src/constants";
import { WEAPONS, type WeaponId } from "../src/weapons";

// Sustained single-target DPS from the data table: damage per shot times
// pellets per shot divided by seconds per shot. Ignores reload, spread
// falloff, and headshots so the invariant tracks tuning, not ballistics.
function dpsOf(id: WeaponId): number {
  const stat = WEAPONS[id];
  return (stat.damage * stat.pellets * TICK_HZ) / stat.cooldownTicks;
}

describe("weapon DPS invariants", () => {
  it("rifle_dps exceeds pistol_dps", () => {
    const rifle_dps = dpsOf("rifle");
    const pistol_dps = dpsOf("pistol");
    expect(Number.isFinite(rifle_dps)).toBe(true);
    expect(Number.isFinite(pistol_dps)).toBe(true);
    expect(rifle_dps).toBeGreaterThan(pistol_dps);
  });

  it("sniper single-hit is 95", () => {
    expect(WEAPONS.sniper.damage).toBe(95);
  });

  it("every cooldown matches its WEAPON_*_INTERVAL_TICKS constant", () => {
    expect(WEAPONS.pistol.cooldownTicks).toBe(WEAPON_PISTOL_INTERVAL_TICKS);
    expect(WEAPONS.smg.cooldownTicks).toBe(WEAPON_SMG_INTERVAL_TICKS);
    expect(WEAPONS.rifle.cooldownTicks).toBe(WEAPON_RIFLE_INTERVAL_TICKS);
    expect(WEAPONS.shotgun.cooldownTicks).toBe(WEAPON_SHOTGUN_INTERVAL_TICKS);
    expect(WEAPONS.sniper.cooldownTicks).toBe(WEAPON_SNIPER_INTERVAL_TICKS);
    expect(WEAPONS.rocket.cooldownTicks).toBe(WEAPON_ROCKET_INTERVAL_TICKS);
  });
});
