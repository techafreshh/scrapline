// Animated menu scene tests: hover-loop amplitude, chip text, live
// config reads, and DOM binder behavior. Pure helpers plus fake-doc
// binders (no jsdom), mirroring setup.test.ts/nametags.test.ts style.
import { describe, expect, it } from "vitest";
import { MATCH_SCORE_LIMIT } from "../../core/src/constants";
import { backdropPaletteFor } from "../src/view/backdrop";
import { soldierAccentFor } from "../src/view/soldier";
import {
  MENU_CHIP_ID,
  MENU_FLAME_ID,
  MENU_HOVER_AMPLITUDE_PX,
  MENU_HOVER_PERIOD_MS,
  MENU_SCENE_ID,
  MENU_SOLDIER_ID,
  bindMenuScene,
  ensureMenuScene,
  ensureQuickPlayChip,
  formatQuickPlaySummary,
  isMenuVisible,
  menuHoverOffsetY,
  menuSoldierScreenY,
  menuTimeMinutes,
  readMenuConfig,
  updateQuickPlayChip,
  type SetupStorage,
} from "../src/menu/scene";

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

/** Minimal fake element with attrs, style bag, children, text. */
interface FakeEl {
  id: string;
  tag: string;
  attrs: Map<string, string>;
  style: Record<string, string>;
  textContent: string | null;
  children: FakeEl[];
  parent: FakeEl | null;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(kid: FakeEl): void;
}

function makeEl(tag: string, id = ""): FakeEl {
  const el: FakeEl = {
    id,
    tag,
    attrs: new Map<string, string>(),
    style: {},
    textContent: "",
    children: [],
    parent: null,
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
    appendChild(kid: FakeEl): void {
      kid.parent = el;
      el.children.push(kid);
    },
  };
  if (id !== "") {
    el.attrs.set("id", id);
  }
  return el;
}



function makeDoc(opts?: {
  botsText?: string | null;
  tierPressed?: string;
  mapPressed?: string;
  withMenu?: boolean;
  withPlay?: boolean;
  menuDisplay?: string;
}): { doc: unknown; els: Record<string, FakeEl> } {
  const elements = new Map<string, FakeEl>();
  const els: Record<string, FakeEl> = {};
  const menu = makeEl("div", "menu");
  menu.style["display"] = opts?.menuDisplay ?? "";
  elements.set("menu", menu);
  els["menu"] = menu;
  const play = makeEl("button", "quick-play");
  elements.set("quick-play", play);
  els["quick-play"] = play;
  if (opts?.botsText !== undefined && opts.botsText !== null) {
    const bots = makeEl("span", "bots-value");
    bots.textContent = opts.botsText;
    elements.set("bots-value", bots);
    els["bots-value"] = bots;
  }
  const tierPressed = opts?.tierPressed ?? "normal";
  const mapPressed = opts?.mapPressed ?? "kilima";
  const doc = {
    elements,
    getElementById(id: string): FakeEl | null {
      const direct = elements.get(id) ?? null;
      if (direct !== null) {
        return direct;
      }
      // Deep search: scene children (soldier/flame) attach under
      // #menu, not the id table, mirroring real-DOM subtree lookup.
      const visit = (root: FakeEl): FakeEl | null => {
        if (root.id === id) {
          return root;
        }
        for (const kid of root.children) {
          const found = visit(kid);
          if (found !== null) {
            return found;
          }
        }
        return null;
      };
      for (const root of elements.values()) {
        const found = visit(root);
        if (found !== null) {
          return found;
        }
      }
      return null;
    },
    createElement(tag: string): FakeEl {
      const el = makeEl(tag);
      return el;
    },
    querySelector(sel: string): FakeEl | null {
      const tier = /^(\[data-tier="([^"]+)"\])$/.exec(sel);
      if (tier !== null) {
        const name = tier[2] as string;
        const el = makeEl("button");
        el.setAttribute("data-tier", name);
        el.setAttribute(
          "aria-pressed",
          name === tierPressed ? "true" : "false",
        );
        return el;
      }
      const map = /^(\[data-map="([^"]+)"\])$/.exec(sel);
      if (map !== null) {
        const name = map[2] as string;
        const el = makeEl("button");
        el.setAttribute("data-map", name);
        el.setAttribute(
          "aria-pressed",
          name === mapPressed ? "true" : "false",
        );
        return el;
      }
      return null;
    },
  };
  // Register created chips/scenes back into the id table on append.
  const register = (root: FakeEl): void => {
    const orig = root.appendChild.bind(root);
    root.appendChild = (kid: FakeEl): void => {
      orig(kid);
      if (kid.id !== "") {
        elements.set(kid.id, kid);
      }
      for (const child of kid.children) {
        if (child.id !== "") {
          elements.set(child.id, child);
        }
      }
    };
  };
  register(menu);
  register(play);
  return { doc, els };
}

