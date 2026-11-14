// Settings model tests: volume parse/clamp/fallbacks, storage round-trip,
// and binder prefill/persist/show/hide. Mirrors
// packages/client/test/setup.test.ts (small local builders, behavior
// assertions, no padding, no DOM needed).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUALITY,
  DEFAULT_SHOW_NAME_TAGS,
  DEFAULT_VOLUME,
  FULLSCREEN_KEY,
  SETTINGS_QUALITY_KEY,
  SETTINGS_VOLUME_KEY,
  SHOW_NAMETAGS_KEY,
  bindSettings,
  loadFullscreen,
  loadQuality,
  loadShowNameTags,
  loadVolume,
  parseFullscreen,
  parseQuality,
  parseShowNameTags,
  parseVolume,
  saveFullscreen,
  saveQuality,
  saveShowNameTags,
  saveVolume,
  toggleFullscreen,
  toggleQuality,
  toggleShowNameTags,
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

/** Minimal button stand-in carrying textContent and click listeners. */
function fakeButton(initial: string): {
  textContent: string | null;
  listeners: Map<string, Array<() => void>>;
  addEventListener(type: string, listener: () => void): void;
  fire(type: string): void;
} {
  const listeners = new Map<string, Array<() => void>>();
  return {
    textContent: initial,
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

/** Document stand-in with button lookup plus doc-level listeners. */
function fakeDocFull(
  elements: Record<string, unknown>,
  extras?: Record<string, unknown>,
): Document & { fire(type: string): void } {
  const listeners = new Map<string, Array<() => void>>();
  const doc = {
    getElementById: (id: string): unknown =>
      id in elements ? elements[id] : null,
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
    ...(extras ?? {}),
  };
  return doc as unknown as Document & { fire(type: string): void };
}

describe("parseFullscreen", () => {
  it("treats 1/true spellings as ON and everything else as OFF", () => {
    expect(parseFullscreen("1")).toBe(true);
    expect(parseFullscreen("true")).toBe(true);
    expect(parseFullscreen("TRUE")).toBe(true);
    expect(parseFullscreen("on")).toBe(true);
    expect(parseFullscreen(" ON ")).toBe(true);
    expect(parseFullscreen(1)).toBe(true);
    expect(parseFullscreen(true)).toBe(true);
    expect(parseFullscreen("0")).toBe(false);
    expect(parseFullscreen("false")).toBe(false);
    expect(parseFullscreen("off")).toBe(false);
    expect(parseFullscreen("")).toBe(false);
    expect(parseFullscreen("banana")).toBe(false);
    expect(parseFullscreen(undefined)).toBe(false);
    expect(parseFullscreen(null)).toBe(false);
    expect(parseFullscreen(0)).toBe(false);
    expect(parseFullscreen(false)).toBe(false);
    expect(parseFullscreen({})).toBe(false);
  });
});

describe("loadFullscreen/saveFullscreen", () => {
  it("defaults to OFF when storage is empty or absent", () => {
    expect(loadFullscreen(fakeStorage())).toBe(false);
    expect(loadFullscreen(null)).toBe(false);
    expect(loadFullscreen(undefined)).toBe(false);
  });

  it("round-trips ON as \"1\" and OFF as \"0\"", () => {
    const storage = fakeStorage();
    saveFullscreen(storage, true);
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("1");
    expect(loadFullscreen(storage)).toBe(true);
    saveFullscreen(storage, false);
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("0");
    expect(loadFullscreen(storage)).toBe(false);
  });

  it("falls back to OFF on corrupt stored values", () => {
    expect(loadFullscreen(fakeStorage({ [FULLSCREEN_KEY]: "loud" }))).toBe(
      false,
    );
    expect(loadFullscreen(fakeStorage({ [FULLSCREEN_KEY]: "" }))).toBe(false);
  });

  it("is a no-op when storage is absent", () => {
    expect(() => saveFullscreen(null, true)).not.toThrow();
    expect(() => saveFullscreen(undefined, true)).not.toThrow();
  });
});

describe("fullscreen binder", () => {
  it("prefills the button ON when the stored intent is \"1\"", () => {
    const storage = fakeStorage({ [FULLSCREEN_KEY]: "1" });
    const button = fakeButton("Fullscreen: OFF");
    const binder = bindSettings(
      fakeDocFull({ "btn-fullscreen": button }),
      storage,
    );
    expect(binder.fullscreen).toBe(true);
    expect(button.textContent).toBe("Fullscreen: ON");
  });

  it("renders OFF by default and re-prefills on show()", () => {
    const storage = fakeStorage();
    const button = fakeButton("Fullscreen: OFF");
    const overlay = { style: { display: "none" } };
    const binder = bindSettings(
      fakeDocFull({ "btn-fullscreen": button, settings: overlay }),
      storage,
    );
    expect(button.textContent).toBe("Fullscreen: OFF");
    storage.setItem(FULLSCREEN_KEY, "1");
    binder.show();
    expect(binder.fullscreen).toBe(true);
    expect(button.textContent).toBe("Fullscreen: ON");
    binder.hide();
    expect(overlay.style.display).toBe("none");
  });

  it("click toggles the stored value and the label", async () => {
    const storage = fakeStorage();
    const button = fakeButton("Fullscreen: OFF");
    const binder = bindSettings(
      fakeDocFull({ "btn-fullscreen": button }),
      storage,
    );
    button.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("1");
    expect(binder.fullscreen).toBe(true);
    expect(button.textContent).toBe("Fullscreen: ON");
    button.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("0");
    expect(binder.fullscreen).toBe(false);
    expect(button.textContent).toBe("Fullscreen: OFF");
  });

  it("no-ops when the button is missing", async () => {
    const storage = fakeStorage();
    const binder = bindSettings(fakeDoc({}), storage);
    await expect(binder.toggleFullscreen()).resolves.toBe(true);
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("1");
  });

  it("resolves without throwing when the Fullscreen API is absent", async () => {
    await expect(
      toggleFullscreen(fakeDoc({}), fakeStorage()),
    ).resolves.toBe(true);
  });

  it("swallows headless rejections and keeps the persisted intent", async () => {
    const storage = fakeStorage();
    const doc = fakeDocFull(
      {},
      {
        documentElement: {
          requestFullscreen: () => Promise.reject(new Error("denied")),
        },
      },
    );
    await expect(toggleFullscreen(doc, storage)).resolves.toBe(true);
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("1");
  });

  it("requests fullscreen on ON and exits on OFF", async () => {
    const storage = fakeStorage();
    let requested = 0;
    let exited = 0;
    const doc = fakeDocFull(
      {},
      {
        documentElement: {
          requestFullscreen: () => {
            requested += 1;
            return Promise.resolve();
          },
        },
        exitFullscreen: () => {
          exited += 1;
          return Promise.resolve();
        },
      },
    );
    await expect(toggleFullscreen(doc, storage)).resolves.toBe(true);
    expect(requested).toBe(1);
    expect(exited).toBe(0);
    await expect(toggleFullscreen(doc, storage)).resolves.toBe(false);
    expect(requested).toBe(1);
    expect(exited).toBe(1);
  });

  it("syncs the label from fullscreenElement on fullscreenchange", () => {
    const storage = fakeStorage();
    const button = fakeButton("Fullscreen: OFF");
    const holder: Record<string, unknown> = { fullscreenElement: null };
    const doc = fakeDocFull({ "btn-fullscreen": button }, holder);
    const binder = bindSettings(doc, storage);
    expect(button.textContent).toBe("Fullscreen: OFF");
    holder["fullscreenElement"] = {};
    (doc as unknown as { fullscreenElement: unknown }).fullscreenElement =
      holder["fullscreenElement"];
    doc.fire("fullscreenchange");
    expect(binder.fullscreen).toBe(true);
    expect(button.textContent).toBe("Fullscreen: ON");
    (doc as unknown as { fullscreenElement: unknown }).fullscreenElement =
      null;
    doc.fire("fullscreenchange");
    expect(binder.fullscreen).toBe(false);
    expect(button.textContent).toBe("Fullscreen: OFF");
  });

  it("persists live fullscreen state so show() cannot resurrect stale ON", () => {
    const storage = fakeStorage({ [FULLSCREEN_KEY]: "1" });
    const button = fakeButton("Fullscreen: OFF");
    const overlay = { style: { display: "none" } };
    const holder: Record<string, unknown> = { fullscreenElement: null };
    const doc = fakeDocFull(
      { "btn-fullscreen": button, settings: overlay },
      holder,
    );
    const binder = bindSettings(doc, storage);
    // Simulate entering fullscreen via the browser chrome.
    holder["fullscreenElement"] = {};
    (doc as unknown as { fullscreenElement: unknown }).fullscreenElement =
      holder["fullscreenElement"];
    doc.fire("fullscreenchange");
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("1");
    expect(binder.fullscreen).toBe(true);
    expect(button.textContent).toBe("Fullscreen: ON");
    // Simulate an Esc-driven exit: storage, binder, and label go OFF.
    (doc as unknown as { fullscreenElement: unknown }).fullscreenElement =
      null;
    doc.fire("fullscreenchange");
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("0");
    expect(binder.fullscreen).toBe(false);
    expect(button.textContent).toBe("Fullscreen: OFF");
    // Reopening Settings must not resurrect the stale ON.
    binder.show();
    expect(binder.fullscreen).toBe(false);
    expect(button.textContent).toBe("Fullscreen: OFF");
  });

  it("ignores fullscreenchange on docs without fullscreenElement", () => {
    const storage = fakeStorage({ [FULLSCREEN_KEY]: "1" });
    const button = fakeButton("Fullscreen: OFF");
    const doc = fakeDocFull({ "btn-fullscreen": button });
    const binder = bindSettings(doc, storage);
    expect(binder.fullscreen).toBe(true);
    doc.fire("fullscreenchange");
    expect(storage.getItem(FULLSCREEN_KEY)).toBe("1");
    expect(binder.fullscreen).toBe(true);
    expect(button.textContent).toBe("Fullscreen: ON");
  });
});

describe("parseQuality", () => {
  it("treats only low variants as low, everything else as high", () => {
    expect(parseQuality("low")).toBe("low");
    expect(parseQuality("LOW")).toBe("low");
    expect(parseQuality(" low ")).toBe("low");
    expect(parseQuality("0")).toBe("low");
    expect(parseQuality("off")).toBe("low");
    expect(parseQuality("false")).toBe("low");
    expect(parseQuality(false)).toBe("low");
    expect(parseQuality(0)).toBe("low");
    expect(parseQuality("high")).toBe("high");
    expect(parseQuality("HIGH")).toBe("high");
    expect(parseQuality("1")).toBe("high");
    expect(parseQuality("")).toBe("high");
    expect(parseQuality("banana")).toBe("high");
    expect(parseQuality(undefined)).toBe("high");
    expect(parseQuality(null)).toBe("high");
    expect(parseQuality(true)).toBe("high");
    expect(parseQuality(1)).toBe("high");
    expect(parseQuality({})).toBe("high");
  });
});

describe("loadQuality/saveQuality", () => {
  it("defaults to HIGH when storage is empty or absent", () => {
    expect(DEFAULT_QUALITY).toBe("high");
    expect(loadQuality(fakeStorage())).toBe("high");
    expect(loadQuality(null)).toBe("high");
    expect(loadQuality(undefined)).toBe("high");
  });

  it("round-trips low and high spellings", () => {
    const storage = fakeStorage();
    saveQuality(storage, "low");
    expect(storage.getItem(SETTINGS_QUALITY_KEY)).toBe("low");
    expect(loadQuality(storage)).toBe("low");
    saveQuality(storage, "high");
    expect(storage.getItem(SETTINGS_QUALITY_KEY)).toBe("high");
    expect(loadQuality(storage)).toBe("high");
  });

  it("falls back to HIGH on corrupt stored values", () => {
    expect(loadQuality(fakeStorage({ [SETTINGS_QUALITY_KEY]: "loud" }))).toBe(
      "high",
    );
    expect(loadQuality(fakeStorage({ [SETTINGS_QUALITY_KEY]: "" }))).toBe(
      "high",
    );
  });

  it("is a no-op when storage is absent", () => {
    expect(() => saveQuality(null, "low")).not.toThrow();
    expect(() => saveQuality(undefined, "low")).not.toThrow();
  });
});

describe("quality binder", () => {
  it("prefills the button HIGH by default and re-prefills on show()", () => {
    const storage = fakeStorage();
    const button = fakeButton("Quality: HIGH");
    const overlay = { style: { display: "none" } };
    const binder = bindSettings(
      fakeDocFull({ "btn-quality": button, settings: overlay }),
      storage,
    );
    expect(binder.quality).toBe("high");
    expect(button.textContent).toBe("Quality: HIGH");
    storage.setItem(SETTINGS_QUALITY_KEY, "low");
    binder.show();
    expect(binder.quality).toBe("low");
    expect(button.textContent).toBe("Quality: LOW");
    binder.hide();
    expect(overlay.style.display).toBe("none");
  });

  it("click toggles the stored value and the label", async () => {
    const storage = fakeStorage();
    const button = fakeButton("Quality: HIGH");
    const binder = bindSettings(
      fakeDocFull({ "btn-quality": button }),
      storage,
    );
    button.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage.getItem(SETTINGS_QUALITY_KEY)).toBe("low");
    expect(binder.quality).toBe("low");
    expect(button.textContent).toBe("Quality: LOW");
    button.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage.getItem(SETTINGS_QUALITY_KEY)).toBe("high");
    expect(binder.quality).toBe("high");
    expect(button.textContent).toBe("Quality: HIGH");
  });

  it("no-ops when the button is missing", async () => {
    const storage = fakeStorage();
    const binder = bindSettings(fakeDoc({}), storage);
    await expect(binder.toggleQuality()).resolves.toBe("low");
    expect(storage.getItem(SETTINGS_QUALITY_KEY)).toBe("low");
  });

  it("resolves the flipped level through the shared toggle", async () => {
    const storage = fakeStorage();
    const doc = fakeDoc({});
    await expect(toggleQuality(doc, storage)).resolves.toBe("low");
    expect(storage.getItem(SETTINGS_QUALITY_KEY)).toBe("low");
    await expect(toggleQuality(doc, storage)).resolves.toBe("high");
    expect(storage.getItem(SETTINGS_QUALITY_KEY)).toBe("high");
  });
});

