// Generative synthesized soundtrack: menu calm pad+pluck, match driving
// bass+hats rising with tension, and a match-end stinger — 100%
// synthesized WebAudio (oscillators + filtered noise), zero audio files,
// CC0-clean by construction (no samples, no assets, no network).
//
// The module never constructs an AudioContext directly: it reuses the
// single lazily-created context owned by ./engine.ts (getAudioContext)
// and routes a dedicated music bus through the shared master gain
// (getMasterGain), so the master slider, the analyser tap, and the
// single-context `suspended`-before-gesture contract keep working.
// Every entry is pre-gesture safe: with no context/master the call is a
// silent no-op that retains the pending mode, started on the next
// gesture/resume (the engine autoplay-guard idiom).
//
// Pitch tables are frozen data plus DOM-free helpers (the SFX_PRESETS
// idiom from ./sfx.ts): they import cleanly under node for unit tests.
// All DOM/window access sits behind null-safe probes.

import { getAudioContext, getMasterGain } from "./engine";

/** Soundtrack mode mirrored onto window.__audio.musicMode. */
export type MusicMode = "menu" | "match" | "stopped";

/** First-visit (and corrupt-storage) default music volume. */
export const DEFAULT_MUSIC_VOLUME = 0.7;

/** Lookahead scheduler cadence in ms (schedules ~250 ms ahead). */
const SCHEDULER_INTERVAL_MS = 120;
/** Seconds of audio scheduled ahead of the playhead per tick. */
const SCHEDULER_HORIZON_S = 0.3;
/** Menu pulse: slow 72 BPM 16ths. */
const MENU_STEP_S = 60 / 72 / 4;
/** Match pulse: driving 132 BPM 16ths. */
const MATCH_STEP_S = 60 / 132 / 4;
/** Cap on tracked live voices (bounds the probe mirror). */
const VOICE_CAP = 64;
/** Expected sim ticks per kill feeding the pace term of tension. */
const EXPECTED_TICKS_PER_POINT = 600;

/** Menu pluck voice: A-minor pentatonic semitone offsets from 220 Hz. */
export const MENU_PENTA: readonly number[] = Object.freeze([0, 2, 4, 7, 9]);
/** Menu pad root in Hz (A3). */
export const MENU_ROOT_HZ = 220;
/** Menu pad progression: one chord root (semitones) per 16-step bar. */
export const MENU_CHORDS: readonly number[] = Object.freeze([0, -4, -2, -5]);
/** Match bass root in Hz (A1). */
export const MATCH_ROOT_HZ = 55;
/**
 * Match bass line: semitone offsets per 16-step bar (-1 = rest). Minor
 * drive with the fifth lift on the bar turn.
 */
export const MATCH_BASS: readonly number[] = Object.freeze([
  0, -1, 0, 0, -1, 3, -1, 0, 0, -1, 0, 5, -1, 3, 2, -1,
]);
/** Match-end stinger: rising major arp semitones from 440 Hz. */
export const STINGER_ARP: readonly number[] = Object.freeze([0, 4, 7, 12]);
/** Stinger root in Hz (A4). */
export const STINGER_ROOT_HZ = 440;

/**
 * Deterministic seeded PRNG (mulberry32): the same seed replays the
 * same generative sequence, so menu/match loops are reproducible and
 * unit-testable without timers.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp an unknown value into the 0-1 music volume range. */