describe("hover loop", () => {
  it("pins amplitude and period constants", () => {
    expect(MENU_HOVER_AMPLITUDE_PX).toBe(14);
    expect(MENU_HOVER_PERIOD_MS).toBe(2000);
  });

  it("differs by >= 6px between t=0 and t=1.5s", () => {
    const a = menuHoverOffsetY(0);
    const b = menuHoverOffsetY(1500);
    expect(Math.abs(b - a)).toBeGreaterThanOrEqual(6);
  });

  it("loops with the configured period", () => {
    expect(menuHoverOffsetY(0)).toBeCloseTo(menuHoverOffsetY(2000), 10);
    expect(menuHoverOffsetY(500)).toBeCloseTo(menuHoverOffsetY(2500), 10);
  });

  it("reads 0 for non-finite clocks, never NaN", () => {
    expect(menuHoverOffsetY(Number.NaN)).toBe(0);
    expect(menuHoverOffsetY(undefined)).toBe(0);
    expect(menuHoverOffsetY("fast")).toBe(0);
  });

  it("offsets a rest y by the loop value", () => {
    expect(menuSoldierScreenY(100, 0)).toBeCloseTo(100, 10);
    expect(menuSoldierScreenY(100, 1500)).toBeCloseTo(
      100 + menuHoverOffsetY(1500),
      10,
    );
  });
});

describe("chip text", () => {
  it("mentions 5 bots and 25 for the bots=5 target=25 setup", () => {
    const text = formatQuickPlaySummary({ bots: 5, tier: "normal", map: "kilima" });
    expect(text).toContain("5 bots");
    expect(text).toContain("25");
  });

  it("matches the reference shape with middle dots", () => {
    const text = formatQuickPlaySummary({ bots: 3, tier: "normal", map: "kilima" });
    expect(text).toContain("3 bots");
    expect(text).toContain("normal");
    expect(text).toContain("first to 25");
    expect(text).toContain("5 min");
    expect(text).toContain("·");
  });

  it("pluralizes the single bot", () => {
    expect(
      formatQuickPlaySummary({ bots: 1, tier: "easy", map: "dune" }),
    ).toContain("1 bot");
    expect(
      formatQuickPlaySummary({ bots: 1, tier: "easy", map: "dune" }),
    ).not.toContain("1 bots");
  });

  it("derives time from the sim limit and defaults the score", () => {
    expect(menuTimeMinutes()).toBe(5);
    expect(MATCH_SCORE_LIMIT).toBe(25);
  });
});

