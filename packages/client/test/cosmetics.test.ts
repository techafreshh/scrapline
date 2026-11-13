// Cosmetics tests: model defaults/fallbacks/round-trip, seeded enemy
// diversity, and setup-binder prefill/persist/preview/tolerance.
// Mirrors packages/client/test/settings.test.ts (fake storage plus
// fake-doc elements, behavior assertions, no padding, no DOM needed).
import { describe, expect, it } from "vitest";
import {
  COSMETICS_KEY,
  DEFAULT_COSMETICS,
  HELMET_LIST,
  PALETTE_LIST,
  VISOR_LIST,
  enemyCosmeticsFor,
  loadCosmetics,
  parseCosmetics,
  saveCosmetics,
} from "../src/cosmetics";
import { bindSetup, type SetupStorage } from "../src/setup";
import { cosmeticKey } from "../src/view/character";

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

/** Generic fake element: text + attributes + listeners + style bag. */
function fakeElement(initialValue = ""): {
  value: string;
  textContent: string | null;
  style: { display: string };
  attrs: Map<string, string>;
  listeners: Map<string, Array<() => void>>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  fire(type: string): void;
} {
  const listeners = new Map<string, Array<() => void>>();
  const attrs = new Map<string, string>();
  return {
    value: initialValue,
    textContent: "",
    style: { display: "" },
    attrs,
    listeners,
    setAttribute(name: string, value: string): void {
      attrs.set(name, value);
    },
    getAttribute(name: string): string | null {
      return attrs.has(name) ? (attrs.get(name) as string) : null;
    },
    removeAttribute(name: string): void {
      attrs.delete(name);
    },
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

/** Minimal document stand-in resolving ids and option selectors. */
function fakeDoc(elements: Record<string, unknown>): Document {
  return {
    getElementById: (id: string): unknown =>
      id in elements ? elements[id] : null,
    querySelector: (selector: string): unknown =>
      selector in elements ? elements[selector] : null,
  } as unknown as Document;
}

describe("parseCosmetics", () => {
  it("falls back to cap/slit/cyan on empty or missing input", () => {
    expect(parseCosmetics(undefined)).toEqual(DEFAULT_COSMETICS);
    expect(parseCosmetics(null)).toEqual(DEFAULT_COSMETICS);
    expect(parseCosmetics({})).toEqual(DEFAULT_COSMETICS);
    expect(parseCosmetics("oops")).toEqual(DEFAULT_COSMETICS);
  });

  it("accepts the listed helmet/visor/palette values", () => {
    expect(
      parseCosmetics({ helmet: "beret", visor: "shade", palette: "#C084FC" }),
    ).toEqual({ helmet: "beret", visor: "shade", palette: "#C084FC" });
  });

  it("falls back per field on corrupt or mistyped values", () => {
    expect(
      parseCosmetics({ helmet: "tophat", visor: "shade", palette: 42 }),
    ).toEqual({ helmet: "cap", visor: "shade", palette: "#00E5FF" });
    expect(parseCosmetics({ helmet: " Beret " }).helmet).toBe("beret");
    expect(parseCosmetics({ palette: "#c084fc" }).palette).toBe("#C084FC");
    expect(parseCosmetics({ palette: "red" }).palette).toBe("#00E5FF");
  });
});

describe("loadCosmetics/saveCosmetics", () => {
  it("returns defaults when storage is empty or absent", () => {
    expect(loadCosmetics(fakeStorage())).toEqual(DEFAULT_COSMETICS);
    expect(loadCosmetics(null)).toEqual(DEFAULT_COSMETICS);
    expect(loadCosmetics(undefined)).toEqual(DEFAULT_COSMETICS);
  });

  it("saves one JSON object containing the helmet and visor picks", () => {
    const storage = fakeStorage();
    saveCosmetics(storage, {
      helmet: "beret",
      visor: "shade",
      palette: "#C084FC",
    });
    const raw = storage.getItem(COSMETICS_KEY) as string;
    expect(raw).toContain('"beret"');
    expect(raw).toContain('"shade"');
    expect(loadCosmetics(storage)).toEqual({
      helmet: "beret",
      visor: "shade",
      palette: "#C084FC",
    });
  });

  it("ignores corrupt stored JSON field by field", () => {
    expect(
      loadCosmetics(fakeStorage({ [COSMETICS_KEY]: "{oops" })),
    ).toEqual(DEFAULT_COSMETICS);
    expect(
      loadCosmetics(
        fakeStorage({
          [COSMETICS_KEY]: '{"helmet":"tophat","visor":"shade"}',
        }),
      ),
    ).toEqual({ helmet: "cap", visor: "shade", palette: "#00E5FF" });
  });

  it("is a no-op when storage is absent", () => {
    expect(() =>
      saveCosmetics(null, { ...DEFAULT_COSMETICS }),
    ).not.toThrow();
    expect(() =>
      saveCosmetics(undefined, { ...DEFAULT_COSMETICS }),
    ).not.toThrow();
  });
});

describe("enemyCosmeticsFor", () => {
  it("returns one pick per bot with listed ids", () => {
    const picks = enemyCosmeticsFor(1234, 3);
    expect(picks).toHaveLength(3);
    for (const pick of picks) {
      expect(HELMET_LIST).toContain(pick.helmet);
      expect(VISOR_LIST).toContain(pick.visor);
      expect(PALETTE_LIST).toContain(pick.palette);
    }
  });

  it("is deterministic for a fixed seed", () => {
    expect(enemyCosmeticsFor(1234, 3)).toEqual(enemyCosmeticsFor(1234, 3));
    expect(enemyCosmeticsFor(7, 5)).toEqual(enemyCosmeticsFor(7, 5));
  });

  it("always yields at least two distinct helmet+visor combos", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const picks = enemyCosmeticsFor(seed, 3);
      expect(picks).toHaveLength(3);
      const keys = new Set(picks.map((pick) => cosmeticKey(pick)));
      expect(keys.size).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns an empty array for a zero bot count", () => {
    expect(enemyCosmeticsFor(1234, 0)).toEqual([]);
  });
});

describe("bindSetup cosmetics", () => {
  it("prefills selects and the preview from storage", () => {
    const storage = fakeStorage();
    saveCosmetics(storage, {
      helmet: "beret",
      visor: "shade",
      palette: "#C084FC",
    });
    const helmet = fakeElement("cap");
    const visor = fakeElement("slit");
    const palette = fakeElement("#00E5FF");
    const preview = fakeElement();
    bindSetup(
      fakeDoc({
        "cos-helmet": helmet,
        "cos-visor": visor,
        "cos-palette": palette,
        "cosmetics-preview": preview,
      }),
      storage,
      () => {},
    );
    expect(helmet.value).toBe("beret");
    expect(visor.value).toBe("shade");
    expect(palette.value).toBe("#C084FC");
    expect(preview.getAttribute("data-helmet")).toBe("beret");
    expect(preview.getAttribute("data-visor")).toBe("shade");
    expect(preview.getAttribute("data-palette")).toBe("#C084FC");
  });

  it("persists select changes immediately as JSON", () => {
    const storage = fakeStorage();
    const helmet = fakeElement("cap");
    const visor = fakeElement("slit");
    bindSetup(
      fakeDoc({ "cos-helmet": helmet, "cos-visor": visor }),
      storage,
      () => {},
    );
    helmet.value = "beret";
    helmet.fire("change");
    visor.value = "shade";
    visor.fire("change");
    const raw = storage.getItem(COSMETICS_KEY) as string;
    expect(raw).toContain('"beret"');
    expect(raw).toContain('"shade"');
  });

  it("reloads the preview data-helmet from saved storage on show", () => {
    const storage = fakeStorage();
    saveCosmetics(storage, {
      helmet: "beret",
      visor: "shade",
      palette: "#C084FC",
    });
    const preview = fakeElement();
    const overlay = fakeElement();
    const binder = bindSetup(
      fakeDoc({ "cosmetics-preview": preview, setup: overlay }),
      storage,
      () => {},
    );
    preview.attrs.clear();
    binder.show();
    expect(preview.getAttribute("data-helmet")).toBe("beret");
  });

  it("still renders with a clickable Start on invalid storage JSON", () => {
    const storage = fakeStorage({ [COSMETICS_KEY]: "{oops" });
    const overlay = fakeElement();
    overlay.style.display = "none";
    const start = fakeElement();
    let started = 0;
    const binder = bindSetup(
      fakeDoc({ setup: overlay, "btn-start": start }),
      storage,
      () => {
        started += 1;
      },
    );
    expect(() => binder.show()).not.toThrow();
    expect(overlay.style.display).toBe("");
    expect(binder.cosmetics).toEqual(DEFAULT_COSMETICS);
    start.fire("click");
    expect(started).toBe(1);
    expect(overlay.style.display).toBe("none");
  });

  it("starts from either the canonical or the legacy Start id", () => {
    let canonical = 0;
    const modern = fakeElement();
    bindSetup(fakeDoc({ "btn-start": modern }), fakeStorage(), () => {
      canonical += 1;
    });
    modern.fire("click");
    expect(canonical).toBe(1);

    let legacy = 0;
    const old = fakeElement();
    bindSetup(fakeDoc({ start: old }), fakeStorage(), () => {
      legacy += 1;
    });
    old.fire("click");
    expect(legacy).toBe(1);
  });

  it("no-ops when every cosmetics node is missing", () => {
    const binder = bindSetup(fakeDoc({}), fakeStorage(), () => {});
    expect(() => binder.show()).not.toThrow();
    expect(() => binder.hide()).not.toThrow();
    expect(binder.cosmetics).toEqual(DEFAULT_COSMETICS);
  });
});
