// Menu art + carousel nav tests (issue #348): the art readiness gate
// (preload, ready stamp, binder) plus the arrow/dot/keyboard selection
// cycling, dot sync, and menu theme mirror. Fake-doc/fake-storage
// style mirroring carousel.test.ts (no jsdom).
import { describe, expect, it } from "vitest";
import {
  bindMenuArt,
  markMenuArtReady,
  MENU_ART_READY_CLASS,
  menuArtUrls,
  preloadMenuArt,
} from "../src/menu/art";
import { isMenuArtButton } from "../src/ui/chrome";
import {
  CAROUSEL_DOTS_ID,
  CAROUSEL_NEXT_ID,
  CAROUSEL_PREV_ID,
  carouselKeyAllowed,
  cycleCarouselMap,
  DOT_ATTR,
  ensureCarouselNav,
  syncCarouselDots,
  syncMenuTheme,
} from "../src/menu/carousel";
import { MAP_LIST, type SetupStorage } from "../src/setup";

/** In-memory stand-in for localStorage. */
function fakeStorage(entries?: Record<string, string>): SetupStorage {
  const store = new Map<string, string>(Object.entries(entries ?? {}));
  return {
    getItem: (key: string): string | null =>
      store.has(key) ? (store.get(key) as string) : null,
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
  };
}

interface FakeEl {
  id: string;
  tag: string;
  attrs: Map<string, string>;
  classes: Set<string>;
  classList: { add(name: string): void; contains(name: string): boolean };
  style: Record<string, string>;
  textContent: string | null;
  children: FakeEl[];
  listeners: Map<string, Array<() => void>>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  appendChild(kid: FakeEl): void;
  addEventListener(type: string, listener: () => void): void;
  click(): void;
}

function makeEl(tag: string, id = ""): FakeEl {
  const el: FakeEl = {
    id,
    tag,
    attrs: new Map<string, string>(),
    classes: new Set<string>(),
    classList: {
      add(name: string): void {
        el.classes.add(name);
      },
      contains(name: string): boolean {
        return el.classes.has(name);
      },
    },
    style: {},
    textContent: "",
    children: [],
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
  };
  if (id !== "") {
    el.attrs.set("id", id);
  }
  return el;
}

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

function makeDoc(opts?: { withMenu?: boolean; withNav?: boolean }): {
  doc: unknown;
  menu: FakeEl | null;
} {
  const withMenu = opts?.withMenu ?? true;
  const menu = withMenu ? makeEl("div", "menu") : null;
  if (opts?.withNav === true && menu !== null) {
    // Nested skeleton (issue #377): arrows flank the cards in the row
    // and dots sit beneath it, all inside #map-carousel.
    const carousel = makeEl("div", "map-carousel");
    const row = makeEl("div");
    row.setAttribute("class", "carousel-row");
    const prev = makeEl("button", CAROUSEL_PREV_ID);
    row.appendChild(prev);
    for (const name of MAP_LIST) {
      const card = makeEl("button");
      card.setAttribute("data-map-card", name);
      card.setAttribute("aria-pressed", name === "kilima" ? "true" : "false");
      row.appendChild(card);
    }
    const next = makeEl("button", CAROUSEL_NEXT_ID);
    row.appendChild(next);
    carousel.appendChild(row);
    const dots = makeEl("div", CAROUSEL_DOTS_ID);
    for (const name of MAP_LIST) {
      const dot = makeEl("button");
      dot.setAttribute(DOT_ATTR, name);
      dot.setAttribute("aria-selected", name === "kilima" ? "true" : "false");
      dots.appendChild(dot);
    }
    carousel.appendChild(dots);
    menu.appendChild(carousel);
  }
  const doc = {
    getElementById(id: string): FakeEl | null {
      if (menu !== null && menu.id === id) {
        return menu;
      }
      if (menu !== null) {
        for (const kid of descendants(menu)) {
          if (kid.id === id) {
            return kid;
          }
        }
      }
      return null;
    },
    createElement(tag: string): FakeEl {
      return makeEl(tag);
    },
    querySelector(sel: string): FakeEl | null {
      const dot = new RegExp(`^\\[${DOT_ATTR}="([^"]+)"\\]$`).exec(sel);
      if (dot !== null && menu !== null) {
        for (const kid of descendants(menu)) {
          if (kid.getAttribute(DOT_ATTR) === dot[1]) {
            return kid;
          }
        }
        return null;
      }
      const card = /^\[data-map-card="([^"]+)"\]$/.exec(sel);
      if (card !== null && menu !== null) {
        for (const kid of descendants(menu)) {
          if (kid.getAttribute("data-map-card") === card[1]) {
            return kid;
          }
        }
        return null;
      }
      return null;
    },
  };
  return { doc, menu };
}

