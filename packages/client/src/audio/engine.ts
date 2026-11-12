// Lazy WebAudio SFX engine: owns the AudioContext singleton, the master
// gain, the shared white-noise buffer, and the window.__audio probe mirror.
//
// Autoplay guard by construction: no AudioContext exists until
// ensureAudioOnGesture() runs inside a user-gesture call stack
// (main.ts calls it from startMatch plus one-shot gesture listeners).
// Every play* entry no-ops while the context is null, so pre-gesture
// frames stay silent and uncreated. No DOM is touched at module import
// time; the context factory is injectable for node tests.

import { describeShot } from "./sfx";

/** Probe-mirror entry: one synthesized play event. */
export interface LastPlayedEntry {
  name: string;
  baseFreq: number;
  at: number;
}

/** Mirror keeps the newest plays only. */
const LAST_PLAYED_CAP = 16;
/** Dry-fire clicks throttle to one play per window (held trigger). */
const DRY_FIRE_THROTTLE_MS = 150;
/** First-visit master volume (mirrors DEFAULT_VOLUME in settings.ts). */
const FALLBACK_VOLUME = 0.8;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let factoryOverride: (() => AudioContext | null) | null = null;
let currentVolume = FALLBACK_VOLUME;
let lastDryFireAt = -Infinity;

/** Inject the AudioContext factory (tests); null restores the default. */
export function setAudioContextFactory(
  factory: (() => AudioContext | null) | null,
): void {
  factoryOverride = factory;
}

/** Drop all module state (tests only). */
export function resetAudioForTests(): void {
  ctx = null;
  master = null;
  noiseBuf = null;
  factoryOverride = null;
  currentVolume = FALLBACK_VOLUME;
  lastDryFireAt = -Infinity;
}

/** The lazily created context, or null before the first gesture. */
export function getAudioContext(): AudioContext | null {
  return ctx;
}

/** Current master volume in [0, 1]. */
export function getVolume(): number {
  return currentVolume;
}

/** Null-safe window surface (node tests run without a DOM window). */
function probeWindow(): Window | undefined {
  if (typeof window !== "undefined") {
    return window;
  }
  const holder = globalThis as unknown as { window?: Window };
  const candidate = holder.window;
  if (candidate !== undefined && typeof candidate === "object") {
    return candidate;
  }
  return undefined;
}

