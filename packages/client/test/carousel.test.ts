// Map carousel tests: card order/selection persistence, pressed-state
// sync, thumbnail op-stream distinctness, and binder no-throw on shorn
// docs. Fake-doc/fake-storage style mirroring setup.test.ts and
// menu-scene.test.ts (no jsdom).
import { describe, expect, it } from "vitest";
import { THEMES, themeFor } from "../src/view/theme";
import { tilePaintFor } from "../src/view/tiles";
import { MAP_LIST, loadSetup, saveSetup, type SetupStorage } from "../src/setup";
import {
  BEST_KEYS,
  CAROUSEL_ID,
  CAROUSEL_MAPS,
  THUMB_H,
  THUMB_W,
  bindCarousel,
  carouselConfigFor,
  ensureCarousel,
  formatBestLine,
  loadBestScore,
  loadBestScores,
  paintAllThumbnails,
  paintMapThumbnail,
  parseBestScore,
  parseCarouselMap,
  recordBestScore,
  refreshBestLines,
  selectCarouselMap,
} from "../src/menu/carousel";

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

/** Recording 2d context: every fillRect lands in ops with its style. */
interface PaintOp {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RecordingContext {
  fillStyle: string;
  ops: PaintOp[];
  fillRect(x: number, y: number, w: number, h: number): void;
}

function makeRecordingContext(): RecordingContext {
  const ctx: RecordingContext = {
    fillStyle: "",
    ops: [],
    fillRect(x: number, y: number, w: number, h: number): void {
      ctx.ops.push({ style: ctx.fillStyle, x, y, w, h });
    },
  };
  return ctx;
}

/** Minimal fake element with attrs, children, listeners, canvas ctx. */
interface FakeEl {
  id: string;
  tag: string;
  attrs: Map<string, string>;
  style: Record<string, string>;
  textContent: string | null;
  children: FakeEl[];
  width: number;
  height: number;
  ctx: RecordingContext | null;
  nullContext: boolean;
  listeners: Map<string, Array<() => void>>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  appendChild(kid: FakeEl): void;
  addEventListener(type: string, listener: () => void): void;
  click(): void;
  querySelector(sel: string): FakeEl | null;
}

function makeEl(tag: string, id = ""): FakeEl {
  const el: FakeEl = {
    id,
    tag,
    attrs: new Map<string, string>(),
    style: {},
    textContent: "",
    children: [],
    width: 0,
    height: 0,
    ctx: null,
    nullContext: false,
    listeners: new Map<string, Array<() => void>>(),
    setAttribute(k: string, v: string): void {
      el.attrs.set(k, v);
      if (k === "id") {
        el.id = v;
      }
    },
    getAttribute(k: string): string | null {
      if (k === "id") {
        return el.id === "" ? null : el.id;
      }
      return el.attrs.get(k) ?? null;
    },
    removeAttribute(k: string): void {
      el.attrs.delete(k);
    },
    appendChild(kid: FakeEl): void {
      el.children.push(kid);
    },
    addEventListener(type: string, listener: () => void): void {
      const list = el.listeners.get(type) ?? [];
      list.push(listener);
      el.listeners.set(type, list);
    },
    click(): void {
      for (const listener of el.listeners.get("click") ?? []) {
        listener();
      }
    },
    querySelector(sel: string): FakeEl | null {
      const visit = (root: FakeEl): FakeEl | null => {
        for (const kid of root.children) {
          if (sel === "canvas" || sel === "canvas.map-thumb") {
            if (kid.tag === "canvas") {
              return kid;
            }
          }
          const found = visit(kid);
          if (found !== null) {
            return found;
          }
        }
        return null;
      };
      return visit(el);
    },
  };
  if (id !== "") {
    el.attrs.set("id", id);
  }
  if (tag === "canvas") {
    (el as unknown as Record<string, unknown>)["getContext"] = (): RecordingContext | null => {
      if (el.nullContext) {
        return null;
      }
      if (el.ctx === null) {
        el.ctx = makeRecordingContext();
      }
      return el.ctx;
    };
  }
  return el;
}

/** All descendants of a root in document order. */
function descendants(root: FakeEl): FakeEl[] {
  const out: FakeEl[] = [];
  const visit = (node: FakeEl): void => {
    for (const kid of node.children) {
      out.push(kid);
      visit(kid);
    }
  };
  visit(root);
  return out;
}

interface FakeDocOpts {
  /** Omit #menu (binder must no-throw). */
  withMenu?: boolean;
  /** Return null from every canvas getContext. */
  nullContext?: boolean;
  /** Which legacy [data-map] button reads pressed. */
  legacyPressed?: string;
  /** Pre-seed a static carousel skeleton (mirrors index.html). */
  withSkeleton?: boolean;
}

function makeDoc(opts?: FakeDocOpts): { doc: unknown; els: Record<string, FakeEl> } {
  const withMenu = opts?.withMenu ?? true;
  const elements = new Map<string, FakeEl>();
  const els: Record<string, FakeEl> = {};
  const roots: FakeEl[] = [];

  if (withMenu) {
    const menu = makeEl("div", "menu");
    elements.set("menu", menu);
    els["menu"] = menu;
    roots.push(menu);
  }
  const setup = makeEl("div", "setup");
  elements.set("setup", setup);
  els["setup"] = setup;
  roots.push(setup);
  const legacyPressed = opts?.legacyPressed ?? "kilima";
  for (const name of MAP_LIST) {
    const button = makeEl("button");
    button.setAttribute("data-map", name);
    button.setAttribute(
      "aria-pressed",
      name === legacyPressed ? "true" : "false",
    );
    setup.appendChild(button);
  }

  const doc = {
    getElementById(id: string): FakeEl | null {
      const direct = elements.get(id) ?? null;
      if (direct !== null) {
        return direct;
      }
      for (const root of roots) {
        if (root.id === id) {
          return root;
        }
        for (const kid of descendants(root)) {
          if (kid.id === id) {
            return kid;
          }
        }
      }
      return null;
    },
    createElement(tag: string): FakeEl {
      const el = makeEl(tag);
      if (tag === "canvas" && opts?.nullContext === true) {
        el.nullContext = true;
      }
      return el;
    },
    querySelector(sel: string): FakeEl | null {
      const card = /^\[data-map-card="([^"]+)"\]$/.exec(sel);
      if (card !== null) {
        const name = card[1] as string;
        for (const root of roots) {
          for (const kid of [root, ...descendants(root)]) {
            if (kid.getAttribute("data-map-card") === name) {
              return kid;
            }
          }
        }
        return null;
      }
      const legacy = /^\[data-map="([^"]+)"\]$/.exec(sel);
      if (legacy !== null) {
        const name = legacy[1] as string;
        for (const kid of descendants(setup)) {
          if (kid.getAttribute("data-map") === name) {
            return kid;
          }
        }
        return null;
      }
      return null;
    },
    querySelectorAll(sel: string): FakeEl[] {
      if (sel === "[data-map-card]") {
        const out: FakeEl[] = [];
        for (const root of roots) {
          for (const kid of [root, ...descendants(root)]) {
            if (kid.getAttribute("data-map-card") !== null) {
              out.push(kid);
            }
          }
        }
        return out;
      }
      return [];
    },
  };
  // Register created carousels/cards back into the id table on append.
  for (const root of roots) {
    const orig = root.appendChild.bind(root);
    root.appendChild = (kid: FakeEl): void => {
      orig(kid);
      if (kid.id !== "") {
        elements.set(kid.id, kid);
      }
    };
  }
  if (opts?.withSkeleton === true && withMenu) {
    const menu = elements.get("menu") as FakeEl;
    const container = makeEl("div", CAROUSEL_ID);
    container.setAttribute("role", "listbox");
    for (const name of MAP_LIST) {
      const card = makeEl("button");
      card.setAttribute("data-map-card", name);
      const pressed = name === legacyPressed;
      card.setAttribute("aria-pressed", pressed ? "true" : "false");
      card.setAttribute("aria-selected", pressed ? "true" : "false");
      card.setAttribute("class", pressed ? "map-card selected" : "map-card");
      const thumb = makeEl("canvas");
      thumb.setAttribute("class", "map-thumb");
      thumb.width = THUMB_W;
      thumb.height = THUMB_H;
      if (opts?.nullContext === true) {
        thumb.nullContext = true;
      }
      card.appendChild(thumb);
      const label = makeEl("span");
      label.setAttribute("class", "map-name");
      label.textContent = name;
      card.appendChild(label);
      const best = makeEl("span");
      best.setAttribute("class", "map-best");
      best.textContent = "";
      card.appendChild(best);
      container.appendChild(card);
    }
    menu.appendChild(container);
  }
  return { doc, els };
}