describe("menu art urls", () => {
  it("ships the nine-file ME-* kit under assets/ui", () => {
    const urls = menuArtUrls();
    expect(urls).toHaveLength(9);
    expect(urls[0]).toBe("./assets/ui/wordmark.png");
    for (const url of urls) {
      expect(url.startsWith("./assets/ui/")).toBe(true);
      expect(url.endsWith(".png")).toBe(true);
    }
  });

  it("returns a copy the caller cannot mutate", () => {
    const urls = menuArtUrls();
    urls.push("./assets/ui/evil.png");
    expect(menuArtUrls()).toHaveLength(9);
  });
});

describe("markMenuArtReady", () => {
  it("stamps the ready class on #menu", () => {
    const { doc, menu } = makeDoc();
    expect(markMenuArtReady(doc as Document)).toBe(true);
    expect(menu?.classList.contains(MENU_ART_READY_CLASS)).toBe(true);
  });

  it("reads false without #menu", () => {
    const { doc } = makeDoc({ withMenu: false });
    expect(markMenuArtReady(doc as Document)).toBe(false);
  });

  it("never throws on shorn documents", () => {
    expect(markMenuArtReady({} as Document)).toBe(false);
    expect(markMenuArtReady(null as unknown as Document)).toBe(false);
  });
});

describe("preloadMenuArt", () => {
  it("resolves true when every PNG confirms", async () => {
    const seen: string[] = [];
    const ok = await preloadMenuArt((url: string) => {
      seen.push(url);
      const img = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        src: "",
      };
      queueMicrotask(() => img.onload?.());
      return img;
    });
    expect(ok).toBe(true);
    expect(seen).toHaveLength(9);
  });

  it("resolves false when any PNG errors", async () => {
    const ok = await preloadMenuArt(() => {
      const img = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        src: "",
      };
      queueMicrotask(() => img.onerror?.());
      return img;
    });
    expect(ok).toBe(false);
  });

  it("resolves false without a loader and never rejects", async () => {
    await expect(preloadMenuArt(null)).resolves.toBe(false);
    await expect(preloadMenuArt(undefined)).resolves.toBe(false);
  });
});

describe("bindMenuArt", () => {
  it("stamps ready once the kit confirms", async () => {
    const { doc, menu } = makeDoc();
    const binder = bindMenuArt(doc as Document, (url: string) => {
      void url;
      const img = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        src: "",
      };
      queueMicrotask(() => img.onload?.());
      return img;
    });
    await expect(binder.ready).resolves.toBe(true);
    expect(menu?.classList.contains(MENU_ART_READY_CLASS)).toBe(true);
  });

  it("stop() cancels a pending stamp", async () => {
    const { doc, menu } = makeDoc();
    const fires: Array<() => void> = [];
    const binder = bindMenuArt(doc as Document, (url: string) => {
      void url;
      const img = {
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        src: "",
      };
      fires.push(() => img.onload?.());
      return img;
    });
    binder.stop();
    for (const fire of fires) {
      fire();
    }
    await expect(binder.ready).resolves.toBe(false);
    expect(menu?.classList.contains(MENU_ART_READY_CLASS)).toBe(false);
  });
});