describe("readMenuConfig", () => {
  it("reads storage defaults when the overlay is absent", () => {
    const { doc } = makeDoc({ botsText: null, tierPressed: "hard", mapPressed: "dune" });
    const storage = fakeStorage({
      "scrapline.setup.bots": "5",
      "scrapline.setup.tier": "hard",
      "scrapline.setup.map": "dune",
    });
    expect(readMenuConfig(doc as unknown as Document, storage)).toEqual({
      bots: 5,
      tier: "hard",
      map: "dune",
    });
  });

  it("prefers the live stepper readout and pressed buttons", () => {
    const { doc } = makeDoc({
      botsText: "5",
      tierPressed: "elite",
      mapPressed: "frostbite",
    });
    const storage = fakeStorage();
    expect(readMenuConfig(doc as unknown as Document, storage)).toEqual({
      bots: 5,
      tier: "elite",
      map: "frostbite",
    });
  });

  it("ignores out-of-range stepper text field by field", () => {
    const { doc } = makeDoc({ botsText: "99", tierPressed: "hard" });
    const storage = fakeStorage({
      "scrapline.setup.bots": "5",
      "scrapline.setup.tier": "normal",
      "scrapline.setup.map": "kilima",
    });
    const config = readMenuConfig(doc as unknown as Document, storage);
    expect(config.bots).toBe(5);
    expect(config.tier).toBe("hard");
  });
});

describe("chip binder", () => {
  it("creates the chip inside #quick-play and paints live text", () => {
    const { doc } = makeDoc({ botsText: "5", tierPressed: "normal" });
    const chip = ensureQuickPlayChip(doc as unknown as Document);
    expect(chip).not.toBeNull();
    const text = updateQuickPlayChip(
      doc as unknown as Document,
      { bots: 5, tier: "normal", map: "kilima" },
    );
    expect(text).toContain("5 bots");
    expect(text).toContain("25");
    const again = ensureQuickPlayChip(doc as unknown as Document);
    expect(again).toBe(chip);
    const stored = (chip as FakeEl).textContent ?? "";
    expect(stored).toContain("5 bots");
    expect(MENU_CHIP_ID).toBe("quick-play-chip");
  });

  it("reflects a 3 -> 5 bots change on refresh", () => {
    const harness = makeDoc({ botsText: "3", tierPressed: "normal" });
    const before = updateQuickPlayChip(
      harness.doc as unknown as Document,
      { bots: 3, tier: "normal", map: "kilima" },
    );
    expect(before).toContain("3 bots");
    (harness.els["bots-value"] as FakeEl).textContent = "5";
    const after = updateQuickPlayChip(
      harness.doc as unknown as Document,
      readMenuConfig(harness.doc as unknown as Document, fakeStorage()),
    );
    expect(after).toContain("5 bots");
  });

  it("bindMenuScene refreshes the chip and stops cleanly", () => {
    const harness = makeDoc({ botsText: "5", tierPressed: "hard" });
    const binder = bindMenuScene(
      harness.doc as unknown as Document,
      fakeStorage(),
    );
    try {
      const text = binder.refresh();
      expect(text).toContain("5 bots");
      expect(binder.config.bots).toBe(5);
    } finally {
      binder.stop();
    }
  });
});

describe("scene DOM", () => {
  it("builds the scene, soldier, and flame ids idempotently", () => {
    const { doc } = makeDoc({});
    const first = ensureMenuScene(doc as unknown as Document, "kilima");
    expect(first).not.toBeNull();
    const second = ensureMenuScene(doc as unknown as Document, "kilima");
    expect(second).toBe(first);
    const byId = (id: string): FakeEl | null =>
      (doc as unknown as { getElementById(id: string): FakeEl | null }).getElementById(id);
    expect(byId(MENU_SCENE_ID)).not.toBeNull();
    expect(byId(MENU_SOLDIER_ID)).not.toBeNull();
    expect(byId(MENU_FLAME_ID)).not.toBeNull();
  });

  it("detects menu visibility from the inline display", () => {
    const shown = makeDoc({ menuDisplay: "" });
    expect(isMenuVisible(shown.doc as unknown as Document)).toBe(true);
    const hidden = makeDoc({ menuDisplay: "none" });
    expect(isMenuVisible(hidden.doc as unknown as Document)).toBe(false);
  });

  it("reuses the backdrop palette and the soldier accent source", () => {
    expect(backdropPaletteFor("kilima").name).toBe("kilima");
    expect(backdropPaletteFor("dune").hazeCss).not.toBe(
      backdropPaletteFor("kilima").hazeCss,
    );
    expect(soldierAccentFor(0)).not.toBe(soldierAccentFor(1));
  });
});
