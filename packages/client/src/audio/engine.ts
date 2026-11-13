// Lazy WebAudio SFX engine: owns the AudioContext singleton, the master
// gain, the shared white-noise buffer, and the window.__audio probe mirror.
//
// Autoplay guard by construction: no AudioContext exists until
// ensureAudioOnGesture() runs inside a user-gesture call stack
// (main.ts calls it from startMatch plus one-shot gesture listeners).
// Every play* entry no-ops while the context is null, so pre-gesture
// frames stay silent and uncreated. No DOM is touched at module import
// time; the context factory is injectable for node tests.

import { SFX_PRESETS, describeShot } from "./sfx";

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
let analyser: AnalyserNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let jetGain: GainNode | null = null;
let jetSource: AudioBufferSourceNode | null = null;
let currentJetLevel = 0;
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
  analyser = null;
  noiseBuf = null;
  jetGain = null;
  jetSource = null;
  currentJetLevel = 0;
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
  // Post-master analyser tap: sources (and the jet loop) feed master,
  // master feeds the analyser, the analyser feeds the destination, so a
  // master gain of 0 mutes the tap all the way to silence.
  let chained = false;
  try {
    analyser = ctx.createAnalyser();
    master.connect(analyser);
    analyser.connect(ctx.destination);
    chained = true;
  } catch {
    analyser = null;
  }
  if (!chained) {
    try {
      master.connect(ctx.destination);
    } catch {
      // Headless fakes may reject connects; the mirror still works.
    }
  }
  noiseBuf = buildNoiseBuffer(ctx);
  startJetLoop();
  syncAudioMirror();
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
    // Direct assignment first so node-test fakes observe the mute;
    // the scheduled event keeps real AudioParams exact.
    try {
      master.gain.value = currentVolume;
    } catch {
      // Read-only params (strict fakes): the event below still applies.
    }
    try {
      master.gain.setValueAtTime(currentVolume, ctx.currentTime);
    } catch {
      // No-op params on minimal fakes: value above already applied.
    }
  }
}

/** Publish the analyser tap and jet level onto the probe mirror. */
function syncAudioMirror(): void {
  const w = probeWindow();
  if (w === undefined) {
    return;
  }
  if (w.__audio === undefined) {
    w.__audio = { lastPlayed: [] };
  }
  w.__audio.analyser = analyser ?? undefined;
  w.__audio.jetGain = currentJetLevel;
}

/** The post-master analyser tap, or null before the first gesture. */
export function getAnalyser(): AnalyserNode | null {
  return analyser;
}

/** Current jet-loop level (the mirrored target gain). */
export function getJetGain(): number {
  if (jetGain !== null) {
    try {
      return jetGain.gain.value;
    } catch {
      // Unreadable params on strict fakes: fall back to the target.
    }
  }
  return currentJetLevel;
}

/** Start the persistent looping jet-noise voice through the master bus. */
function startJetLoop(): void {
  if (ctx === null || master === null || noiseBuf === null) {
    return;
  }
  try {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    try {
      src.loop = true;
    } catch {
      // Minimal fakes without loop support still drone via the buffer.
    }
    jetGain = gain;
    jetSource = src;
    currentJetLevel = 0;
    try {
      src.start(0);
    } catch {
      try {
        src.start();
      } catch {
        // Headless fakes may reject start; the gain path still mirrors.
      }
    }
  } catch {
    jetGain = null;
    jetSource = null;
  }
}

/** Jet-loop envelope target: audible while jetting, silent at rest. */
const JET_ACTIVE_BASE = 0.12;
/** Fuel-scaled headroom on top of the base jet level. */
const JET_ACTIVE_FUEL = 0.12;
/** Release decay time-constant (~60 ms: silent well within 300 ms). */
const JET_TAU_SECONDS = 0.06;

/**
 * Follow the local player's jetting state: while active the loop gain
 * rides at 0.12 + 0.12 * fuelRatio (> 0.1), at rest it decays toward 0
 * with a 60 ms time-constant (< 0.02 within 300 ms). Pre-gesture safe:
 * without a context the call is a silent no-op (stepOnce only runs
 * post-gesture, and the fresh loop starts at 0 on ensure).
 */
export function setJetting(active: boolean, fuelRatio = 1): void {
  if (ctx === null || jetGain === null) {
    return;
  }
  let ratio = fuelRatio;
  if (!Number.isFinite(ratio)) {
    ratio = active ? 1 : 0;
  }
  ratio = Math.min(1, Math.max(0, ratio));
  const target = active ? JET_ACTIVE_BASE + JET_ACTIVE_FUEL * ratio : 0;
  currentJetLevel = target;
  syncAudioMirror();
  const param = jetGain.gain;
  try {
    const schedule = param.setTargetAtTime;
    if (typeof schedule === "function") {
      schedule.call(param, target, ctx.currentTime, JET_TAU_SECONDS);
      return;
    }
  } catch {
    // Unschedulable params fall through to the direct assignment.
  }
  try {
    param.value = target;
  } catch {
    // Read-only params: the mirror target still carries the probe.
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
  syncAudioMirror();
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

/** Short up-chirp for a hop (rising edge while grounded). */
export function playHop(): void {
  if (ctx === null) {
    return;
  }
  const preset = SFX_PRESETS.hop;
  emit(
    "hop",
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.1,
  );
}

/** Low thud for landing. */
export function playLand(): void {
  if (ctx === null) {
    return;
  }
  const preset = SFX_PRESETS.land;
  emit(
    "land",
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.1,
  );
}

/** Low saw drop when the local player takes damage. */
export function playGrunt(): void {
  if (ctx === null) {
    return;
  }
  const preset = SFX_PRESETS.grunt;
  emit(
    "grunt",
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.15,
  );
}

/** Short high blip confirming a local-player kill. */
export function playKill(): void {
  if (ctx === null) {
    return;
  }
  const preset = SFX_PRESETS.kill;
  emit(
    "kill",
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.08,
  );
}

/** Mid-band chime for a collected pickup (990 Hz sits in 600-1200). */
export function playPickup(): void {
  if (ctx === null) {
    return;
  }
  const preset = SFX_PRESETS.pickup;
  emit(
    "pickup",
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.05,
  );
}

/** Ascending slide when the match starts (post-gesture). */
export function playMatchStart(): void {
  if (ctx === null) {
    return;
  }
  const preset = SFX_PRESETS.matchStart;
  emit(
    "matchStart",
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.1,
  );
}

/** Descending slide when the match ends. */
export function playMatchEnd(): void {
  if (ctx === null) {
    return;
  }
  const preset = SFX_PRESETS.matchEnd;
  emit(
    "matchEnd",
    preset.baseFreq,
    preset.durationMs,
    preset.wave,
    preset.slideTo,
    preset.noise ?? 0.1,
  );
}
