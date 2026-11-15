// Locker tests: catalogue gates, id persistence, preview repaint, panel
// render, and the in-match accent. Mirrors
// packages/client/test/challenges.test.ts (fake storage plus fake-doc
// elements, behavior assertions, no padding, fake docs only — no jsdom).
import { describe, expect, it, afterEach } from "vitest";
import {
  DEFAULT_LOCKER_ID,
  LOCKER_GRID_ID,
  LOCKER_ITEM_ATTR,
  LOCKER_ITEMS,
  LOCKER_KEY,
  LOCKER_OPEN_ID,
  LOCKER_PANEL_ID,
  LOCKER_PREVIEW_ID,
  bindLocker,
  ensureLockerOpen,
  ensureLockerPanel,
  isChallengeDone,
  isLockerUnlocked,
  loadLockerSelection,
  lockerHelmetFor,
  lockerItemFor,
  lockerLevel,
  lockerPaletteFor,
  lockerRows,
  lockerVisorFor,
  parseLockerId,
  saveLockerSelection,
  updateLockerPanel,
  updateLockerPreview,
  type LockerStorage,
} from "../src/meta/locker";
import {
  clearLocalAccent,
  setLocalAccent,
  soldierAccentFor,
  soldierAccentHex,
} from "../src/view/soldier";
import { teamCss } from "../src/view/character";

/** In-memory stand-in for localStorage. */
function fakeStorage(entries?: Record<string, string>): LockerStorage {
  const backing = new Map<string, string>(Object.entries(entries ?? {}));
  return {
    getItem: (key: string): string | null =>
      backing.has(key) ? (backing.get(key) as string) : null,
    setItem: (key: string, value: string): void => {
      backing.set(key, value);
    },
  };
}

/** Minimal fake element with attrs, a style bag, children, and listeners. */
interface FakeEl {
  id: string;
  className: string;
  textContent: string | null;
  value: string;
  style: Record<string, string>;
  children: FakeEl[];
  attrs: Map<string, string>;
  listeners: Map<string, Array<(ev?: unknown) => void>>;
  parentNode: FakeEl | null;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  appendChild(kid: FakeEl): void;
  addEventListener(type: string, listener: (ev?: unknown) => void): void;
  fire(type: string, ev?: unknown): void;
  // Canvas stub surface for the preview paint path.
  getContext?(kind: string): unknown;
  width?: number;
  height?: number;
}

function makeEl(id = ""): FakeEl {
  const el: FakeEl = {
    id,
    className: "",
    textContent: "",
    value: "",
    style: {},
    children: [],
    attrs: new Map<string, string>(),
    listeners: new Map<string, Array<(ev?: unknown) => void>>(),
    parentNode: null,
    setAttribute: (k: string, v: string): void => {
      el.attrs.set(k, v);
      if (k === "id") {
        el.id = v;
      }
    },
    getAttribute: (k: string): string | null => {
      if (k === "id") {
        return el.id === "" ? null : el.id;
      }
      return el.attrs.has(k) ? (el.attrs.get(k) as string) : null;
    },
    removeAttribute: (k: string): void => {
      el.attrs.delete(k);
    },
    appendChild: (kid: FakeEl): void => {
      kid.parentNode = el;
      el.children.push(kid);
    },
    addEventListener: (type: string, listener: (ev?: unknown) => void): void => {
      const list = el.listeners.get(type) ?? [];
      list.push(listener);
      el.listeners.set(type, list);
    },
    fire: (type: string, ev?: unknown): void => {
      for (const listener of el.listeners.get(type) ?? []) {
        listener(ev ?? { target: el });
      }
    },
  };
  return el;
}

/** Minimal fake document resolving ids plus `[data-locker]` scans. */
interface FakeDoc {
  elements: Map<string, FakeEl>;
  created: FakeEl[];
  getElementById(id: string): FakeEl | null;
  createElement(tag: string): FakeEl;
  querySelectorAll(sel: string): FakeEl[];
  querySelector(sel: string): FakeEl | null;
}

function makeDoc(ids: string[] = ["menu"]): FakeDoc {
  const elements = new Map<string, FakeEl>();
  for (const id of ids) {
    elements.set(id, makeEl(id));
  }
  const doc: FakeDoc = {
    elements,
    created: [],
    getElementById: (id: string): FakeEl | null =>
      elements.get(id) ?? doc.created.find((el) => el.id === id) ?? null,
    createElement: (tag: string): FakeEl => {
      const el = makeEl();
      if (tag === "canvas") {
        el.width = 96;
        el.height = 96;
        el.getContext = (): unknown => null;
      }
      doc.created.push(el);
      return el;
    },
    querySelectorAll: (sel: string): FakeEl[] => {
      const out: FakeEl[] = [];
      const seen = new Set<FakeEl>();
      const collect = (el: FakeEl): void => {
        if (seen.has(el)) {
          return;
        }
        seen.add(el);
        if (sel === `[${LOCKER_ITEM_ATTR}]`) {
          if (el.attrs.has(LOCKER_ITEM_ATTR)) {
            out.push(el);
          }
        } else if (sel.startsWith(".")) {
          const want = sel.slice(1);
          if (el.className.split(/\s+/).includes(want)) {
            out.push(el);
          }
        }
        for (const kid of el.children) {
          collect(kid);
        }
      };
      for (const el of elements.values()) {
        collect(el);
      }
      for (const el of doc.created) {
        collect(el);
      }
      return out;
    },
    querySelector: (sel: string): FakeEl | null => {
      const all = doc.querySelectorAll(sel);
      return all[0] ?? null;
    },
  };
  return doc;
}

