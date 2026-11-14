// Rotating menu tips tests: interval/keyword constants, pure index
// helpers, idempotent DOM builder, and fake-timer binder rotation with
// the mid-fade opacity dip. Fake-doc harness (no jsdom), mirroring
// menu-scene.test.ts; timer capture mirrors feed.test.ts.
import { describe, expect, it } from "vitest";
import {
  MENU_TIP_FADE_MS,
  MENU_TIP_ID,
  MENU_TIP_INTERVAL_MS,
  MENU_TIPS,
  bindMenuTips,
  ensureMenuTip,
  nextTipIndex,
  tipTextFor,
} from "../src/menu/tips";

/** Minimal fake element with attrs, style bag, children, text. */
interface FakeEl {
  id: string;
  tag: string;
  attrs: Map<string, string>;
  style: Record<string, string>;
  textContent: string | null;
  children: FakeEl[];
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
      el.children.push(kid);
    },
  };
  if (id !== "") {
    el.attrs.set("id", id);
  }
  return el;
}

/** Fake document with an id table plus deep-subtree lookup. */
function makeDoc(menuDisplay = ""): {
  doc: unknown;
  els: Map<string, FakeEl>;
} {
  const els = new Map<string, FakeEl>();
  const menu = makeEl("div", "menu");
  menu.style["display"] = menuDisplay;
  els.set("menu", menu);
  const doc = {
    getElementById(id: string): FakeEl | null {
      const direct = els.get(id) ?? null;
      if (direct !== null) {
        return direct;
      }
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
      for (const root of els.values()) {
        const found = visit(root);
        if (found !== null) {
          return found;
        }
      }
      return null;
    },
    createElement(tag: string): FakeEl {
      return makeEl(tag);
    },
  };
  const orig = menu.appendChild.bind(menu);
  menu.appendChild = (kid: FakeEl): void => {
    orig(kid);
    if (kid.id !== "") {
      els.set(kid.id, kid);
    }
  };
  return { doc, els };
}

/** Captured window timer stubs installed for one binder lifetime. */
interface FakeTimers {
  intervals: Array<{ fn: () => void; ms: number }>;
  timeouts: Array<{ fn: () => void; ms: number }>;
  clearedIntervals: number;
  clearedTimeouts: number;
}

function installWindow(timers: FakeTimers): void {
  (globalThis as { window?: unknown }).window = {
    setInterval: (fn: () => void, ms: number): number => {
      timers.intervals.push({ fn, ms });
      return timers.intervals.length;
    },
    clearInterval: (): void => {
      timers.clearedIntervals += 1;
    },
    setTimeout: (fn: () => void, ms: number): number => {
      timers.timeouts.push({ fn, ms });
      return timers.timeouts.length;
    },
    clearTimeout: (): void => {
      timers.clearedTimeouts += 1;
    },
  };
}

function uninstallWindow(): void {
  delete (globalThis as { window?: unknown }).window;
}

function freshTimers(): FakeTimers {
  return { intervals: [], timeouts: [], clearedIntervals: 0, clearedTimeouts: 0 };
}

const KEYWORDS = /shield|spawn|jet|fuel|grenade/i;

describe("tips constants", () => {
  it("rotates exactly every 10s with a 0.5s fade", () => {
    expect(MENU_TIP_INTERVAL_MS).toBe(10000);
    expect(MENU_TIP_FADE_MS).toBe(500);
    expect(MENU_TIP_ID).toBe("menu-tip");
  });

  it("ships at least 3 distinct tips", () => {
    expect(new Set(MENU_TIPS).size).toBeGreaterThanOrEqual(3);
  });

  it("names a mechanic in every tip", () => {
    for (const tip of MENU_TIPS) {
      expect(tip).toMatch(KEYWORDS);
    }
  });
});

describe("tipTextFor", () => {
  it("reads each index verbatim", () => {
    for (let i = 0; i < MENU_TIPS.length; i += 1) {
      expect(tipTextFor(i)).toBe(MENU_TIPS[i]);
    }
  });

  it("wraps around the tip count", () => {
    expect(tipTextFor(MENU_TIPS.length)).toBe(MENU_TIPS[0]);
    expect(tipTextFor(-1)).toBe(MENU_TIPS[MENU_TIPS.length - 1]);
  });

  it("falls back to the first tip for unreadable indexes", () => {
    expect(tipTextFor(Number.NaN)).toBe(MENU_TIPS[0]);
    expect(tipTextFor(undefined)).toBe(MENU_TIPS[0]);
    expect(tipTextFor("fast")).toBe(MENU_TIPS[0]);
  });

  it("never returns empty across a sweep", () => {
    for (let i = -10; i < 10; i += 1) {
      expect(tipTextFor(i).length).toBeGreaterThan(0);
    }
  });
});

