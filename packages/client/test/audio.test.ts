// Audio SFX tests: preset distinctness, lazy autoplay-guarded init,
// lastPlayed mirror behavior, shot grouping, and the zero-asset-dir
// assertion. Mirrors packages/client/test/settings.test.ts (small local
// builders, behavior assertions, no padding, no DOM needed).
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SFX_PRESETS,
  SFX_WEAPONS,
  describeShot,
  weaponBaseFreq,
} from "../src/audio/sfx";
import {
  ensureAudioOnGesture,
  getAnalyser,
  getAudioContext,
  getJetGain,
  getVolume,
  groupShotWeapons,
  playBounce,
  playDryFire,
  playExplosion,
  playGrunt,
  playHop,
  playKill,
  playLand,
  playMatchEnd,
  playMatchStart,
  playPickup,
  playReload,
  playShot,
  resetAudioForTests,
  setAudioContextFactory,
  setJetting,
  setVolume,
} from "../src/audio/engine";

/** Recording stand-in for a GainNode with a live value. */
interface FakeGainNode {
  gain: {
    value: number;
    setValueAtTime(v: number, t: number): void;
    setTargetAtTime(v: number, t: number, tau: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
  };
  connections: unknown[];
  connect(target: unknown): void;
}

function fakeGain(created: string[], gains: FakeGainNode[]): FakeGainNode {
  const node: FakeGainNode = {
    gain: {
      value: 1,
      setValueAtTime(v: number): void {
        node.gain.value = v;
      },
      setTargetAtTime(v: number): void {
        // Synchronous target: mirrors the settled exponential envelope
        // (release tau 60 ms settles well within the 300 ms window).
        node.gain.value = v;
      },
      exponentialRampToValueAtTime(v: number): void {
        node.gain.value = v;
      },
    },
    connections: [],
    connect(target: unknown): void {
      node.connections.push(target);
    },
  };
  created.push("gain");
  gains.push(node);
  return node;
}

/** Recording stand-in for an AnalyserNode. */
interface FakeAnalyserNode {
  connections: unknown[];
  connect(target: unknown): void;
  getFloatTimeDomainData(array: Float32Array): void;
}

function fakeAnalyser(
  created: string[],
  analysers: FakeAnalyserNode[],
): FakeAnalyserNode {
  const node: FakeAnalyserNode = {
    connections: [],
    connect(target: unknown): void {
      node.connections.push(target);
    },
    getFloatTimeDomainData(): void {},
  };
  created.push("analyser");
  analysers.push(node);
  return node;
}

/** Recording stand-in for an OscillatorNode. */
function fakeOsc(created: string[]): {
  type: string;
  frequency: {
    setValueAtTime(v: number, t: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
  };
  connect(target: unknown): void;
  start(t?: number): void;
  stop(t?: number): void;
} {
  created.push("oscillator");
  return {
    type: "",
    frequency: {
      setValueAtTime(): void {},
      exponentialRampToValueAtTime(): void {},
    },
    connect(): void {},
    start(): void {},
    stop(): void {},
  };
}

/** Recording stand-in for an AudioBufferSourceNode. */
function fakeSource(created: string[]): {
  buffer: unknown;
  connect(target: unknown): void;
  start(t?: number): void;
  stop(t?: number): void;
} {
  created.push("buffer");
  return {
    buffer: null,
    connect(): void {},
    start(): void {},
    stop(): void {},
  };
}

/** Minimal AudioContext stand-in recording created node kinds. */
function fakeContext(): {
  instance: AudioContext;
  created: string[];
  gains: FakeGainNode[];
  analysers: FakeAnalyserNode[];
} {
  const created: string[] = [];
  const gains: FakeGainNode[] = [];
  const analysers: FakeAnalyserNode[] = [];
  const instance = {
    state: "running",
    sampleRate: 44100,
    currentTime: 0,
    destination: {},
    createOscillator: (): unknown => fakeOsc(created),
    createBufferSource: (): unknown => fakeSource(created),
    createGain: (): unknown => fakeGain(created, gains),
    createAnalyser: (): unknown => fakeAnalyser(created, analysers),
    createBuffer: (
      channels: number,
      length: number,
      rate: number,
    ): unknown => ({
      numberOfChannels: channels,
      length,
      sampleRate: rate,
      getChannelData: (): Float32Array => new Float32Array(length),
    }),
    resume: (): Promise<void> => Promise.resolve(),
  } as unknown as AudioContext;
  return { instance, created, gains, analysers };
}

/** Trackable factory: counts creations, returns the same fake. */
function trackedFactory(): {
  factory: () => AudioContext | null;
  calls: { count: number };
  created: string[];
  gains: FakeGainNode[];
  analysers: FakeAnalyserNode[];
  instance: AudioContext;
} {
  const fake = fakeContext();
  const calls = { count: 0 };
  return {
    factory: (): AudioContext | null => {
      calls.count += 1;
      return fake.instance;
    },
    calls,
    created: fake.created,
    gains: fake.gains,
    analysers: fake.analysers,
    instance: fake.instance,
  };
}

/** Fake bare window carrying only the audio probe mirror. */
function fakeWindow(): { __audio?: { lastPlayed: unknown[] } } {
  return {};
}

beforeEach(() => {
  resetAudioForTests();
  const holder = globalThis as unknown as { window?: unknown };
  holder.window = fakeWindow();
});

describe("SFX_PRESETS", () => {
  it("covers all six weapon families with distinct base frequencies", () => {
    expect(SFX_WEAPONS).toHaveLength(6);
    const freqs = SFX_WEAPONS.map((family) => SFX_PRESETS[family].baseFreq);
    expect(new Set(freqs).size).toBe(6);
  });

  it("matches the per-family frequency contract", () => {
    expect(weaponBaseFreq("pistol")).toBe(880);
    expect(weaponBaseFreq("smg")).toBe(660);
    expect(weaponBaseFreq("rifle")).toBe(520);
    expect(weaponBaseFreq("shotgun")).toBe(160);
    expect(weaponBaseFreq("sniper")).toBe(1400);
    expect(weaponBaseFreq("rocket")).toBe(90);
  });

  it("falls back to pistol for unknown weapons, case-insensitively", () => {
    expect(describeShot("banana")).toBe(SFX_PRESETS.pistol);
    expect(describeShot("")).toBe(SFX_PRESETS.pistol);
    expect(describeShot("Shotgun")).toBe(SFX_PRESETS.shotgun);
    expect(weaponBaseFreq("mystery")).toBe(SFX_PRESETS.pistol.baseFreq);
  });
});

describe("autoplay guard", () => {
  it("creates no context before the first gesture", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    expect(getAudioContext()).toBeNull();
    expect(tracked.calls.count).toBe(0);
  });

  it("play* entries are silent no-ops before ensure", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    playShot("pistol");
    playReload();
    playDryFire();
    playBounce();
    playExplosion();
    expect(tracked.calls.count).toBe(0);
    expect(tracked.created).toHaveLength(0);
    const w = (globalThis as unknown as { window: { __audio?: unknown } })
      .window;
    expect(w.__audio).toBeUndefined();
  });

  it("ensureAudioOnGesture creates exactly one shared context", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    const first = ensureAudioOnGesture();
    const second = ensureAudioOnGesture();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(tracked.calls.count).toBe(1);
    expect(getAudioContext()).toBe(first);
  });
});

