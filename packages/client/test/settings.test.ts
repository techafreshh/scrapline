// Settings model tests: volume parse/clamp/fallbacks, storage round-trip,
// and binder prefill/persist/show/hide. Mirrors
// packages/client/test/setup.test.ts (small local builders, behavior
// assertions, no padding, no DOM needed).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOLUME,
  SETTINGS_VOLUME_KEY,
  bindSettings,
  loadVolume,
  parseVolume,
  saveVolume,
} from "../src/settings";
import type { SetupStorage } from "../src/setup";

/** In-memory stand-in for localStorage. */
function fakeStorage(entries?: Record<string, string>): SetupStorage {
  const backing = new Map<string, string>(Object.entries(entries ?? {}));
  return {
    getItem: (key: string): string | null =>
      backing.has(key) ? (backing.get(key) as string) : null,
    setItem: (key: string, value: string): void => {
      backing.set(key, value);
    },
  };
}

/** Minimal slider stand-in carrying value, style, and input listeners. */
function fakeSlider(initial: string): {
  value: string;
  style: { display: string };
  listeners: Map<string, Array<() => void>>;
  addEventListener(type: string, listener: () => void): void;
  fire(type: string): void;
} {
  const listeners = new Map<string, Array<() => void>>();
  return {
    value: initial,
    style: { display: "" },
    listeners,
    addEventListener(type: string, listener: () => void): void {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    fire(type: string): void {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  };
}

/** Minimal document stand-in resolving ids from a table. */
function fakeDoc(elements: Record<string, unknown>): Document {
  return {
    getElementById: (id: string): unknown =>
      id in elements ? elements[id] : null,
  } as unknown as Document;
}

describe("parseVolume", () => {
  it("falls back to 0.8 on missing or non-numeric input", () => {
    expect(parseVolume(undefined)).toBe(DEFAULT_VOLUME);
    expect(parseVolume(null)).toBe(DEFAULT_VOLUME);
    expect(parseVolume("")).toBe(DEFAULT_VOLUME);
    expect(parseVolume("banana")).toBe(DEFAULT_VOLUME);
    expect(parseVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
    expect(parseVolume(true)).toBe(DEFAULT_VOLUME);
    expect(parseVolume({})).toBe(DEFAULT_VOLUME);
  });

  it("accepts numbers and numeric strings in range", () => {
    expect(parseVolume(0.5)).toBe(0.5);
    expect(parseVolume("0.5")).toBe(0.5);
    expect(parseVolume(0)).toBe(0);
    expect(parseVolume(1)).toBe(1);
    expect(parseVolume(" 0.25 ")).toBe(0.25);
  });

  it("clamps out-of-range values into 0-1", () => {
    expect(parseVolume(-0.5)).toBe(0);
    expect(parseVolume(2)).toBe(1);
    expect(parseVolume("-3")).toBe(0);
    expect(parseVolume("99")).toBe(1);
  });
});

describe("loadVolume/saveVolume", () => {
  it("returns 0.8 when storage is empty or absent", () => {
    expect(loadVolume(fakeStorage())).toBe(DEFAULT_VOLUME);
    expect(loadVolume(null)).toBe(DEFAULT_VOLUME);
    expect(loadVolume(undefined)).toBe(DEFAULT_VOLUME);
  });

  it("round-trips 0.5 as the plain string \"0.5\"", () => {
    const storage = fakeStorage();
    saveVolume(storage, 0.5);
    expect(storage.getItem(SETTINGS_VOLUME_KEY)).toBe("0.5");
    expect(loadVolume(storage)).toBe(0.5);
  });

  it("persists zero as \"0.0\" and reloads it as muted", () => {
    const storage = fakeStorage();
    saveVolume(storage, 0);
    expect(storage.getItem(SETTINGS_VOLUME_KEY)).toBe("0.0");
    expect(loadVolume(storage)).toBe(0);
  });

  it("persists one as \"1.0\"", () => {
    const storage = fakeStorage();
    saveVolume(storage, 1);
    expect(storage.getItem(SETTINGS_VOLUME_KEY)).toBe("1.0");
    expect(loadVolume(storage)).toBe(1);
  });

  it("falls back to 0.8 on corrupt stored values", () => {
    expect(
      loadVolume(fakeStorage({ [SETTINGS_VOLUME_KEY]: "loud" })),
    ).toBe(DEFAULT_VOLUME);
    expect(loadVolume(fakeStorage({ [SETTINGS_VOLUME_KEY]: "" }))).toBe(
      DEFAULT_VOLUME,
    );
  });

  it("is a no-op when storage is absent", () => {
    expect(() => saveVolume(null, 0.5)).not.toThrow();
    expect(() => saveVolume(undefined, 0.5)).not.toThrow();
  });
});

describe("bindSettings", () => {
  it("defaults to 0.8 and no-ops when elements are missing", () => {
    const binder = bindSettings(fakeDoc({}), fakeStorage());
    expect(binder.volume).toBe(DEFAULT_VOLUME);
    expect(() => binder.show()).not.toThrow();
    expect(() => binder.hide()).not.toThrow();
  });

  it("prefills the slider from storage and persists slider input", () => {
    const storage = fakeStorage({ [SETTINGS_VOLUME_KEY]: "0.5" });
    const slider = fakeSlider("0.8");
    const binder = bindSettings(fakeDoc({ volume: slider }), storage);
    expect(binder.volume).toBe(0.5);
    expect(slider.value).toBe("0.5");
    slider.value = "0.25";
    slider.fire("input");
    expect(binder.volume).toBe(0.25);
    expect(storage.getItem(SETTINGS_VOLUME_KEY)).toBe("0.25");
  });

  it("toggles the settings overlay display on show/hide", () => {
    const overlay = { style: { display: "none" } };
    const binder = bindSettings(
      fakeDoc({ settings: overlay }),
      fakeStorage(),
    );
    binder.show();
    expect(overlay.style.display).toBe("");
    binder.hide();
    expect(overlay.style.display).toBe("none");
  });
});