/** Card class tokens via the class-attr fallback (no classList in fakes). */
function cardClasses(card: FakeEl): string[] {
  const raw = card.getAttribute("class") ?? "";
  return raw.split(/\s+/).filter((part) => part.length > 0);
}

/** Find a card's `.map-best` line by scanning children (no span selectors). */
function cardBest(card: FakeEl): FakeEl | null {
  for (const kid of card.children) {
    if (kid.getAttribute("class") === "map-best") {
      return kid;
    }
  }
  return null;
}

describe("carousel constants", () => {
  it("ships one card per arena in setup menu order", () => {
    expect(CAROUSEL_MAPS.slice()).toEqual(["kilima", "dune", "frostbite"]);
    expect(CAROUSEL_MAPS.slice()).toEqual(MAP_LIST.slice());
  });

  it("uses a 192x96 backing store (width >= 120px)", () => {
    expect(THUMB_W).toBe(192);
    expect(THUMB_H).toBe(96);
    expect(THUMB_W).toBeGreaterThanOrEqual(120);
  });

  it("parses map names tolerantly, falling back to kilima", () => {
    expect(parseCarouselMap(" DUNE ")).toBe("dune");
    expect(parseCarouselMap("frostbite")).toBe("frostbite");
    expect(parseCarouselMap("unknown-arena")).toBe("kilima");
    expect(parseCarouselMap(null)).toBe("kilima");
  });
});

