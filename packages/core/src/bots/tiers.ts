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
  /** Human-like angle error in radians; pure alias kept equal to aimErrorRad. */
  angleError: number;
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
    angleError: 0.018,
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
    angleError: 0.0157,
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
    angleError: 0.0133,
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
    angleError: 0.011,
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

/** Matches needed to ramp from each tier into the next (elite is capped). */
export const RAMP_MATCHES: Record<TierName, number> = Object.freeze({
  easy: 10,
  normal: 15,
  hard: 20,
  elite: 0,
} as Record<TierName, number>);

/** Next tier in the ramp ladder (elite ramps to itself). */
export const NEXT_TIER: Record<TierName, TierName> = Object.freeze({
  easy: "normal",
  normal: "hard",
  hard: "elite",
  elite: "elite",
} as Record<TierName, TierName>);

/** Frozen ramp tuning bundle for harness introspection. */
export const RAMP_TUNING = Object.freeze({
  EASY_MATCHES: 10,
  NORMAL_MATCHES: 15,
  HARD_MATCHES: 20,
  ELITE_MATCHES: 0,
  RAMP_MATCHES,
  NEXT_TIER,
});

/** True when the value carries the numeric tier fields. */
function isTierProfileLike(value: unknown): value is TierProfile {
  return (
    isRecord(value) &&
    finiteOrNull((value as Record<string, unknown>)["reactionSec"]) !== null &&
    finiteOrNull((value as Record<string, unknown>)["aimErrorRad"]) !== null
  );
}

/** Table entry whose value is the profile (normal for passthroughs). */
function nameOfProfile(profile: TierProfile): TierName {
  for (const name of TIER_LIST) {
    if (TIERS[name] === (profile as TierProfile)) {
      return name;
    }
  }
  return "normal";
}

/** Linearly interpolate every numeric field between two profiles. */
function lerpProfiles(a: TierProfile, b: TierProfile, t: number): TierProfile {
  const mix = typeof t === "number" && Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const at = (x: number, y: number): number => x + (y - x) * mix;
  const err = at(a.aimErrorRad, b.aimErrorRad);
  return {
    reactionSec: at(a.reactionSec, b.reactionSec),
    aimErrorRad: err,
    angleError: err,
    acquireErrorPx: at(a.acquireErrorPx, b.acquireErrorPx),
    dodge: at(a.dodge, b.dodge),
    grenadeUse: at(a.grenadeUse, b.grenadeUse),
    wobbleAmp: at(a.wobbleAmp, b.wobbleAmp),
    leadScale: at(a.leadScale, b.leadScale),
    strafePeriodTicks: Math.round(at(a.strafePeriodTicks, b.strafePeriodTicks)),
  };
}

/** Lerp a tier toward its ramp target: t = clamp(matches / N, 0, 1). */
function rampLerp(base: TierProfile, baseName: TierName, matches: number): TierProfile {
  const total = RAMP_MATCHES[baseName] ?? 0;
  const played =
    typeof matches === "number" && Number.isFinite(matches)
      ? Math.max(0, matches)
      : 0;
  const mix = total > 0 ? Math.min(1, played / total) : 1;
  return lerpProfiles(base, TIERS[NEXT_TIER[baseName] ?? baseName] ?? base, mix);
}

/**
 * Linearly interpolate every numeric field between two profiles.
 * Ramp form `lerpTier(tierName, matchesPlayed)` lerps that tier toward
 * its ramp target with t = clamp(matches / N, 0, 1).
 */
export function lerpTier(a: TierProfile, b: TierProfile, t: number): TierProfile;
export function lerpTier(tierName: string, matchesPlayed: number): TierProfile;
export function lerpTier(
  a: TierProfile | string,
  b: TierProfile | number,
  t?: number,
): TierProfile {
  if (typeof b === "number" && t === undefined) {
    const base =
      typeof a === "string" ? getTier(a) : isTierProfileLike(a) ? a : TIERS.normal;
    return rampLerp(base, nameOfProfile(base), b);
  }
  return lerpProfiles(a as TierProfile, b as TierProfile, t as number);
}

/** Ramp a tier toward its next tier over matches played. */
export function rampTier(tierName: unknown, matchesPlayed: number): TierProfile {
  const base = isTierProfileLike(tierName) ? tierName : getTier(tierName);
  return rampLerp(base, nameOfProfile(base), matchesPlayed);
}

/** Alias of `rampTier` (both spellings lerp toward the next tier). */
export function getRampedTier(
  tierName: unknown,
  matchesPlayed: number,
): TierProfile {
  return rampTier(tierName, matchesPlayed);
}