describe("play mirror", () => {
  it("records pistol then shotgun with different base frequencies", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    playShot("pistol");
    playShot("shotgun");
    const w = (globalThis as unknown as { window: Window }).window;
    expect(w.__audio).toBeDefined();
    const entries = w.__audio?.lastPlayed ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const freqs = new Set(entries.map((entry) => entry.baseFreq));
    expect(freqs.size).toBeGreaterThanOrEqual(2);
    expect(entries[0]?.baseFreq).toBe(880);
    expect(entries[1]?.baseFreq).toBe(160);
  });

  it("instantiates OscillatorNode and AudioBufferSourceNode on plays", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    playShot("rifle");
    playExplosion();
    expect(tracked.created).toContain("oscillator");
    expect(tracked.created).toContain("buffer");
  });

  it("mirrors reload, dry-fire, bounce, and explosion voices", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    playReload();
    playDryFire();
    playBounce();
    playExplosion();
    const w = (globalThis as unknown as { window: Window }).window;
    const names = (w.__audio?.lastPlayed ?? []).map((entry) => entry.name);
    expect(names).toEqual(["reload", "dryfire", "bounce", "explosion"]);
  });

  it("throttles a held dry-fire trigger to one play per window", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    playDryFire();
    playDryFire();
    const w = (globalThis as unknown as { window: Window }).window;
    expect(w.__audio?.lastPlayed).toHaveLength(1);
  });

  it("caps the mirror at the newest entries", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    for (let i = 0; i < 20; i += 1) {
      playBounce();
    }
    const w = (globalThis as unknown as { window: Window }).window;
    expect(w.__audio?.lastPlayed).toHaveLength(16);
  });
});

describe("groupShotWeapons", () => {
  it("emits one weapon per firing shooter, never per pellet", () => {
    const pellets = [];
    for (let i = 0; i < 8; i += 1) {
      pellets.push({ shooter: 0, weapon: "shotgun", tick: 7 });
    }
    pellets.push({ shooter: 1, weapon: "pistol", tick: 7 });
    expect(groupShotWeapons(pellets)).toEqual(["shotgun", "pistol"]);
  });

  it("returns no plays for an empty drain", () => {
    expect(groupShotWeapons([])).toEqual([]);
  });
});