describe("ensureCarousel", () => {
  it("builds one card per map, each holding a 192x96 canvas", () => {
    const { doc } = makeDoc();
    const container = ensureCarousel(doc as Document) as FakeEl | null;
    expect(container).not.toBeNull();
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.getAttribute("data-map-card"))).toEqual([
      "kilima",
      "dune",
      "frostbite",
    ]);
    for (const card of cards) {
      const canvas = card.querySelector("canvas");
      expect(canvas).not.toBeNull();
      expect(canvas?.width).toBe(192);
      expect(canvas?.height).toBe(96);
    }
  });

  it("is idempotent: a second call keeps a single container", () => {
    const { doc } = makeDoc();
    ensureCarousel(doc as Document);
    ensureCarousel(doc as Document);
    const found: FakeEl[] = [];
    const visit = (root: FakeEl): void => {
      for (const kid of root.children) {
        if (kid.id === CAROUSEL_ID) {
          found.push(kid);
        }
        visit(kid);
      }
    };
    visit((doc as { getElementById(id: string): FakeEl }).getElementById("menu"));
    expect(found).toHaveLength(1);
    expect(
      (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
        "[data-map-card]",
      ),
    ).toHaveLength(3);
  });

  it("returns null without throwing when #menu is missing", () => {
    const { doc } = makeDoc({ withMenu: false });
    expect(ensureCarousel(doc as Document)).toBeNull();
    expect(ensureCarousel({} as Document)).toBeNull();
  });
});

