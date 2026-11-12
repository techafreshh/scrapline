// Bot skill tiers — per-tier perception, aim, and nerve tuning.
//
// The sim is sacred: this module is pure data plus tiny pure helpers
// (no DOM, Node, clock, or Math.random). Tiers mirror the frozen-table
// discipline of WEAPONS in ../weapons and DIRECTOR_TUNING in
// ./director so harnesses can read the whole table as one object.

/** Bot skill tier names, weakest first. */
export type TierName = "easy" | "normal" | "hard" | "elite";

/** Per-tier perception, aim, and nerve parameters. */
export interface TierProfile {
  /** Seconds of continuous sight before a contact counts (x12Hz to ticks). */
  reactionSec: number;
  /** Base aim error in radians (fire gate is error x4 + weapon spread). */
  aimErrorRad: number;
  /** Initial target-acquisition offset in pixels (decays after first sight). */
  acquireErrorPx: number;
  /** Strafe-flip probability scale (higher flips sooner and more often). */
  dodge: number;
  /** Per-tick grenade-throw probability while holding a combat band. */
  grenadeUse: number;
  /** Ornstein-Uhlenbeck aim-wobble amplitude scale. */
  wobbleAmp: number;
  /** Velocity-lead fraction applied when aiming at movers. */
  leadScale: number;
  /** Brain ticks between scheduled strafe-direction flips. */
  strafePeriodTicks: number;
}

/** Tier names in ascending skill order. */
export const TIER_LIST: readonly TierName[] = ["easy", "normal", "hard", "elite"];

/**
 * Frozen skill table. Reaction 0.35s → 0.22s and dodge 0.25 → 0.7 run
 * easy → elite; normal/hard interpolate linearly between the endpoints.
 */
export const TIERS: Record<TierName, TierProfile> = Object.freeze({
  easy: Object.freeze({
    reactionSec: 0.35,
    aimErrorRad: 0.018,
    acquireErrorPx: 66,
    dodge: 0.25,
    grenadeUse: 0.03,
    wobbleAmp: 3.0,
    leadScale: 0.2,
    strafePeriodTicks: 90,
  }),
  normal: Object.freeze({
    reactionSec: 0.307,
    aimErrorRad: 0.0157,
    acquireErrorPx: 60.7,
    dodge: 0.4,
    grenadeUse: 0.22,
    wobbleAmp: 2.2,
    leadScale: 0.47,
    strafePeriodTicks: 73,
  }),
  hard: Object.freeze({
    reactionSec: 0.263,
    aimErrorRad: 0.0133,
    acquireErrorPx: 55.3,
    dodge: 0.55,
    grenadeUse: 0.41,
    wobbleAmp: 1.5,
    leadScale: 0.73,
    strafePeriodTicks: 57,
  }),
  elite: Object.freeze({
    reactionSec: 0.22,
    aimErrorRad: 0.011,
    acquireErrorPx: 50,
    dodge: 0.7,
    grenadeUse: 0.6,
    wobbleAmp: 0.8,
    leadScale: 1.0,
    strafePeriodTicks: 40,
  }),
} as Record<TierName, TierProfile>);

/** True when the value is one of the four tier names. */
export function isTierName(value: unknown): value is TierName {
  return (
    value === "easy" ||
    value === "normal" ||
    value === "hard" ||
    value === "elite"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Resolve a tier profile tolerantly: exact (case-insensitive) names hit
 * the frozen table, profile-shaped objects pass through, and anything
 * else (unknown strings, numbers, null, undefined) falls back to normal.
 */
export function getTier(name?: unknown): TierProfile {
  if (
    isRecord(name) &&
    finiteOrNull(name["reactionSec"]) !== null &&
    finiteOrNull(name["aimErrorRad"]) !== null
  ) {
    return name as unknown as TierProfile;
  }
  if (typeof name === "string") {
    const key = name.trim().toLowerCase();
    if (isTierName(key)) {
      return TIERS[key];
    }
  }
  return TIERS.normal;
}

/** Linearly interpolate every numeric field between two profiles. */
export function lerpTier(a: TierProfile, b: TierProfile, t: number): TierProfile {
  const mix = typeof t === "number" && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const at = (x: number, y: number): number => x + (y - x) * mix;
  return {
    reactionSec: at(a.reactionSec, b.reactionSec),
    aimErrorRad: at(a.aimErrorRad, b.aimErrorRad),
    acquireErrorPx: at(a.acquireErrorPx, b.acquireErrorPx),
    dodge: at(a.dodge, b.dodge),
    grenadeUse: at(a.grenadeUse, b.grenadeUse),
    wobbleAmp: at(a.wobbleAmp, b.wobbleAmp),
    leadScale: at(a.leadScale, b.leadScale),
    strafePeriodTicks: Math.round(at(a.strafePeriodTicks, b.strafePeriodTicks)),
  };
}
