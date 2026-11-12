// Synthesized SFX presets: the single tunable surface for game audio.
//
// This module is pure data plus DOM-free helpers (the WEAPONS frozen-table
// idiom from packages/core/src/weapons.ts): no AudioContext, window, or
// document access, so it imports cleanly under node for unit tests. The
// lazy engine in ./engine.ts owns every WebAudio object.

/** Weapon families with a synthesized shot voice. */
export type SfxWeaponFamily =
  | "pistol"
  | "smg"
  | "rifle"
  | "shotgun"
  | "sniper"
  | "rocket";

/** Every named voice the engine can play. */
export type SfxName = SfxWeaponFamily | "reload" | "dryfire" | "bounce" | "explosion";

/** Tunable per-voice synth parameters. */
export interface SfxPreset {
  /** Oscillator start frequency in Hz (distinct per family). */
  baseFreq: number;
  /** Voice length in milliseconds. */
  durationMs: number;
  /** Oscillator body, noise transient, or both. */
  kind: "tone" | "noise" | "mix";
  /** Oscillator waveform. */
  wave: OscillatorType;
  /** Optional pitch-glide target in Hz (sweeps and drops). */
  slideTo?: number;
  /** Shared-noise transient level in [0, 1]. */
  noise?: number;
}

/** Frozen per-voice synth table (no binary assets, ever). */
export const SFX_PRESETS: Record<SfxName, SfxPreset> = Object.freeze({
  pistol: Object.freeze({
    baseFreq: 880,
    durationMs: 120,
    kind: "mix",
    wave: "square",
    slideTo: 220,
    noise: 0.3,
  }),
  smg: Object.freeze({
    baseFreq: 660,
    durationMs: 90,
    kind: "mix",
    wave: "square",
    slideTo: 330,
    noise: 0.25,
  }),
  rifle: Object.freeze({
    baseFreq: 520,
    durationMs: 140,
    kind: "mix",
    wave: "sawtooth",
    slideTo: 180,
    noise: 0.3,
  }),
  shotgun: Object.freeze({
    baseFreq: 160,
    durationMs: 260,
    kind: "mix",
    wave: "sawtooth",
    slideTo: 70,
    noise: 0.5,
  }),
  sniper: Object.freeze({
    baseFreq: 1400,
    durationMs: 320,
    kind: "mix",
    wave: "sawtooth",
    slideTo: 300,
    noise: 0.35,
  }),
  rocket: Object.freeze({
    baseFreq: 90,
    durationMs: 500,
    kind: "mix",
    wave: "sawtooth",
    slideTo: 45,
    noise: 0.4,
  }),
  reload: Object.freeze({
    baseFreq: 1200,
    durationMs: 70,
    kind: "tone",
    wave: "square",
    noise: 0.1,
  }),
  dryfire: Object.freeze({
    baseFreq: 2000,
    durationMs: 40,
    kind: "tone",
    wave: "square",
    noise: 0.05,
  }),
  bounce: Object.freeze({
    baseFreq: 300,
    durationMs: 90,
    kind: "tone",
    wave: "sine",
    noise: 0.1,
  }),
  explosion: Object.freeze({
    baseFreq: 110,
    durationMs: 600,
    kind: "mix",
    wave: "sine",
    slideTo: 30,
    noise: 0.6,
  }),
} as Record<SfxName, SfxPreset>);

/** Weapon families in probe order. */
export const SFX_WEAPONS: readonly SfxWeaponFamily[] = Object.freeze([
  "pistol",
  "smg",
  "rifle",
  "shotgun",
  "sniper",
  "rocket",
]);

/**
 * Tolerantly resolve a shot voice: weapon ids map case-insensitively,
 * anything unknown falls back to the pistol preset (the
 * parseTier/parseMap tolerance idiom from setup.ts).
 */
export function describeShot(weapon: string): SfxPreset {
  const key = weapon.toLowerCase();
  const table = SFX_PRESETS as unknown as Record<string, SfxPreset>;
  const preset = table[key];
  if (preset !== undefined) {
    return preset;
  }
  return SFX_PRESETS.pistol;
}

/** Base frequency for a shot voice (unknown weapons use pistol's). */
export function weaponBaseFreq(weapon: string): number {
  return describeShot(weapon).baseFreq;
}