describe("paintMapThumbnail", () => {
  it("renders distinct op streams for two maps, both carrying the theme base", () => {
    const kilima = makeRecordingContext();
    paintMapThumbnail(kilima, "kilima", THUMB_W, THUMB_H);
    const dune = makeRecordingContext();
    paintMapThumbnail(dune, "dune", THUMB_W, THUMB_H);
    expect(kilima.ops.length).toBeGreaterThan(10);
    expect(dune.ops.length).toBeGreaterThan(10);
    expect(JSON.stringify(kilima.ops)).not.toBe(JSON.stringify(dune.ops));
    const kilimaBase = THEMES.kilima.base;
    const duneBase = THEMES.dune.base;
    expect(kilimaBase).not.toBe(duneBase);
    expect(kilima.ops.some((op) => op.style === kilimaBase)).toBe(true);
    expect(dune.ops.some((op) => op.style === duneBase)).toBe(true);
  });

  it("falls back to kilima for unknown maps and no-ops on bad dims", () => {
    const fallback = makeRecordingContext();
    paintMapThumbnail(fallback, "unknown-arena", THUMB_W, THUMB_H);
    const kilima = makeRecordingContext();
    paintMapThumbnail(kilima, "kilima", THUMB_W, THUMB_H);
    expect(JSON.stringify(fallback.ops)).toBe(JSON.stringify(kilima.ops));
    const bad = makeRecordingContext();
    paintMapThumbnail(bad, "kilima", Number.NaN, THUMB_H);
    paintMapThumbnail(bad, "kilima", 0, THUMB_H);
    paintMapThumbnail(null, "kilima", THUMB_W, THUMB_H);
    expect(bad.ops).toHaveLength(0);
  });

  it("paints one-way planks and bounce pads in the hazard fill, never the legacy fills", () => {
    for (const name of MAP_LIST) {
      const ctx = makeRecordingContext();
      paintMapThumbnail(ctx, name, THUMB_W, THUMB_H);
      const theme = themeFor(name);
      const onewayCss = tilePaintFor("oneway", theme).baseCss;
      const bounceCss = tilePaintFor("bounce", theme).baseCss;
      expect(onewayCss).toBe(THEMES[name].hazardCss);
      expect(bounceCss).toBe(THEMES[name].hazardCss);
      expect(ctx.ops.some((op) => op.style === onewayCss)).toBe(true);
      expect(ctx.ops.some((op) => op.style === bounceCss)).toBe(true);
      expect(ctx.ops.some((op) => op.style === THEMES[name].oneWay)).toBe(false);
      expect(ctx.ops.some((op) => op.style === THEMES[name].bounce)).toBe(false);
    }
  });
});

describe("paintAllThumbnails", () => {
  it("paints every card canvas and tolerates null contexts", () => {
    const { doc } = makeDoc({ withSkeleton: true });
    paintAllThumbnails(doc as Document);
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.querySelector("canvas")?.ctx?.ops.length ?? 0).toBeGreaterThan(10);
    }
    const { doc: nullDoc } = makeDoc({
      withSkeleton: true,
      nullContext: true,
    });
    expect(() => paintAllThumbnails(nullDoc as Document)).not.toThrow();
    expect(() => paintAllThumbnails({} as Document)).not.toThrow();
  });
});

describe("carousel selection", () => {
  it("persists the selected map and syncs pressed states across cards and legacy buttons", () => {
    const { doc } = makeDoc({ withSkeleton: true });
    const storage = fakeStorage();
    const picked = selectCarouselMap(doc as Document, storage, "dune");
    expect(picked).toBe("dune");
    expect(loadSetup(storage).map).toBe("dune");
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    for (const card of cards) {
      const active = card.getAttribute("data-map-card") === "dune";
      expect(card.getAttribute("aria-pressed")).toBe(active ? "true" : "false");
    }
    const duneLegacy = (
      doc as { querySelector(sel: string): FakeEl | null }
    ).querySelector('[data-map="dune"]');
    const kilimaLegacy = (
      doc as { querySelector(sel: string): FakeEl | null }
    ).querySelector('[data-map="kilima"]');
    expect(duneLegacy?.getAttribute("aria-pressed")).toBe("true");
    expect(kilimaLegacy?.getAttribute("aria-pressed")).toBe("false");
  });

  it("reads the pressed card first, storage second", () => {
    const { doc } = makeDoc({ withSkeleton: true, legacyPressed: "frostbite" });
    const storage = fakeStorage();
    selectCarouselMap(doc as Document, storage, "dune");
    expect(carouselConfigFor(doc as Document, storage).map).toBe("dune");
  });
});