describe("isMenuArtButton", () => {
  it("claims cards, arrows, and dots by attribute, class, or id", () => {
    const card = makeEl("button");
    card.setAttribute("data-map-card", "kilima");
    expect(isMenuArtButton(card)).toBe(true);
    const dot = makeEl("button");
    dot.setAttribute("data-carousel-dot", "dune");
    expect(isMenuArtButton(dot)).toBe(true);
    const prev = makeEl("button", CAROUSEL_PREV_ID);
    expect(isMenuArtButton(prev)).toBe(true);
    const byClass = makeEl("button");
    byClass.setAttribute("class", "carousel-arrow");
    expect(isMenuArtButton(byClass)).toBe(true);
  });

  it("refuses plain buttons and shorn handles", () => {
    expect(isMenuArtButton(makeEl("button"))).toBe(false);
    expect(isMenuArtButton(null)).toBe(false);
    expect(isMenuArtButton({})).toBe(false);
  });
});

describe("carousel nav selection", () => {
  it("cycles forward through every arena with wrap", () => {
    const { doc } = makeDoc({ withNav: true });
    const storage = fakeStorage();
    expect(cycleCarouselMap(doc as Document, storage, 1)).toBe("dune");
    expect(cycleCarouselMap(doc as Document, storage, 1)).toBe("frostbite");
    expect(cycleCarouselMap(doc as Document, storage, 1)).toBe("kilima");
  });

  it("cycles backward with wrap and tolerates unknown directions", () => {
    const { doc } = makeDoc({ withNav: true });
    const storage = fakeStorage();
    expect(cycleCarouselMap(doc as Document, storage, -1)).toBe("frostbite");
    expect(cycleCarouselMap(doc as Document, storage, "prev")).toBe("dune");
    expect(cycleCarouselMap(doc as Document, storage, "bogus")).toBe("frostbite");
  });

  it("syncs dots and the menu theme on select", () => {
    const { doc } = makeDoc({ withNav: true });
    expect(syncCarouselDots(doc as Document, "dune")).toBe("dune");
    const dune = (doc as { querySelector(sel: string): FakeEl | null }).querySelector(
      `[${DOT_ATTR}="dune"]`,
    );
    const kilima = (doc as { querySelector(sel: string): FakeEl | null }).querySelector(
      `[${DOT_ATTR}="kilima"]`,
    );
    expect(dune?.getAttribute("aria-selected")).toBe("true");
    expect(kilima?.getAttribute("aria-selected")).toBe("false");
    expect(syncMenuTheme(doc as Document, "frostbite")).toBe("frostbite");
    const menu = (doc as { getElementById(id: string): FakeEl | null }).getElementById("menu");
    expect(menu?.getAttribute("data-theme")).toBe("frostbite");
  });

  it("falls back to kilima on unknown maps", () => {
    const { doc } = makeDoc({ withNav: true });
    expect(syncCarouselDots(doc as Document, "arena-9")).toBe("kilima");
    expect(syncMenuTheme(doc as Document, null)).toBe("kilima");
  });
});

describe("carouselKeyAllowed", () => {
  it("runs while the menu is visible with a plain target", () => {
    const { doc } = makeDoc();
    expect(carouselKeyAllowed(doc as Document, null)).toBe(true);
    expect(carouselKeyAllowed(doc as Document, { tagName: "DIV" })).toBe(true);
  });

  it("refuses hidden menus and editable targets", () => {
    const { doc, menu } = makeDoc();
    if (menu !== null) {
      menu.style["display"] = "none";
    }
    expect(carouselKeyAllowed(doc as Document, null)).toBe(false);
    const { doc: open } = makeDoc();
    expect(carouselKeyAllowed(open as Document, { tagName: "input" })).toBe(false);
    expect(carouselKeyAllowed(open as Document, { tagName: "SELECT" })).toBe(false);
    expect(carouselKeyAllowed(open as Document, { tagName: "textarea" })).toBe(false);
    expect(carouselKeyAllowed(open as Document, { isContentEditable: true })).toBe(false);
  });
});

