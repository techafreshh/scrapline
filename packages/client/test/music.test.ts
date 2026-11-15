// Generative soundtrack tests: determinism, mode switching, tension,
// volume, pre-gesture silence, and the zero-asset-dir contract. Mirrors
// packages/client/test/audio.test.ts (recording fakes, mirror probes via
// globalThis.window, no DOM needed).
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vitest } from "vitest";
import {
  ensureAudioOnGesture,
  resetAudioForTests,
  setAudioContextFactory,
} from "../src/audio/engine";
import {
  getMusicMode,
  getMusicTension,
  getMusicVolume,
  matchBassSequence,
  menuPluckSequence,
  musicTensionFor,
  playEndStinger,
  resetMusicForTests,
  setMusicSeed,
  setMusicVolume,
  setTension01,
  startMatchMusic,
  startMenuMusic,
  stepMusicForTests,
  stopMusic,
  syncMusicMirror,
} from "../src/audio/music";

/** Recording stand-in for an AudioParam with a live value. */
interface FakeParam {
  value: number;
  setCalls: number[];
  setValueAtTime(v: number, t: number): void;
  setTargetAtTime(v: number, t: number, tau: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
}

function fakeParam(initial: number): FakeParam {
  const param: FakeParam = {
    value: initial,
    setCalls: [],
    setValueAtTime(v: number): void {
      param.value = v;
      param.setCalls.push(v);
    },
    setTargetAtTime(v: number): void {
      param.value = v;
      param.setCalls.push(v);
    },
    exponentialRampToValueAtTime(v: number): void {
      param.value = v;
      param.setCalls.push(v);
    },
  };
  return param;
}

/** Recording stand-in for a GainNode with a live value. */
interface FakeGainNode {
  gain: FakeParam;
  connections: unknown[];
  connect(target: unknown): void;
}

function fakeGain(created: string[], gains: FakeGainNode[]): FakeGainNode {
  const node: FakeGainNode = {
    gain: fakeParam(1),
    connections: [],
    connect(target: unknown): void {
      node.connections.push(target);
    },
  };
  created.push("gain");
  gains.push(node);
  return node;
}

/** Recording stand-in for an OscillatorNode capturing frequencies. */
function fakeOsc(
  created: string[],
  freqs: number[],
): {
  type: string;
  frequency: FakeParam;
  connect(target: unknown): void;
  start(t?: number): void;
  stop(t?: number): void;
} {
  created.push("oscillator");
  const frequency = fakeParam(440);
  const original = frequency.setValueAtTime.bind(frequency);
  frequency.setValueAtTime = (v: number, t: number): void => {
    freqs.push(v);
    original(v, t);
  };
  return {
    type: "",
    frequency,
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

/** Recording stand-in for a BiquadFilterNode capturing cutoffs. */
function fakeFilter(
  created: string[],
  cutoffs: number[],
): {
  type: string;
  frequency: FakeParam;
  connect(target: unknown): void;
} {
  created.push("filter");
  const frequency = fakeParam(400);
  const original = frequency.setValueAtTime.bind(frequency);
  frequency.setValueAtTime = (v: number, t: number): void => {
    cutoffs.push(v);
    original(v, t);
  };
  return {
    type: "",
    frequency,
    connect(): void {},
  };
}

/** Minimal AudioContext stand-in recording created node kinds. */
function fakeContext(): {
  instance: AudioContext & { currentTime: number };
  created: string[];
  gains: FakeGainNode[];
  freqs: number[];
  cutoffs: number[];
} {
  const created: string[] = [];
  const gains: FakeGainNode[] = [];
  const freqs: number[] = [];
  const cutoffs: number[] = [];
  const instance = {
    state: "running",
    sampleRate: 44100,
    currentTime: 0,
    destination: {},
    createOscillator: (): unknown => fakeOsc(created, freqs),
    createBufferSource: (): unknown => fakeSource(created),
    createGain: (): unknown => fakeGain(created, gains),
    createBiquadFilter: (): unknown => fakeFilter(created, cutoffs),
    createAnalyser: (): unknown => ({
      connect(): void {},
      getFloatTimeDomainData(): void {},
    }),
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
  } as unknown as AudioContext & { currentTime: number };
  return { instance, created, gains, freqs, cutoffs };
}

/** Trackable factory: counts creations, returns the same fake. */
function trackedFactory(): {
  factory: () => AudioContext | null;
  calls: { count: number };
  created: string[];
  gains: FakeGainNode[];
  freqs: number[];
  cutoffs: number[];
  instance: AudioContext & { currentTime: number };
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
    freqs: fake.freqs,
    cutoffs: fake.cutoffs,
    instance: fake.instance,
  };
}

/** Fake bare window carrying only the audio probe mirror. */
function fakeWindow(): { __audio?: Record<string, unknown> } {
  return {};
}

/** Read the music mirror fields tolerantly (absent pre-gesture). */
function musicMirror(): {
  mode?: unknown;
  nodes?: unknown;
  tension?: unknown;
} {
  const w = (
    globalThis as unknown as {
      window: { __audio?: Record<string, unknown> };
    }
  ).window;
  const audio = w.__audio ?? {};
  return {
    mode: audio["musicMode"],
    nodes: audio["musicNodes"],
    tension: audio["musicTension"],
  };
}

beforeEach(() => {
  resetAudioForTests();
  resetMusicForTests();
  const holder = globalThis as unknown as { window?: unknown };
  holder.window = fakeWindow();
});

afterEach(() => {
  resetMusicForTests();
  resetAudioForTests();
  vitest.useRealTimers();
});

describe("generative determinism", () => {
  it("replays the same pluck sequence from the same seed", () => {
    expect(menuPluckSequence(7, 32)).toEqual(menuPluckSequence(7, 32));
    expect(menuPluckSequence(7, 32)).not.toEqual(menuPluckSequence(8, 32));
  });

  it("replays the same bass sequence from the same seed", () => {
    expect(matchBassSequence(3, 64, 0.5)).toEqual(
      matchBassSequence(3, 64, 0.5),
    );
  });

  it("raises scheduled bass density with tension", () => {
    const calm = matchBassSequence(11, 64, 0).filter(
      (voice) => voice !== null,
    ).length;
    const driven = matchBassSequence(11, 64, 1).filter(
      (voice) => voice !== null,
    ).length;
    expect(driven).toBeGreaterThan(calm);
  });

  it("schedules identical opening frequencies from the same seed", () => {
    const first = trackedFactory();
    setAudioContextFactory(first.factory);
    ensureAudioOnGesture();
    setMusicSeed(99);
    startMenuMusic();
    const second = trackedFactory();
    resetAudioForTests();
    setAudioContextFactory(second.factory);
    resetMusicForTests();
    ensureAudioOnGesture();
    setMusicSeed(99);
    startMenuMusic();
    expect(second.freqs).toEqual(first.freqs);
    expect(first.freqs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("musicTensionFor", () => {
  it("rises with the clock and clamps into 0-1", () => {
    expect(musicTensionFor(0, 25, 18000)).toBe(0);
    // Clock fraction and pace fraction race: 9000 ticks is half the
    // clock but 0.6 of the expected kill pace, so the max term wins.
    expect(musicTensionFor(9000, 25, 18000)).toBeCloseTo(0.6, 5);
    expect(musicTensionFor(18000, 25, 18000)).toBe(1);
    expect(musicTensionFor(36000, 25, 18000)).toBe(1);
  });

  it("rises with the leader's score fraction", () => {
    expect(musicTensionFor(0, 25, 18000, 25)).toBe(1);
    expect(musicTensionFor(0, 25, 18000, 0)).toBe(0);
  });

  it("is NaN-safe and zero-safe", () => {
    expect(musicTensionFor(Number.NaN, 25, 18000)).toBe(0);
    expect(musicTensionFor(100, 0, 0)).toBe(0);
    expect(musicTensionFor(-5, 25, 18000)).toBe(0);
  });
});

describe("autoplay guard", () => {
  it("creates no context and schedules nothing before the first gesture", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    startMenuMusic();
    startMatchMusic();
    playEndStinger();
    setTension01(1);
    setMusicVolume(0.2);
    expect(tracked.calls.count).toBe(0);
    expect(tracked.created).toHaveLength(0);
  });

  it("retains the pending mode and starts on the next gesture", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    startMenuMusic();
    expect(getMusicMode()).toBe("menu");
    expect(musicMirror().nodes ?? 0).toBe(0);
    ensureAudioOnGesture();
    startMenuMusic();
    expect(musicMirror().mode).toBe("menu");
    expect(Number(musicMirror().nodes ?? 0)).toBeGreaterThanOrEqual(2);
  });
});

describe("menu loop", () => {
  it("starts pad+pluck voices with mode and tension mirrored", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    startMenuMusic();
    expect(getMusicMode()).toBe("menu");
    expect(musicMirror().mode).toBe("menu");
    expect(Number(musicMirror().nodes ?? 0)).toBeGreaterThanOrEqual(2);
    expect(tracked.created).toContain("oscillator");
    setTension01(0.5);
    expect(getMusicTension()).toBe(0.5);
    expect(musicMirror().tension).toBe(0.5);
  });

  it("keeps scheduling across lookahead ticks", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    startMenuMusic();
    const before = tracked.created.length;
    tracked.instance.currentTime += 0.3;
    stepMusicForTests();
    tracked.instance.currentTime += 0.3;
    stepMusicForTests();
    expect(tracked.created.length).toBeGreaterThan(before);
  });
});

describe("match loop", () => {
  it("switches the mirror to match with live voices", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    startMenuMusic();
    expect(musicMirror().mode).toBe("menu");
    startMatchMusic();
    expect(getMusicMode()).toBe("match");
    expect(musicMirror().mode).toBe("match");
    expect(Number(musicMirror().nodes ?? 0)).toBeGreaterThanOrEqual(2);
    expect(tracked.created).toContain("buffer");
  });

  it("schedules more voices driven than calm over the same span", () => {
    const calm = trackedFactory();
    setAudioContextFactory(calm.factory);
    ensureAudioOnGesture();
    setTension01(0);
    startMatchMusic();
    for (let i = 0; i < 8; i += 1) {
      calm.instance.currentTime += 0.3;
      stepMusicForTests();
    }
    const calmVoices = calm.created.length;
    resetMusicForTests();
    resetAudioForTests();
    const driven = trackedFactory();
    setAudioContextFactory(driven.factory);
    ensureAudioOnGesture();
    setTension01(1);
    startMatchMusic();
    for (let i = 0; i < 8; i += 1) {
      driven.instance.currentTime += 0.3;
      stepMusicForTests();
    }
    expect(driven.created.length).toBeGreaterThan(calmVoices);
  });

  it("opens the bass lowpass cutoff with tension", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    startMatchMusic();
    const calmCutoff = tracked.cutoffs[tracked.cutoffs.length - 1] ?? 0;
    setTension01(1);
    tracked.instance.currentTime += 0.3;
    stepMusicForTests();
    const drivenCutoff = tracked.cutoffs[tracked.cutoffs.length - 1] ?? 0;
    expect(calmCutoff).toBeGreaterThan(0);
    expect(drivenCutoff).toBeGreaterThan(calmCutoff);
  });

  it("stops scheduling on stopMusic", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    startMatchMusic();
    stopMusic();
    expect(getMusicMode()).toBe("stopped");
    expect(musicMirror().mode).toBe("stopped");
    expect(musicMirror().nodes).toBe(0);
    const before = tracked.created.length;
    tracked.instance.currentTime += 1;
    stepMusicForTests();
    expect(tracked.created.length).toBe(before);
  });
});