function clampMusicVolume(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    if (value.trim() === "") {
      return DEFAULT_MUSIC_VOLUME;
    }
    n = Number(value);
  } else {
    return DEFAULT_MUSIC_VOLUME;
  }
  if (!Number.isFinite(n)) {
    return DEFAULT_MUSIC_VOLUME;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

/**
 * Pure tension helper: 0-1 match intensity from sim progress. Blends
 * the elapsed-time fraction with the top-score fraction so the drive
 * rises toward either the time cap or a runaway leader (the exact
 * curve is an implementer choice; clamped 0-1, NaN-safe).
 */
export function musicTensionFor(
  tick: number,
  scoreLimit: number,
  timeLimit: number,
  topScore = 0,
): number {
  const timeFrac =
    Number.isFinite(tick) && Number.isFinite(timeLimit) && timeLimit > 0
      ? tick / timeLimit
      : 0;
  const scoreFrac =
    Number.isFinite(topScore) && Number.isFinite(scoreLimit) && scoreLimit > 0
      ? topScore / scoreLimit
      : 0;
  const paceFrac =
    Number.isFinite(tick) && Number.isFinite(scoreLimit) && scoreLimit > 0
      ? tick / (scoreLimit * EXPECTED_TICKS_PER_POINT)
      : 0;
  const tension = Math.max(timeFrac, scoreFrac, paceFrac);
  if (!Number.isFinite(tension)) {
    return 0;
  }
  return Math.min(1, Math.max(0, tension));
}

/**
 * Pure generative preview: sparse pentatonic pluck offsets for `count`
 * 8th-note slots from a seed (-1 = rest). Same seed replays the same
 * rhythm and pitches.
 */
export function menuPluckSequence(seed: number, count: number): number[] {
  const rand = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (rand() < 0.35) {
      out.push(MENU_PENTA[Math.floor(rand() * MENU_PENTA.length)] ?? 0);
    } else {
      out.push(-1);
    }
  }
  return out;
}

/**
 * Pure generative preview: match bass offsets per step from a seed
 * (null = rest). Higher tension raises the play density.
 */
export function matchBassSequence(
  seed: number,
  steps: number,
  tension: number,
): (number | null)[] {
  const rand = mulberry32(seed);
  const clamped = Math.min(1, Math.max(0, tension));
  const density = 0.55 + 0.45 * clamped;
  const out: (number | null)[] = [];
  for (let i = 0; i < steps; i += 1) {
    const voice = MATCH_BASS[i % MATCH_BASS.length] ?? -1;
    if (voice < 0) {
      out.push(null);
    } else if (rand() < density) {
      out.push(voice);
    } else {
      out.push(null);
    }
  }
  return out;
}

/** Live voiced-voice end times (seconds on the shared context clock). */
let voices: { end: number }[] = [];
let mode: MusicMode = "stopped";
let tension = 0;
let musicVolume = DEFAULT_MUSIC_VOLUME;
let musicSeed = 0x5c3a;
let rand: () => number = mulberry32(musicSeed);
let musicGain: GainNode | null = null;
let bassFilter: BiquadFilterNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let noiseOwner: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextNoteTime = 0;
let stepIndex = 0;

/** Null-safe window surface (node tests run without a DOM window). */
function probeWindow(): { __audio?: Record<string, unknown> } | undefined {
  if (typeof window !== "undefined") {
    return window as unknown as { __audio?: Record<string, unknown> };
  }
  const holder = globalThis as unknown as { window?: unknown };
  const candidate = holder.window;
  if (candidate !== undefined && typeof candidate === "object") {
    return candidate as { __audio?: Record<string, unknown> };
  }
  return undefined;
}

/** Semitone offset to Hz from a root (equal temperament). */
function semisToHz(rootHz: number, semis: number): number {
  return rootHz * Math.pow(2, semis / 12);
}

/** Build (once per context) the shared 1 s white-noise buffer. */
function noiseFor(ac: AudioContext): AudioBuffer | null {
  if (noiseBuf !== null && noiseOwner === ac) {
    return noiseBuf;
  }
  try {
    const length = Math.max(1, Math.floor(ac.sampleRate));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    noiseBuf = buffer;
    noiseOwner = ac;
    return buffer;
  } catch {
    return null;
  }
}

/** Create the music bus under master once per context (idempotent). */
function ensureBus(ac: AudioContext, master: GainNode): GainNode | null {
  if (musicGain !== null) {
    return musicGain;
  }
  try {
    const bus = ac.createGain();
    bus.gain.value = musicVolume;
    try {
      bus.connect(master);
    } catch {
      // Headless fakes may reject connects; the mirror still advances.
    }
    musicGain = bus;
    // Brightness morph for the match bass: a shared lowpass whose
    // cutoff rides tension. Minimal fakes without BiquadFilter fall
    // through to the direct path below (silent-no-throw by contract).
    try {
      const filter = ac.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = bassCutoffFor(tension);
      filter.connect(bus);
      bassFilter = filter;
    } catch {
      bassFilter = null;
    }
    noiseFor(ac);
    return bus;
  } catch {
    return null;
  }
}