/** Monotonic clock: performance under browsers, Date under node fakes. */
function nowMs(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

/** parseVolume-style clamp without importing DOM. */
function clampVolume(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    if (value.trim() === "") {
      return FALLBACK_VOLUME;
    }
    n = Number(value);
  } else {
    return FALLBACK_VOLUME;
  }
  if (!Number.isFinite(n)) {
    return FALLBACK_VOLUME;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

/** Build the shared 1 s white-noise buffer once per context. */
function buildNoiseBuffer(ac: AudioContext): AudioBuffer | null {
  try {
    const length = Math.max(1, Math.floor(ac.sampleRate));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Create (inside the call stack, so the gesture unlocks autoplay) or
 * resume the shared context. Safe to call from any gesture handler;
 * returns null when no WebAudio constructor exists.
 */
export function ensureAudioOnGesture(): AudioContext | null {
  if (ctx !== null) {
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  }
  const created = factoryOverride !== null ? factoryOverride() : defaultCreate();
  if (created === null || created === undefined) {
    return null;
  }
  ctx = created;
  master = ctx.createGain();
  master.gain.value = currentVolume;
  master.connect(ctx.destination);
  noiseBuf = buildNoiseBuffer(ctx);
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

/** Default factory: construct through the page's AudioContext. */
function defaultCreate(): AudioContext | null {
  const w = probeWindow();
  if (w === undefined) {
    return null;
  }
  const record = w as unknown as Record<string, unknown>;
  const ctor = (record["AudioContext"] ??
    record["webkitAudioContext"]) as unknown as
    | (new () => AudioContext)
    | undefined;
  if (ctor === undefined || typeof ctor !== "function") {
    return null;
  }
  try {
    return new ctor();
  } catch {
    return null;
  }
}

/**
 * Apply the master volume (slider at 0 mutes SFX via gain 0 instead of
 * suspending the context). Pre-gesture safe: stored until ensure runs.
 */
export function setVolume(value: number): void {
  currentVolume = clampVolume(value);
  if (master !== null && ctx !== null) {
    master.gain.setValueAtTime(currentVolume, ctx.currentTime);
  }
}

/** Append one entry to the capped window.__audio.lastPlayed mirror. */
function mirrorPlay(name: string, baseFreq: number): void {
  const w = probeWindow();
  if (w === undefined) {
    return;
  }
  if (w.__audio === undefined) {
    w.__audio = { lastPlayed: [] };
  }
  w.__audio.lastPlayed.push({ name, baseFreq, at: nowMs() });
  while (w.__audio.lastPlayed.length > LAST_PLAYED_CAP) {
    w.__audio.lastPlayed.shift();
  }
}

/**
 * One synthesized voice: an OscillatorNode tone body plus an
 * AudioBufferSourceNode noise transient through per-play gain
 * envelopes into the mono master bus, then the probe mirror upkeep.
 */
function emit(
  name: string,
  baseFreq: number,
  durationMs: number,
  wave: OscillatorType,
  slideTo: number | undefined,
  noiseLevel: number,
): void {
  if (ctx === null || master === null) {
    return;
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  const t = ctx.currentTime;
  const dur = Math.max(0.02, durationMs / 1000);
  const osc = ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(Math.max(20, baseFreq), t);
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  }
  const toneGain = ctx.createGain();
  toneGain.gain.setValueAtTime(0.9, t);
  toneGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(toneGain);
  toneGain.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  if (noiseBuf !== null && noiseLevel > 0) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const transient = ctx.createGain();
    const hiss = Math.min(dur, 0.25);
    transient.gain.setValueAtTime(noiseLevel, t);
    transient.gain.exponentialRampToValueAtTime(0.001, t + hiss);
    src.connect(transient);
    transient.connect(master);
    src.start(t);
    src.stop(t + hiss + 0.02);
  }
  mirrorPlay(name, baseFreq);
}

/** Group drained shot details into one weapon per firing shooter. */
export function groupShotWeapons(
  details: ReadonlyArray<{ shooter: number; weapon: string }>,
): string[] {
  const seen = new Set<number>();
  const weapons: string[] = [];
  for (const detail of details) {
    if (!seen.has(detail.shooter)) {
      seen.add(detail.shooter);
      weapons.push(detail.weapon);
    }
  }
  return weapons;
}

/** Synthesized shot for a weapon family (unknown ids use pistol). */
export function playShot(weapon: string): void {
  if (ctx === null) {
    return;
  }
  const preset = describeShot(weapon);
  emit(
    `shot:${weapon.toLowerCase()}`,
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.25,
  );
}

/** Short high blip when a reload starts. */
export function playReload(): void {
  if (ctx === null) {
    return;
  }
  emit("reload", 1200, 70, "square", undefined, 0.1);
}

/** Empty-click when firing on an empty magazine (throttled). */
export function playDryFire(): void {
  if (ctx === null) {
    return;
  }
  const t = nowMs();
  if (t - lastDryFireAt < DRY_FIRE_THROTTLE_MS) {
    return;
  }
  lastDryFireAt = t;
  emit("dryfire", 2000, 40, "square", undefined, 0.05);
}

/** Low blip for a grenade bounce. */
export function playBounce(): void {
  if (ctx === null) {
    return;
  }
  emit("bounce", 300, 90, "sine", undefined, 0.1);
}

/** Noise burst plus a 110→30 Hz sine drop for explosions. */
export function playExplosion(): void {
  if (ctx === null) {
    return;
  }
  const preset = describeShot("explosion");
  emit(
    "explosion",
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.6,
  );
}