describe("ensureCarouselNav", () => {
  it("backstops missing arrows and dots without duplicating", () => {
    const { doc } = makeDoc();
    ensureCarouselNav(doc as Document);
    const get = (doc as { getElementById(id: string): FakeEl | null }).getElementById.bind(doc);
    expect(get(CAROUSEL_PREV_ID)).not.toBe(null);
    expect(get(CAROUSEL_NEXT_ID)).not.toBe(null);
    for (const name of MAP_LIST) {
      const found = (doc as { querySelector(sel: string): FakeEl | null }).querySelector(
        `[${DOT_ATTR}="${name}"]`,
      );
      expect(found).not.toBe(null);
    }
    // Issue #377: the nav lives inside the carousel bounds.
    const carousel = get("map-carousel");
    expect(carousel).not.toBe(null);
    const inside = (id: string): boolean => {
      const node = get(id);
      if (node === null || carousel === null) {
        return false;
      }
      const visit = (root: FakeEl): boolean => {
        for (const kid of root.children) {
          if (kid === node) {
            return true;
          }
          if (visit(kid)) {
            return true;
          }
        }
        return false;
      };
      return visit(carousel as unknown as FakeEl);
    };
    expect(inside(CAROUSEL_PREV_ID)).toBe(true);
    expect(inside(CAROUSEL_NEXT_ID)).toBe(true);
    expect(inside(CAROUSEL_DOTS_ID)).toBe(true);
    const before = (get("menu")?.children.length ?? 0);
    ensureCarouselNav(doc as Document);
    expect(get("menu")?.children.length).toBe(before);
  });

  it("leaves static skeletons untouched", () => {
    const { doc } = makeDoc({ withNav: true });
    const get = (doc as { getElementById(id: string): FakeEl | null }).getElementById.bind(doc);
    const before = get("menu")?.children.length ?? 0;
    ensureCarouselNav(doc as Document);
    expect(get("menu")?.children.length).toBe(before);
    // Nested skeleton stays nested: arrows and dots remain descendants
    // of #map-carousel with no duplicates.
    const carousel = get("map-carousel");
    expect(carousel?.children.length).toBe(2);
    expect(get(CAROUSEL_PREV_ID)).not.toBe(null);
    expect(get(CAROUSEL_NEXT_ID)).not.toBe(null);
    expect(get(CAROUSEL_DOTS_ID)).not.toBe(null);
  });

  it("reparents stray menu-level nav into the carousel", () => {
    const { doc, menu } = makeDoc();
    if (menu === null) {
      throw new Error("expected #menu");
    }
    const get = (doc as { getElementById(id: string): FakeEl | null }).getElementById.bind(doc);
    // Pre-#377 flat layout: arrows and dots flank #map-carousel as
    // siblings under #menu.
    const prev = makeEl("button", CAROUSEL_PREV_ID);
    menu.appendChild(prev);
    const carousel = makeEl("div", "map-carousel");
    for (const name of MAP_LIST) {
      const card = makeEl("button");
      card.setAttribute("data-map-card", name);
      carousel.appendChild(card);
    }
    menu.appendChild(carousel);
    const next = makeEl("button", CAROUSEL_NEXT_ID);
    menu.appendChild(next);
    const dots = makeEl("div", CAROUSEL_DOTS_ID);
    for (const name of MAP_LIST) {
      const dot = makeEl("button");
      dot.setAttribute(DOT_ATTR, name);
      dots.appendChild(dot);
    }
    menu.appendChild(dots);
    ensureCarouselNav(doc as Document);
    // Strays collapse into the carousel: #menu keeps only the carousel.
    expect(get("menu")?.children.length).toBe(1);
    expect(get("menu")?.children[0]).toBe(get("map-carousel"));
    const box = get("map-carousel");
    expect(box).not.toBe(null);
    const visit = (root: FakeEl): FakeEl[] => {
      const out: FakeEl[] = [];
      for (const kid of root.children) {
        out.push(kid);
        out.push(...visit(kid));
      }
      return out;
    };
    const nested = new Set(visit(box as unknown as FakeEl));
    expect(nested.has(get(CAROUSEL_PREV_ID) as unknown as FakeEl)).toBe(true);
    expect(nested.has(get(CAROUSEL_NEXT_ID) as unknown as FakeEl)).toBe(true);
    expect(nested.has(get(CAROUSEL_DOTS_ID) as unknown as FakeEl)).toBe(true);
  });
});