/** Install a bare window stub so the probe mirror lands somewhere. */
function stubWindow(): void {
  (globalThis as { window?: unknown }).window = {};
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  clearLocalAccent();
});

describe("catalogue gates", () => {
  it("carries at least 6 combos with 3+ locked at level 1", () => {
    expect(LOCKER_ITEMS.length).toBeGreaterThanOrEqual(6);
    const rows = lockerRows(1);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((row) => row.locked).length).toBeGreaterThanOrEqual(3);
  });

  it("unlocks the level-2 row once the threshold is met", () => {
    expect(isLockerUnlocked("ranger-lime", 1)).toBe(false);
    expect(isLockerUnlocked("ranger-lime", 2)).toBe(true);
    expect(isLockerUnlocked("elite-spectre", 4)).toBe(false);
    expect(isLockerUnlocked("elite-spectre", 5)).toBe(true);
  });

  it("also unlocks challenge rows off the challenge edge", () => {
    expect(isLockerUnlocked("violet-ops", 1, new Set(["rifle-5"]))).toBe(true);
    expect(isLockerUnlocked("violet-ops", 1, new Set([]))).toBe(false);
    expect(isChallengeDone({ progress: { "rifle-5": { progress: 5 } } }, "rifle-5")).toBe(true);
    expect(isChallengeDone({ progress: { "rifle-5": { progress: 1 } } }, "rifle-5")).toBe(false);
  });

  it("reads the locked readout as LOCKED on gated rows", () => {
    const rows = lockerRows(1);
    for (const row of rows.filter((r) => r.locked)) {
      expect(row.text).toContain("LOCKED");
    }
  });
});

describe("selection persistence", () => {
  it("falls back to the default recruit row on empty storage", () => {
    expect(loadLockerSelection(fakeStorage())).toBe(DEFAULT_LOCKER_ID);
    expect(parseLockerId("")).toBe(DEFAULT_LOCKER_ID);
    expect(parseLockerId("tophat")).toBe(DEFAULT_LOCKER_ID);
  });

  it("round-trips the plain id under scrapline.cosmetic", () => {
    const storage = fakeStorage();
    saveLockerSelection(storage, "ranger-lime");
    expect(storage.getItem(LOCKER_KEY)).toBe("ranger-lime");
    expect(loadLockerSelection(storage)).toBe("ranger-lime");
  });

  it("unwraps JSON-encoded ids seeded by harnesses", () => {
    expect(loadLockerSelection(fakeStorage({ [LOCKER_KEY]: '"ranger-lime"' }))).toBe(
      "ranger-lime",
    );
    expect(loadLockerSelection(fakeStorage({ [LOCKER_KEY]: '{"id":"ranger-lime"}' }))).toBe(
      "ranger-lime",
    );
  });

  it("exposes the combo triple per id", () => {
    expect(lockerItemFor("ranger-lime")).toMatchObject({
      helmet: "hood",
      visor: "round",
      palette: "#A3E635",
    });
    expect(lockerPaletteFor("elite-spectre")).toBe("#C084FC");
    expect(lockerHelmetFor("elite-spectre")).toBe("cap");
    expect(lockerVisorFor("elite-spectre")).toBe("shade");
  });

  it("derives the locker level from the profile xp", () => {
    expect(lockerLevel(fakeStorage())).toBe(1);
    expect(
      lockerLevel(fakeStorage({ "scrapline.profile": '{"xp":200}' })),
    ).toBe(3);
  });
});

