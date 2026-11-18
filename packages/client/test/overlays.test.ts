// Overlay hash router plus setup unknown-map display tests (issue
// #319): hash parsing for the five Panel routes, close-to-menu wiring,
// and the `?map=arena2` verbatim preservation. Fake-doc style mirroring
// setup.test.ts and layers.test.ts (no jsdom).
import { describe, expect, it, afterEach } from "vitest";
import {
  OVERLAY_ROUTE_IDS,
  bindOverlayRouter,
  hashFor,
  routeFromHash,
  type OverlayRoute,
} from "../src/overlays/router";
import {
  MAP_LIST,
  ensureExtraMapButton,
  rawMapFromUrl,
} from "../src/setup";

/** Minimal fake element with attrs, style, children, and listeners. */
interface FakeEl {
  id: string;
  tag: string;
  attrs: Map<string, string>;
  style: Record<string, string>;
  textContent: string | null;
  children: FakeEl[];
  parentNode: FakeEl | null;
  listeners: Map<string, Array<() => void>>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  appendChild(kid: FakeEl): void;
  addEventListener(type: string, listener: () => void): void;
  fire(type: string): void;
}

function makeEl(tag: string, id = ""): FakeEl {
  const el: FakeEl = {
    id,
    tag,
    attrs: new Map<string, string>(),
    style: {},
    textContent: "",
    children: [],
    parentNode: null,
    listeners: new Map<string, Array<() => void>>(),
    setAttribute(k: string, v: string): void {
      el.attrs.set(k, v);
      if (k === "id") el.id = v;
    },
    getAttribute(k: string): string | null {
      if (k === "id") return el.id === "" ? null : el.id;
      return el.attrs.has(k) ? (el.attrs.get(k) as string) : null;
    },
    removeAttribute(k: string): void {
      el.attrs.delete(k);
    },
    appendChild(kid: FakeEl): void {
      kid.parentNode = el;
      el.children.push(kid);
    },
    addEventListener(type: string, listener: () => void): void {
      const list = el.listeners.get(type) ?? [];
      list.push(listener);
      el.listeners.set(type, list);
    },
    fire(type: string): void {
      for (const listener of el.listeners.get(type) ?? []) listener();
    },
  };
  if (id !== "") el.attrs.set("id", id);
  return el;
}

interface FakeDoc {
  elements: Map<string, FakeEl>;
  created: FakeEl[];
  getElementById(id: string): FakeEl | null;
  createElement(tag: string): FakeEl;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
}

function makeDoc(): FakeDoc {
  const elements = new Map<string, FakeEl>();
  const created: FakeEl[] = [];
  const doc: FakeDoc = {
    elements,
    created,
    getElementById: (id: string): FakeEl | null =>
      elements.get(id) ?? created.find((el) => el.id === id) ?? null,
    createElement: (tag: string): FakeEl => {
      const el = makeEl(tag);
      created.push(el);
      return el;
    },
    querySelector: (sel: string): FakeEl | null => {
      const all = doc.querySelectorAll(sel);
      return all[0] ?? null;
    },
    querySelectorAll: (sel: string): FakeEl[] => {
      const out: FakeEl[] = [];
      const collect = (el: FakeEl): void => {
        if (sel === ".panel-close") {
          if (el.attrs.get("class")?.split(/\s+/).includes("panel-close")) {
            out.push(el);
          }
        } else if (sel.startsWith('[data-map="')) {
          const want = sel.slice('[data-map="'.length, -2);
          if (el.attrs.get("data-map") === want) out.push(el);
        } else if (sel === '[data-map="kilima"]') {
          if (el.attrs.get("data-map") === "kilima") out.push(el);
        }
        for (const kid of el.children) collect(kid);
      };
      for (const el of elements.values()) collect(el);
      for (const el of created) collect(el);
      // Direct scan for data-map prefix queries.
      if (sel.startsWith("[data-map")) {
        const all: FakeEl[] = [];
        const gather = (el: FakeEl): void => {
          if (el.attrs.has("data-map")) all.push(el);
          for (const kid of el.children) gather(kid);
        };
        for (const el of elements.values()) gather(el);
        for (const el of created) gather(el);
        if (sel === ".panel-close") return out;
        // Attribute-equals form.
        const match = /\[data-map="([^"]+)"\]/.exec(sel);
        if (match !== null) {
          return all.filter((el) => el.attrs.get("data-map") === match[1]);
        }
        return all;
      }
      return out;
    },
  };
  return doc;
}