/** Bass lowpass cutoff in Hz: 400 Hz calm, opening to 3.2 kHz driven. */
function bassCutoffFor(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 400 * Math.pow(8, clamped);
}

/** Record one live voice; prunes ended voices and caps the mirror. */
function trackVoice(end: number): void {
  voices.push({ end });
  while (voices.length > VOICE_CAP) {
    voices.shift();
  }
}

/** Drop voices ended at or before `now` on the context clock. */
function pruneVoices(now: number): void {
  if (!Number.isFinite(now)) {
    return;
  }
  voices = voices.filter((voice) => voice.end > now);
  while (voices.length > VOICE_CAP) {
    voices.shift();
  }
}

/** Apply the stored music volume to the live bus (mute = gain 0). */
function applyVolume(ac: AudioContext): void {
  if (musicGain === null) {
    return;
  }
  try {
    musicGain.gain.value = musicVolume;
  } catch {
    // Read-only params on strict fakes: the event below still applies.
  }
  try {
    musicGain.gain.setValueAtTime(musicVolume, ac.currentTime);
  } catch {
    // No-op params on minimal fakes: value above already applied.
  }
}

/** One enveloped oscillator tone through the music bus. */
function scheduleTone(
  ac: AudioContext,
  bus: GainNode,
  opts: {
    freq: number;
    at: number;
    dur: number;
    wave: OscillatorType;
    level: number;
  },
): void {
  try {
    const osc = ac.createOscillator();
    osc.type = opts.wave;
    osc.frequency.setValueAtTime(Math.max(20, opts.freq), opts.at);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(opts.level, opts.at);
    gain.gain.exponentialRampToValueAtTime(0.001, opts.at + opts.dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(opts.at);
    osc.stop(opts.at + opts.dur + 0.02);
    trackVoice(opts.at + opts.dur + 0.02);
  } catch {
    // Unschedulable fakes: the mirror simply shows fewer voices.
  }
}

/** One short noise-transient hat through the music bus. */
function scheduleHat(
  ac: AudioContext,
  bus: GainNode,
  at: number,
  level: number,
): void {
  const buffer = noiseFor(ac);
  if (buffer === null) {
    return;
  }
  try {
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    src.connect(gain);
    gain.connect(bus);
    src.start(at);
    src.stop(at + 0.07);
    trackVoice(at + 0.07);
  } catch {
    // Unschedulable fakes: the mirror simply shows fewer voices.
  }
}

/** Schedule one 16th step for the current mode at time `at`. */
function scheduleStep(ac: AudioContext, bus: GainNode, index: number, at: number): void {
  if (mode === "menu") {
    // Pad: one chord per 16-step bar, three detuned triangles/sines.
    if (index % 16 === 0) {
      const bar = Math.floor(index / 16);
      const root = MENU_CHORDS[bar % MENU_CHORDS.length] ?? 0;
      const chord: Array<{ semis: number; wave: OscillatorType }> = [
        { semis: root, wave: "triangle" },
        { semis: root + 7, wave: "sine" },
        { semis: root + 12, wave: "sine" },
      ];
      for (const voice of chord) {
        scheduleTone(ac, bus, {
          freq: semisToHz(MENU_ROOT_HZ, voice.semis),
          at,
          dur: MENU_STEP_S * 16,
          wave: voice.wave,
          level: 0.08,
        });
      }
    }
    // Pluck: sparse pentatonic on even 8ths.
    if (index % 2 === 0 && rand() < 0.35) {
      const semis = MENU_PENTA[Math.floor(rand() * MENU_PENTA.length)] ?? 0;
      scheduleTone(ac, bus, {
        freq: semisToHz(MENU_ROOT_HZ * 2, semis),
        at,
        dur: 0.35,
        wave: "triangle",
        level: 0.12,
      });
    }
    return;
  }
  if (mode === "match") {
    const density = 0.55 + 0.45 * tension;
    const voice = MATCH_BASS[index % MATCH_BASS.length] ?? -1;
    if (voice >= 0 && rand() < density) {
      const target = bassFilter ?? bus;
      // Octave lift on the bar turn as tension peaks (brightness morph
      // alongside the lowpass cutoff below).
      const lift = tension > 0.7 && index % 16 >= 12 ? 12 : 0;
      try {
        const osc = ac.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(
          Math.max(20, semisToHz(MATCH_ROOT_HZ, voice + lift)),
          at,
        );
        const gain = ac.createGain();
        gain.gain.setValueAtTime(0.16, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + MATCH_STEP_S);
        osc.connect(gain);
        gain.connect(target);
        osc.start(at);
        osc.stop(at + MATCH_STEP_S + 0.02);
        trackVoice(at + MATCH_STEP_S + 0.02);
      } catch {
        // Unschedulable fakes: the mirror simply shows fewer voices.
      }
    }
    // Four-on-the-floor soft kick while tension runs hot.
    if (tension > 0.4 && index % 4 === 0) {
      scheduleTone(ac, bus, {
        freq: 60,
        at,
        dur: 0.12,
        wave: "sine",
        level: 0.1 + 0.1 * tension,
      });
    }
    // Offbeat hats: probability and level ride tension.
    if (index % 2 === 1 && rand() < 0.25 + 0.55 * tension) {
      scheduleHat(ac, bus, at, 0.05 + 0.09 * tension);
    }
    // Ride the bass brightness with tension (guarded for fakes).
    if (bassFilter !== null) {
      try {
        bassFilter.frequency.setValueAtTime(bassCutoffFor(tension), at);
      } catch {
        // Read-only params: the density morph still carries the probe.
      }
    }
  }
}

/** Run one lookahead pass: schedule every 16th inside the horizon. */
function schedulerTick(): void {
  const ac = getAudioContext();
  const master = getMasterGain();
  if (ac === null || master === null || musicGain === null) {
    return;
  }
  if (mode === "stopped") {
    return;
  }
  if (ac.state === "suspended") {
    try {
      void ac.resume();
    } catch {
      // Resume rejections: the next gesture tick retries.
    }
  }
  const bus = musicGain;
  const step = mode === "match" ? MATCH_STEP_S : MENU_STEP_S;
  const horizon = ac.currentTime + SCHEDULER_HORIZON_S;
  let guard = 0;
  while (nextNoteTime < horizon && guard < 64) {
    scheduleStep(ac, bus, stepIndex, nextNoteTime);
    nextNoteTime += step;
    stepIndex += 1;
    guard += 1;
  }
  pruneVoices(ac.currentTime);
  syncMusicMirror();
}

/** Stop the lookahead timer without touching the mirror mode. */
function stopTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Shared start path: retain the pending mode, schedule when unlocked. */
function startMusic(next: Exclude<MusicMode, "stopped">): void {
  mode = next;
  const ac = getAudioContext();
  const master = getMasterGain();
  if (ac === null || master === null) {
    // Pre-gesture: retain the pending mode, schedule on the next
    // gesture's start call (the engine autoplay-guard idiom).
    syncMusicMirror();
    return;
  }
  if (ac.state === "suspended") {
    try {
      void ac.resume();
    } catch {
      // Resume rejections: the next gesture tick retries.
    }
  }
  const bus = ensureBus(ac, master);
  if (bus === null) {
    syncMusicMirror();
    return;
  }
  applyVolume(ac);
  stopTimer();
  rand = mulberry32(musicSeed);
  stepIndex = 0;
  nextNoteTime = ac.currentTime + 0.05;
  // Schedule the opening bar synchronously so the probe mirror shows
  // live voices (>= 2) on the same gesture task, before the first
  // interval tick fires.
  const step = next === "match" ? MATCH_STEP_S : MENU_STEP_S;
  let guard = 0;
  while (nextNoteTime < ac.currentTime + SCHEDULER_HORIZON_S && guard < 64) {
    scheduleStep(ac, bus, stepIndex, nextNoteTime);
    nextNoteTime += step;
    stepIndex += 1;
    guard += 1;
  }
  pruneVoices(ac.currentTime);
  try {
    timer = setInterval(schedulerTick, SCHEDULER_INTERVAL_MS);
  } catch {
    timer = null;
  }
  syncMusicMirror();
}

/** Start the calm menu loop (pad + sparse pluck). Pre-gesture safe. */
export function startMenuMusic(): void {
  startMusic("menu");
}

/** Start the driving match loop (bass + hats, tension-morphed). Pre-gesture safe. */
export function startMatchMusic(): void {
  startMusic("match");
}

/** Stop all generative scheduling; the bus stays for the next start. */
export function stopMusic(): void {
  stopTimer();
  mode = "stopped";
  voices = [];
  syncMusicMirror();
}

/** Current soundtrack mode (pending mode retained pre-gesture). */
export function getMusicMode(): MusicMode {
  return mode;
}

/** Current tension in [0, 1]. */
export function getMusicTension(): number {
  return tension;
}

/**
 * Set the match intensity in [0, 1]: clamps, rides the bass lowpass
 * cutoff live, and publishes to the mirror. Pre-gesture safe.
 */
export function setTension01(value: number): void {
  let t = Number(value);
  if (!Number.isFinite(t)) {
    t = 0;
  }
  tension = Math.min(1, Math.max(0, t));
  const ac = getAudioContext();
  if (ac !== null && bassFilter !== null) {
    try {
      bassFilter.frequency.setValueAtTime(
        bassCutoffFor(tension),
        ac.currentTime,
      );
    } catch {
      // Read-only params: the mirror still carries the tension.
    }
  }
  syncMusicMirror();
}

/** Current music volume in [0, 1]. */
export function getMusicVolume(): number {
  return musicVolume;
}

/**
 * Apply the music volume (slider at 0 silences the bus via gain 0 but
 * never suspends the context). Pre-gesture safe: stored until start.
 */
export function setMusicVolume(value: number): void {
  musicVolume = clampMusicVolume(value);
  const ac = getAudioContext();
  if (ac !== null) {
    applyVolume(ac);
  }
}

/** Reseed the generative PRNG (tests + deterministic replays). */
export function setMusicSeed(seed: number): void {
  musicSeed = Number.isFinite(seed) ? seed : 0x5c3a;
}

/**
 * One-shot match-end stinger: rising major arp plus a noise swell.
 * Pre-gesture safe (silent no-op without a context).
 */
export function playEndStinger(): void {
  const ac = getAudioContext();
  const master = getMasterGain();
  if (ac === null || master === null) {
    return;
  }
  if (ac.state === "suspended") {
    try {
      void ac.resume();
    } catch {
      // Resume rejections: the gesture already unlocked the context.
    }
  }
  const bus = ensureBus(ac, master);
  if (bus === null) {
    return;
  }
  const t = ac.currentTime + 0.02;
  STINGER_ARP.forEach((semis, i) => {
    scheduleTone(ac, bus, {
      freq: semisToHz(STINGER_ROOT_HZ, semis),
      at: t + i * 0.12,
      dur: 0.5,
      wave: "triangle",
      level: 0.16,
    });
  });
  scheduleHat(ac, bus, t, 0.1);
  pruneVoices(ac.currentTime);
  syncMusicMirror();
}

/** Publish mode, live voice count, and tension onto the probe mirror. */
export function syncMusicMirror(): void {
  const w = probeWindow();
  if (w === undefined) {
    return;
  }
  if (w.__audio === undefined) {
    w.__audio = { lastPlayed: [] };
  }
  const ac = getAudioContext();
  pruneVoices(ac !== null ? ac.currentTime : NaN);
  w.__audio["musicMode"] = mode;
  w.__audio["musicNodes"] = voices.length;
  w.__audio["musicTension"] = tension;
}

/**
 * Run one lookahead pass synchronously (tests only): lets node tests
 * advance the generative scheduler without waiting on timers.
 */
export function stepMusicForTests(): void {
  schedulerTick();
}

/** Drop all module state and timers (tests only). */
export function resetMusicForTests(): void {
  stopTimer();
  voices = [];
  mode = "stopped";
  tension = 0;
  musicVolume = DEFAULT_MUSIC_VOLUME;
  musicSeed = 0x5c3a;
  rand = mulberry32(musicSeed);
  musicGain = null;
  bassFilter = null;
  noiseBuf = null;
  noiseOwner = null;
  nextNoteTime = 0;
  stepIndex = 0;
}