describe("parseShowNameTags", () => {
  it("treats only 0/false variants as OFF, everything else as ON", () => {
    expect(parseShowNameTags("1")).toBe(true);
    expect(parseShowNameTags("true")).toBe(true);
    expect(parseShowNameTags("on")).toBe(true);
    expect(parseShowNameTags("")).toBe(true);
    expect(parseShowNameTags("banana")).toBe(true);
    expect(parseShowNameTags(undefined)).toBe(true);
    expect(parseShowNameTags(null)).toBe(true);
    expect(parseShowNameTags(1)).toBe(true);
    expect(parseShowNameTags(true)).toBe(true);
    expect(parseShowNameTags({})).toBe(true);
    expect(parseShowNameTags("0")).toBe(false);
    expect(parseShowNameTags("false")).toBe(false);
    expect(parseShowNameTags("OFF")).toBe(false);
    expect(parseShowNameTags("no")).toBe(false);
    expect(parseShowNameTags(0)).toBe(false);
    expect(parseShowNameTags(false)).toBe(false);
  });
});

describe("loadShowNameTags/saveShowNameTags", () => {
  it("defaults to ON when storage is empty or absent", () => {
    expect(DEFAULT_SHOW_NAME_TAGS).toBe(true);
    expect(loadShowNameTags(fakeStorage())).toBe(true);
    expect(loadShowNameTags(null)).toBe(true);
    expect(loadShowNameTags(undefined)).toBe(true);
  });

  it("round-trips ON as \"1\" and OFF as \"0\"", () => {
    const storage = fakeStorage();
    saveShowNameTags(storage, true);
    expect(storage.getItem(SHOW_NAMETAGS_KEY)).toBe("1");
    expect(loadShowNameTags(storage)).toBe(true);
    saveShowNameTags(storage, false);
    expect(storage.getItem(SHOW_NAMETAGS_KEY)).toBe("0");
    expect(loadShowNameTags(storage)).toBe(false);
  });

  it("falls back to ON on corrupt stored values", () => {
    expect(loadShowNameTags(fakeStorage({ [SHOW_NAMETAGS_KEY]: "loud" }))).toBe(
      true,
    );
    expect(loadShowNameTags(fakeStorage({ [SHOW_NAMETAGS_KEY]: "" }))).toBe(
      true,
    );
  });

  it("is a no-op when storage is absent", () => {
    expect(() => saveShowNameTags(null, true)).not.toThrow();
    expect(() => saveShowNameTags(undefined, true)).not.toThrow();
  });
});