function stubWindow(hash: string, search: string): void {
  (globalThis as { window?: unknown }).window = {
    location: { hash, search, pathname: "/" },
    history: { replaceState: (): void => {} },
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("routeFromHash", () => {
  it("carries exactly the five panel routes", () => {
    expect([...OVERLAY_ROUTE_IDS].sort()).toEqual(
      ["challenges", "howto", "locker", "settings", "setup"].sort(),
    );
  });

  it("parses hash routes tolerantly", () => {
    expect(routeFromHash("#setup")).toBe("setup");
    expect(routeFromHash("#settings")).toBe("settings");
    expect(routeFromHash("#howto")).toBe("howto");
    expect(routeFromHash("#challenges")).toBe("challenges");
    expect(routeFromHash("#locker")).toBe("locker");
    expect(routeFromHash("#/setup")).toBe("setup");
    expect(routeFromHash("  #SETUP  ")).toBe("setup");
    expect(routeFromHash("#setup?x=1")).toBe("setup");
  });

  it("rejects empty, menu, and unknown hashes", () => {
    expect(routeFromHash("")).toBeNull();
    expect(routeFromHash("#")).toBeNull();
    expect(routeFromHash("#menu")).toBeNull();
    expect(routeFromHash("#end-screen")).toBeNull();
    expect(routeFromHash("#nope")).toBeNull();
    expect(routeFromHash(null)).toBeNull();
    expect(routeFromHash(undefined)).toBeNull();
  });

  it("builds canonical hashes", () => {
    expect(hashFor("setup")).toBe("#setup");
    expect(hashFor("locker" as OverlayRoute)).toBe("#locker");
  });
});

describe("bindOverlayRouter", () => {
  it("shows the hashed overlay exclusively on refresh", () => {
    stubWindow("#settings", "");
    const shown: string[] = [];
    const hidden: string[] = [];
    let menuHidden = 0;
    const doc = makeDoc();
    const api = bindOverlayRouter(doc as unknown as Document, {
      show: (id: string): void => {
        shown.push(id);
      },
      hide: (id: string): void => {
        hidden.push(id);
      },
      showMenu: (): void => {
        hidden.push("menu-shown");
      },
      hideMenu: (): void => {
        menuHidden += 1;
      },
      onRoute: (): void => {},
    });
    // Initial refresh already ran on bind.
    expect(shown).toContain("settings");
    expect(menuHidden).toBeGreaterThanOrEqual(1);
    expect(api.refresh()).toBe("settings");
    api.stop();
  });

  it("no-ops on unknown hashes and shorn docs", () => {
    stubWindow("#nope", "");
    const doc = makeDoc();
    let shown = 0;
    const api = bindOverlayRouter(doc as unknown as Document, {
      show: (): void => {
        shown += 1;
      },
      hide: (): void => {},
      showMenu: (): void => {},
      hideMenu: (): void => {},
    });
    expect(shown).toBe(0);
    expect(api.refresh()).toBeNull();
    expect(() => bindOverlayRouter(null, null)).not.toThrow();
    expect(() =>
      bindOverlayRouter({} as unknown as Document, null),
    ).not.toThrow();
    api.stop();
  });

  it("close buttons hide all overlays and show the menu", () => {
    stubWindow("", "");
    const doc = makeDoc();
    const closer = makeEl("button");
    closer.attrs.set("class", "panel-close");
    doc.created.push(closer);
    const hidden: string[] = [];
    let menuShown = 0;
    bindOverlayRouter(doc as unknown as Document, {
      show: (): void => {},
      hide: (id: string): void => {
        hidden.push(id);
      },
      showMenu: (): void => {
        menuShown += 1;
      },
      hideMenu: (): void => {},
    });
    closer.fire("click");
    expect(hidden).toContain("setup");
    expect(hidden).toContain("challenges");
    expect(hidden).toContain("locker");
    expect(menuShown).toBeGreaterThanOrEqual(1);
  });
});

describe("setup unknown-map display", () => {
  it("rawMapFromUrl reads the verbatim query value", () => {
    stubWindow("", "?map=arena2");
    expect(rawMapFromUrl()).toBe("arena2");
    stubWindow("", "?bots=3&map=dune");
    expect(rawMapFromUrl()).toBe("dune");
    stubWindow("", "");
    expect(rawMapFromUrl()).toBeNull();
  });

  it("rawMapFromUrl is null without a window (node keeps kilima fallback)", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(rawMapFromUrl()).toBeNull();
  });

  it("ensureExtraMapButton creates and selects the verbatim button", () => {
    const doc = makeDoc();
    const row = makeEl("div");
    const known = makeEl("button");
    known.setAttribute("data-map", "kilima");
    known.setAttribute("aria-pressed", "true");
    row.appendChild(known);
    doc.elements.set("setup", row);
    ensureExtraMapButton(doc as unknown as Document, "arena2");
    const extra = doc.querySelector('[data-map="arena2"]');
    expect(extra).not.toBeNull();
    expect(extra?.getAttribute("aria-pressed")).toBe("true");
    // Known maps stay shipped; arena2 never enters the list.
    expect((MAP_LIST as readonly string[]).includes("arena2")).toBe(false);
  });

  it("ensureExtraMapButton ignores known maps and blanks", () => {
    const doc = makeDoc();
    expect(() =>
      ensureExtraMapButton(doc as unknown as Document, "dune"),
    ).not.toThrow();
    expect(() =>
      ensureExtraMapButton(doc as unknown as Document, "  "),
    ).not.toThrow();
    expect(doc.querySelector('[data-map="dune"]')).toBeNull();
  });
});