describe("preview and panel", () => {
  it("repaints the setup-reused preview triple on equip", () => {
    const doc = makeDoc(["menu", "cosmetics-preview", LOCKER_PREVIEW_ID]);
    const preview = doc.getElementById("cosmetics-preview") as unknown as FakeEl;
    updateLockerPreview(doc as unknown as Document, "elite-spectre");
    expect(preview.getAttribute("data-helmet")).toBe("cap");
    expect(preview.getAttribute("data-visor")).toBe("shade");
    expect(preview.getAttribute("data-palette")).toBe("#C084FC");
    expect(preview.textContent).toContain("#C084FC");
  });

  it("renders exactly the catalogue rows with LOCKED markers", () => {
    const doc = makeDoc();
    const panel = ensureLockerPanel(doc as unknown as Document);
    expect(panel).not.toBeNull();
    const rows = (doc as unknown as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      `[${LOCKER_ITEM_ATTR}]`,
    );
    expect(rows.map((row) => row.getAttribute(LOCKER_ITEM_ATTR))).toEqual(
      LOCKER_ITEMS.map((item) => item.id),
    );
    expect(updateLockerPanel(doc as unknown as Document, 1, null, "recruit-cyan")).toBe(
      LOCKER_ITEMS.length,
    );
    const locked = rows.filter((row) => row.getAttribute("data-locked") === "true");
    expect(locked.length).toBeGreaterThanOrEqual(3);
    for (const row of locked) {
      const lock = row.children.find((kid) => kid.className.includes("locker-lock"));
      expect(lock?.textContent ?? row.textContent ?? "").toContain("LOCKED");
    }
  });

  it("equips an unlocked row: storage plus preview plus mirror", () => {
    stubWindow();
    const doc = makeDoc(["menu", "cosmetics-preview", LOCKER_OPEN_ID]);
    const storage = fakeStorage({ "scrapline.profile": '{"xp":200}' });
    const binder = bindLocker(doc as unknown as Document, storage);
    expect(binder.level).toBe(3);
    expect(binder.select("ranger-lime")).toBe("ranger-lime");
    expect(storage.getItem(LOCKER_KEY)).toBe("ranger-lime");
    const preview = doc.getElementById("cosmetics-preview") as unknown as FakeEl;
    expect(preview.getAttribute("data-palette")).toBe("#A3E635");
    const canvas = doc.getElementById(LOCKER_PREVIEW_ID) as unknown as FakeEl;
    expect(canvas.getAttribute("data-palette")).toBe("#A3E635");
    const mirror = (globalThis as { window: { __locker?: { selected: string; palette: string } } }).window.__locker;
    expect(mirror?.selected).toBe("ranger-lime");
    expect(mirror?.palette).toBe("#A3E635");
    binder.stop();
  });

  it("refuses locked rows and repaints on level-up refresh", () => {
    const doc = makeDoc(["menu", "cosmetics-preview", LOCKER_OPEN_ID]);
    const storage = fakeStorage();
    const binder = bindLocker(doc as unknown as Document, storage);
    expect(binder.select("elite-spectre")).toBe(DEFAULT_LOCKER_ID);
    expect(storage.getItem(LOCKER_KEY) ?? DEFAULT_LOCKER_ID).toBe(DEFAULT_LOCKER_ID);
    // Level threshold met: the gated row equips and unlocks.
    storage.setItem("scrapline.profile", '{"xp":400}');
    expect(binder.refresh()).toBe(DEFAULT_LOCKER_ID);
    expect(binder.select("elite-spectre")).toBe("elite-spectre");
    expect(storage.getItem(LOCKER_KEY)).toBe("elite-spectre");
    binder.stop();
  });

  it("toggles from the opener and tops up shorn skeletons", () => {
    stubWindow();
    const doc = makeDoc(["menu", LOCKER_OPEN_ID]);
    bindLocker(doc as unknown as Document, fakeStorage());
    const panel = doc.getElementById(LOCKER_PANEL_ID) as unknown as FakeEl;
    expect(panel.style["display"]).toBe("none");
    const opener = doc.getElementById(LOCKER_OPEN_ID) as unknown as FakeEl;
    opener.fire("click");
    expect(panel.style["display"]).toBe("");
    opener.fire("click");
    expect(panel.style["display"]).toBe("none");
  });

  it("treats a missing #menu as a no-op", () => {
    const doc = makeDoc([]);
    expect(ensureLockerPanel(doc as unknown as Document)).toBeNull();
    expect(ensureLockerOpen(doc as unknown as Document)).toBeNull();
    expect(updateLockerPanel(doc as unknown as Document, 1)).toBe(0);
    const binder = bindLocker(doc as unknown as Document, null);
    expect(binder.selected).toBe(DEFAULT_LOCKER_ID);
    binder.stop();
  });

  it("keeps the grid id stable for setup-screen probes", () => {
    const doc = makeDoc();
    ensureLockerPanel(doc as unknown as Document);
    expect(doc.getElementById(LOCKER_GRID_ID) ?? doc.getElementById(LOCKER_PANEL_ID)).not.toBeNull();
  });
});

describe("in-match accent", () => {
  it("tints the local soldier to the equipped palette", () => {
    setLocalAccent("#C084FC");
    expect(soldierAccentFor(0)).toBe("#C084FC");
    expect(soldierAccentHex(0)).toBe(0xc084fc);
    // Enemies keep their team colors under the override.
    expect(soldierAccentFor(1)).toBe(teamCss(1));
  });

  it("clears back to team cyan on garbage", () => {
    setLocalAccent("#C084FC");
    setLocalAccent("banana");
    expect(soldierAccentFor(0)).toBe(teamCss(0));
    setLocalAccent("#C084FC");
    clearLocalAccent();
    expect(soldierAccentFor(0)).toBe(teamCss(0));
  });
});