describe("bindCarousel", () => {
  it("clicking the second card persists its map id for Quick Play", () => {
    const { doc } = makeDoc();
    const storage = fakeStorage();
    const binder = bindCarousel(doc as Document, storage);
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    expect(cards).toHaveLength(3);
    cards[1]?.click();
    expect(loadSetup(storage).map).toBe(CAROUSEL_MAPS[1]);
    expect(binder.config.map).toBe(CAROUSEL_MAPS[1]);
    expect(cards[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(cards[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(() => binder.refresh()).not.toThrow();
    expect(() => binder.stop()).not.toThrow();
  });

  it("binds once: re-binding does not duplicate click handlers", () => {
    const { doc } = makeDoc();
    const storage = fakeStorage();
    bindCarousel(doc as Document, storage);
    bindCarousel(doc as Document, storage);
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    for (const card of cards) {
      expect(card.listeners.get("click") ?? []).toHaveLength(1);
    }
  });

  it("boot keeps the stored map when the static skeleton disagrees", () => {
    // Static skeleton ships kilima-pressed; storage already holds dune.
    const { doc } = makeDoc({ withSkeleton: true, legacyPressed: "kilima" });
    const storage = fakeStorage();
    saveSetup(storage, { ...loadSetup(storage), map: "dune" });
    const binder = bindCarousel(doc as Document, storage);
    expect(binder.config.map).toBe("dune");
    expect(loadSetup(storage).map).toBe("dune");
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    for (const card of cards) {
      const active = card.getAttribute("data-map-card") === "dune";
      expect(card.getAttribute("aria-pressed")).toBe(active ? "true" : "false");
    }
  });

  it("no-throws on empty and shorn docs", () => {
    const storage = fakeStorage();
    expect(() => bindCarousel({} as Document, storage)).not.toThrow();
    const { doc } = makeDoc({ withMenu: false });
    expect(() => bindCarousel(doc as Document, storage)).not.toThrow();
    const { doc: nullDoc } = makeDoc({
      withSkeleton: true,
      nullContext: true,
    });
    expect(() => bindCarousel(nullDoc as Document, storage)).not.toThrow();
  });
});

describe("carousel selected state", () => {
  it("clicking the second card selects only it (class-attr fallback)", () => {
    const { doc } = makeDoc({ withSkeleton: true });
    const storage = fakeStorage();
    bindCarousel(doc as Document, storage);
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    cards[1]?.click();
    expect(cards[1]?.getAttribute("aria-selected")).toBe("true");
    expect(cards[0]?.getAttribute("aria-selected")).toBe("false");
    expect(cards[2]?.getAttribute("aria-selected")).toBe("false");
    for (const [index, card] of cards.entries()) {
      const classes = cardClasses(card as FakeEl);
      expect(classes.includes("map-card")).toBe(true);
      expect(classes.includes("selected")).toBe(index === 1);
    }
  });

  it("selectCarouselMap syncs the selected class exclusively", () => {
    const { doc } = makeDoc({ withSkeleton: true });
    const storage = fakeStorage();
    selectCarouselMap(doc as Document, storage, "frostbite");
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    for (const card of cards) {
      const active = card.getAttribute("data-map-card") === "frostbite";
      expect(cardClasses(card as FakeEl).includes("selected")).toBe(active);
    }
  });

  it("binder boot repaints the stored selection as selected", () => {
    const { doc } = makeDoc({ withSkeleton: true, legacyPressed: "kilima" });
    const storage = fakeStorage();
    saveSetup(storage, { ...loadSetup(storage), map: "dune" });
    bindCarousel(doc as Document, storage);
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    for (const card of cards) {
      const active = card.getAttribute("data-map-card") === "dune";
      expect(cardClasses(card as FakeEl).includes("selected")).toBe(active);
    }
  });
});

describe("carousel best scores", () => {
  it("parses finite numbers and numeric strings, rejecting corrupt values", () => {
    expect(parseBestScore(7)).toBe(7);
    expect(parseBestScore(7.9)).toBe(7);
    expect(parseBestScore(" 12 ")).toBe(12);
    expect(parseBestScore(-1)).toBeNull();
    expect(parseBestScore(Number.NaN)).toBeNull();
    expect(parseBestScore("many")).toBeNull();
    expect(parseBestScore("")).toBeNull();
    expect(parseBestScore(null)).toBeNull();
  });

  it("formats the exact `Best: N` line, empty when absent", () => {
    expect(formatBestLine(25)).toBe("Best: 25");
    expect(formatBestLine("3")).toBe("Best: 3");
    expect(formatBestLine(null)).toBe("");
    expect(formatBestLine("corrupt")).toBe("");
  });

  it("recordBestScore keeps the max and persists canonical JSON", () => {
    const storage = fakeStorage();
    expect(recordBestScore(storage, "dune", 5)).toBe(5);
    expect(recordBestScore(storage, "dune", 3)).toBe(5);
    expect(recordBestScore(storage, "dune", 9)).toBe(9);
    expect(loadBestScore(storage, "dune")).toBe(9);
    expect(loadBestScore(storage, "kilima")).toBeNull();
    const raw = JSON.parse(
      (storage.getItem(BEST_KEYS.canonical) ?? "{}") as string,
    ) as Record<string, number>;
    expect(raw["dune"]).toBe(9);
  });

  it("tolerates corrupt canonical and legacy JSON plus per-map strings", () => {
    const storage = fakeStorage();
    storage.setItem(BEST_KEYS.canonical, "{not json");
    storage.setItem(BEST_KEYS.legacy, JSON.stringify({ frostbite: 4 }));
    storage.setItem(BEST_KEYS.perMap("kilima"), "6");
    storage.setItem(BEST_KEYS.perMap("dune"), "bogus");
    const bests = loadBestScores(storage);
    expect(bests).toEqual({ kilima: 6, dune: null, frostbite: 4 });
    expect(loadBestScore(storage, "unknown-arena")).toBeNull();
    expect(recordBestScore(storage, "unknown-arena", 3)).toBeNull();
    expect(() => loadBestScores(null)).not.toThrow();
  });

  it("renders stored bests as `Best: <digits>` and reserves empty lines", () => {
    const { doc } = makeDoc({ withSkeleton: true });
    const storage = fakeStorage();
    recordBestScore(storage, "dune", 25);
    refreshBestLines(doc as Document, storage);
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    for (const card of cards) {
      const line = cardBest(card as FakeEl)?.textContent ?? null;
      if (card.getAttribute("data-map-card") === "dune") {
        expect(line).toMatch(/^Best: \d+$/);
      } else {
        expect(line).toBe("");
      }
    }
    // Refresh repaints storage changes without rebinding.
    recordBestScore(storage, "kilima", 11);
    const binder = bindCarousel(doc as Document, storage);
    expect(() => binder.refresh()).not.toThrow();
    const kilima = (
      doc as { querySelector(sel: string): FakeEl | null }
    ).querySelector('[data-map-card="kilima"]');
    expect(kilima === null ? null : cardBest(kilima)?.textContent).toBe(
      "Best: 11",
    );
  });

  it("ensureCarousel builds a `.map-best` line per card", () => {
    const { doc } = makeDoc();
    ensureCarousel(doc as Document);
    const cards = (doc as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      "[data-map-card]",
    );
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(cardBest(card as FakeEl)).not.toBeNull();
    }
  });
});