describe("match-end stinger", () => {
  it("is a silent no-op before the first gesture", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    playEndStinger();
    expect(tracked.calls.count).toBe(0);
    expect(tracked.created).toHaveLength(0);
  });

  it("schedules a rising arp on top of the running loop", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    startMatchMusic();
    const before = Number(musicMirror().nodes ?? 0);
    const freqsBefore = tracked.freqs.length;
    playEndStinger();
    expect(Number(musicMirror().nodes ?? 0)).toBeGreaterThanOrEqual(
      before + 4,
    );
    expect(tracked.freqs.length).toBeGreaterThan(freqsBefore);
  });
});

describe("music volume", () => {
  it("defaults to 0.7 and clamps like the master volume", () => {
    expect(getMusicVolume()).toBe(0.7);
    setMusicVolume(2);
    expect(getMusicVolume()).toBe(1);
    setMusicVolume(-1);
    expect(getMusicVolume()).toBe(0);
    setMusicVolume(0.5);
    expect(getMusicVolume()).toBe(0.5);
  });

  it("zeroes the music bus while the context stays running", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    const ac = ensureAudioOnGesture();
    expect(ac?.state).toBe("running");
    // Gains present after ensure are master + the engine jet loop; the
    // music bus is the first later gain feeding the shared master.
    const pre = tracked.gains.length;
    startMenuMusic();
    setMusicVolume(0);
    expect(getMusicVolume()).toBe(0);
    expect(ac?.state).toBe("running");
    const master = tracked.gains[0];
    const bus = tracked.gains
      .slice(pre)
      .find((gain) => gain.connections.includes(master as unknown));
    expect(bus).toBeDefined();
    expect(bus?.gain.value).toBe(0);
  });

  it("is pre-gesture safe and applies on the next start", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    setMusicVolume(0.3);
    expect(tracked.calls.count).toBe(0);
    ensureAudioOnGesture();
    const pre = tracked.gains.length;
    startMenuMusic();
    const master = tracked.gains[0];
    const bus = tracked.gains
      .slice(pre)
      .find((gain) => gain.connections.includes(master as unknown));
    expect(bus?.gain.value).toBeCloseTo(0.3, 5);
  });
});

