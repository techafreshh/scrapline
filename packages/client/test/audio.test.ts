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
  getAudioContext,
  getVolume,
  groupShotWeapons,
  playBounce,
  playDryFire,
  playExplosion,
  playReload,
  playShot,
  resetAudioForTests,
  setAudioContextFactory,
  setVolume,
} from "../src/audio/engine";

/** Recording stand-in for a GainNode. */
function fakeGain(): {
  gain: {
    value: number;
    setValueAtTime(v: number, t: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
  };
  connect(target: unknown): void;
} {
  return {
    gain: {
      value: 1,
      setValueAtTime(v: number): void {
        void v;
      },
      exponentialRampToValueAtTime(v: number): void {
        void v;
      },
    },
    connect(): void {},
  };
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
} {
  const created: string[] = [];
  const instance = {
    state: "running",
    sampleRate: 44100,
    currentTime: 0,
    destination: {},
    createOscillator: (): unknown => fakeOsc(created),
    createBufferSource: (): unknown => fakeSource(created),
    createGain: (): unknown => fakeGain(),
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
  return { instance, created };
}

/** Trackable factory: counts creations, returns the same fake. */
function trackedFactory(): {
  factory: () => AudioContext | null;
  calls: { count: number };
  created: string[];
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