describe("ambient voices", () => {
  const ambient = [
    "hop",
    "land",
    "grunt",
    "kill",
    "pickup",
    "matchStart",
    "matchEnd",
  ] as const;

  it("adds seven distinct presets with the pickup chime in 600-1200 Hz", () => {
    for (const name of ambient) {
      expect(SFX_PRESETS[name]).toBeDefined();
    }
    const freqs = ambient.map((name) => SFX_PRESETS[name].baseFreq);
    expect(new Set(freqs).size).toBe(ambient.length);
    expect(SFX_PRESETS.pickup.baseFreq).toBeGreaterThanOrEqual(600);
    expect(SFX_PRESETS.pickup.baseFreq).toBeLessThanOrEqual(1200);
  });

  it("mirrors each ambient voice with its preset frequency", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    playHop();
    playLand();
    playGrunt();
    playKill();
    playPickup();
    playMatchStart();
    playMatchEnd();
    const w = (globalThis as unknown as { window: Window }).window;
    const entries = w.__audio?.lastPlayed ?? [];
    expect(entries.map((entry) => entry.name)).toEqual([...ambient]);
    for (let i = 0; i < ambient.length; i += 1) {
      expect(entries[i]?.baseFreq).toBe(SFX_PRESETS[ambient[i]].baseFreq);
    }
  });

  it("keeps new voices and the jet loop silent no-ops before ensure", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    playHop();
    playLand();
    playGrunt();
    playKill();
    playPickup();
    playMatchStart();
    playMatchEnd();
    expect(() => setJetting(true, 1)).not.toThrow();
    expect(tracked.calls.count).toBe(0);
    expect(tracked.created).toHaveLength(0);
    expect(getJetGain()).toBe(0);
    const w = (globalThis as unknown as { window: { __audio?: unknown } })
      .window;
    expect(w.__audio).toBeUndefined();
  });

  it("holds the jet loop above 0.1 while jetting, near zero after release", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    setJetting(true, 1);
    expect(getJetGain()).toBeGreaterThan(0.1);
    const w = (globalThis as unknown as { window: Window }).window;
    expect(w.__audio?.jetGain ?? 0).toBeGreaterThan(0.1);
    // Release: the 60 ms decay settles the fake target synchronously,
    // standing in for the < 0.02 within 300 ms envelope.
    setJetting(false, 0);
    expect(getJetGain()).toBeLessThan(0.02);
    expect(w.__audio?.jetGain ?? 1).toBeLessThan(0.02);
  });

  it("scales the jet gain with fuel ratio", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    setJetting(true, 1);
    const full = getJetGain();
    setJetting(true, 0);
    const empty = getJetGain();
    expect(full).toBeGreaterThan(empty);
    expect(empty).toBeGreaterThan(0.1);
  });

  it("exposes a post-master analyser downstream of master", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    expect(getAnalyser()).toBeNull();
    ensureAudioOnGesture();
    expect(getAnalyser()).not.toBeNull();
    const w = (globalThis as unknown as { window: Window }).window;
    expect(w.__audio?.analyser).toBe(getAnalyser());
    const master = tracked.gains[0];
    const tap = tracked.analysers[0];
    expect(master).toBeDefined();
    expect(tap).toBeDefined();
    expect(master?.connections).toContain(tap);
    const destination = (
      tracked.instance as unknown as { destination: unknown }
    ).destination;
    expect(tap?.connections).toContain(destination);
  });

  it("setVolume(0) zeroes master while the jet path still routes through it", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    setJetting(true, 1);
    setVolume(0);
    expect(getVolume()).toBe(0);
    const master = tracked.gains[0];
    expect(master?.gain.value).toBe(0);
    // The persistent loop (second gain) still feeds master, so the
    // post-master tap reads silence instead of a stale level.
    const jet = tracked.gains[1];
    expect(jet).toBeDefined();
    expect(jet?.connections).toContain(master);
  });
});

describe("setVolume", () => {
  it("clamps like parseVolume and stays pre-gesture safe", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    setVolume(2);
    expect(getVolume()).toBe(1);
    setVolume(-1);
    expect(getVolume()).toBe(0);
    setVolume(0.5);
    expect(getVolume()).toBe(0.5);
    expect(tracked.calls.count).toBe(0);
  });
});

describe("zero asset dir", () => {
  it("ships no binary audio files in packages/client/src/audio", () => {
    const dir = fileURLToPath(new URL("../src/audio", import.meta.url));
    const names = readdirSync(dir, { recursive: true }) as unknown as string[];
    const binaries = names.filter((name) => /\.(mp3|wav|ogg)$/i.test(name));
    expect(binaries).toEqual([]);
  });
});