describe("nextTipIndex", () => {
  it("increments modulo the tip count", () => {
    expect(nextTipIndex(0)).toBe(1);
    expect(nextTipIndex(MENU_TIPS.length - 1)).toBe(0);
  });

  it("restarts for unreadable inputs", () => {
    expect(nextTipIndex(Number.NaN)).toBe(0);
    expect(nextTipIndex(undefined)).toBe(0);
  });
});

describe("ensureMenuTip", () => {
  it("builds the tip inside #menu pre-filled with the first tip", () => {
    const { doc } = makeDoc();
    const tip = ensureMenuTip(doc as unknown as Document) as FakeEl | null;
    expect(tip).not.toBeNull();
    expect((tip as FakeEl).id).toBe(MENU_TIP_ID);
    expect((tip as FakeEl).textContent).toBe(MENU_TIPS[0]);
    const again = ensureMenuTip(doc as unknown as Document);
    expect(again).toBe(tip);
  });

  it("is null-safe without #menu or shorn documents", () => {
    expect(
      ensureMenuTip({} as unknown as Document),
    ).toBeNull();
    expect(
      ensureMenuTip({
        getElementById: (): null => null,
        createElement: (tag: string): FakeEl => makeEl(tag),
      } as unknown as Document),
    ).toBeNull();
  });
});

describe("bindMenuTips", () => {
  it("paints the first tip synchronously and stops cleanly", () => {
    const timers = freshTimers();
    installWindow(timers);
    try {
      const { doc } = makeDoc();
      const binder = bindMenuTips(doc as unknown as Document);
      try {
        expect(binder.index).toBe(0);
        expect(binder.text).toBe(MENU_TIPS[0]);
        const tip = (doc as unknown as { getElementById(id: string): FakeEl | null })
          .getElementById(MENU_TIP_ID);
        expect(tip?.textContent).toBe(MENU_TIPS[0]);
        expect(timers.intervals).toHaveLength(1);
        expect(timers.intervals[0]?.ms).toBe(10000);
      } finally {
        binder.stop();
      }
      expect(timers.clearedIntervals).toBeGreaterThanOrEqual(1);
    } finally {
      uninstallWindow();
    }
  });

  it("rotates to different keyword text with an opacity 0 mid-fade", () => {
    const timers = freshTimers();
    installWindow(timers);
    try {
      const { doc } = makeDoc();
      const binder = bindMenuTips(doc as unknown as Document);
      try {
        const before =
          (doc as unknown as { getElementById(id: string): FakeEl | null })
            .getElementById(MENU_TIP_ID)?.textContent ?? "";
        expect(timers.intervals).toHaveLength(1);
        // One 10s tick: the fade starts synchronously (opacity 0).
        timers.intervals[0]?.fn();
        const tip = (doc as unknown as { getElementById(id: string): FakeEl | null })
          .getElementById(MENU_TIP_ID);
        expect(tip?.style["opacity"]).toBe("0");
        // Half-fade swap: new text, still keyword-bearing, opacity back.
        expect(timers.timeouts).toHaveLength(1);
        expect(timers.timeouts[0]?.ms).toBe(250);
        timers.timeouts[0]?.fn();
        const after = tip?.textContent ?? "";
        expect(after).not.toBe(before);
        expect(after).toBe(MENU_TIPS[1]);
        expect(after).toMatch(KEYWORDS);
        expect(tip?.style["opacity"]).toBe("1");
        expect(binder.index).toBe(1);
      } finally {
        binder.stop();
      }
    } finally {
      uninstallWindow();
    }
  });

  it("pauses while the menu is hidden without advancing", () => {
    const timers = freshTimers();
    installWindow(timers);
    try {
      const { doc } = makeDoc("none");
      const binder = bindMenuTips(doc as unknown as Document);
      try {
        expect(timers.intervals).toHaveLength(1);
        timers.intervals[0]?.fn();
        // Hidden tick schedules no swap and keeps the first tip.
        expect(timers.timeouts).toHaveLength(0);
        expect(binder.index).toBe(0);
        const tip = (doc as unknown as { getElementById(id: string): FakeEl | null })
          .getElementById(MENU_TIP_ID);
        expect(tip?.textContent).toBe(MENU_TIPS[0]);
        expect(tip?.style["opacity"]).not.toBe("0");
      } finally {
        binder.stop();
      }
    } finally {
      uninstallWindow();
    }
  });
});