describe("zero asset dir", () => {
  it("ships no binary audio files in packages/client/src/audio", () => {
    const dir = fileURLToPath(new URL("../src/audio", import.meta.url));
    const names = readdirSync(dir, { recursive: true }) as unknown as string[];
    const binaries = names.filter((name) => /\.(mp3|wav|ogg)$/i.test(name));
    expect(binaries).toEqual([]);
  });

  it("keeps packages/client/assets/audio absent or empty", () => {
    const dir = fileURLToPath(new URL("../assets/audio", import.meta.url));
    let entries: string[];
    try {
      entries = readdirSync(dir, {
        recursive: true,
      }) as unknown as string[];
    } catch {
      entries = [];
    }
    const binaries = entries.filter((name) => /\.(mp3|wav|ogg)$/i.test(name));
    expect(binaries).toEqual([]);
    expect(
      entries.filter((name) => !name.endsWith(".DS_Store")),
    ).toEqual([]);
  });
});

describe("probe mirror upkeep", () => {
  it("publishes mode, nodes, and tension without touching lastPlayed", () => {
    const tracked = trackedFactory();
    setAudioContextFactory(tracked.factory);
    ensureAudioOnGesture();
    startMenuMusic();
    syncMusicMirror();
    const w = (
      globalThis as unknown as {
        window: Window;
      }
    ).window;
    expect(w.__audio?.musicMode).toBe("menu");
    expect(Number(w.__audio?.musicNodes ?? 0)).toBeGreaterThanOrEqual(2);
    expect(w.__audio?.musicTension).toBe(0);
    expect(w.__audio?.lastPlayed).toEqual([]);
    expect(tracked.created.length).toBeGreaterThan(0);
  });
});