describe("nametags binder", () => {
  it("prefills the button ON by default and re-prefills on show()", () => {
    const storage = fakeStorage();
    const button = fakeButton("Name Tags: ON");
    const overlay = { style: { display: "none" } };
    const binder = bindSettings(
      fakeDocFull({ "btn-nametags": button, settings: overlay }),
      storage,
    );
    expect(binder.showNameTags).toBe(true);
    expect(button.textContent).toBe("Name Tags: ON");
    storage.setItem(SHOW_NAMETAGS_KEY, "0");
    binder.show();
    expect(binder.showNameTags).toBe(false);
    expect(button.textContent).toBe("Name Tags: OFF");
    binder.hide();
    expect(overlay.style.display).toBe("none");
  });

  it("click toggles the stored value and the label", async () => {
    const storage = fakeStorage();
    const button = fakeButton("Name Tags: ON");
    const binder = bindSettings(
      fakeDocFull({ "btn-nametags": button }),
      storage,
    );
    button.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage.getItem(SHOW_NAMETAGS_KEY)).toBe("0");
    expect(binder.showNameTags).toBe(false);
    expect(button.textContent).toBe("Name Tags: OFF");
    button.fire("click");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage.getItem(SHOW_NAMETAGS_KEY)).toBe("1");
    expect(binder.showNameTags).toBe(true);
    expect(button.textContent).toBe("Name Tags: ON");
  });

  it("no-ops when the button is missing", async () => {
    const storage = fakeStorage();
    const binder = bindSettings(fakeDoc({}), storage);
    await expect(binder.toggleShowNameTags()).resolves.toBe(false);
    expect(storage.getItem(SHOW_NAMETAGS_KEY)).toBe("0");
  });

  it("resolves the flipped value through the shared toggle", async () => {
    const storage = fakeStorage();
    const doc = fakeDoc({});
    await expect(toggleShowNameTags(doc, storage)).resolves.toBe(false);
    expect(storage.getItem(SHOW_NAMETAGS_KEY)).toBe("0");
    await expect(toggleShowNameTags(doc, storage)).resolves.toBe(true);
    expect(storage.getItem(SHOW_NAMETAGS_KEY)).toBe("1");
  });
});
