// Layer discipline tests (issue #313): band constants, exclusive overlay
// visibility, and stale-standings destruction. Fake elements/docs only
// (no jsdom), mirroring the feed.ts/chrome.test.ts style.
import { describe, expect, it } from "vitest";
import {
  destroyStandings,
  ensureStandings,
  LAYER_CANVAS,
  LAYER_HUD,
  LAYER_MENU,
  LAYER_OVERLAY,
  OVERLAY_IDS,
  showOnly,
} from "../src/ui/layers";

/** Minimal fake element with id/classes, a style bag, and tree links. */
class FakeEl {
  id: string | null = null;
  classes = new Set<string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, string> = {};
  textContent = "";
  attrs = new Map<string, string>();

  constructor(
    readonly tag: string,
    readonly owner: FakeDoc,
  ) {}

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === "id") {
      this.id = value;
    }
    if (name === "class") {
      this.classes = new Set(
        value.split(/\s+/).filter((part) => part.length > 0),
      );
    }
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  appendChild(child: FakeEl): void {
    child.parent = this;
    this.children.push(child);
    this.owner.attach(child);
  }

  remove(): void {
    if (this.parent !== null) {
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      );
      this.parent = null;
    }
    this.owner.detach(this);
  }
}

/** Minimal fake document with id/class lookup plus a body serializer. */
class FakeDoc {
  attached = new Set<FakeEl>();

  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }

  attach(el: FakeEl): void {
    this.attached.add(el);
    for (const child of el.children) {
      this.attach(child);
    }
  }

  detach(el: FakeEl): void {
    this.attached.delete(el);
    for (const child of el.children) {
      this.detach(child);
    }
  }

  mount(el: FakeEl): FakeEl {
    this.attach(el);
    return el;
  }

  getElementById(id: string): FakeEl | null {
    for (const el of this.attached) {
      if (el.id === id) {
        return el;
      }
    }
    return null;
  }

  querySelector(sel: string): FakeEl | null {
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      for (const el of this.attached) {
        if (el.classes.has(cls)) {
          return el;
        }
      }
      return null;
    }
    if (sel.startsWith("#")) {
      return this.getElementById(sel.slice(1));
    }
    return null;
  }

  querySelectorAll(sel: string): FakeEl[] {
    if (sel.startsWith(".")) {
      const cls = sel.slice(1);
      return [...this.attached].filter((el) => el.classes.has(cls));
    }
    const one = this.querySelector(sel);
    return one === null ? [] : [one];
  }

  /** Attached-tree HTML for the zero-`standings` substring assertion. */
  bodyHTML(): string {
    const tops = [...this.attached].filter((el) => el.parent === null);
    return tops.map((el) => serialize(el)).join("");
  }
}

/** Serialize one fake element (ids, classes, text, children). */
function serialize(el: FakeEl): string {
  const id = el.id === null ? "" : ` id="${el.id}"`;
  const cls =
    el.classes.size === 0 ? "" : ` class="${[...el.classes].join(" ")}"`;
  const kids = el.children.map((child) => serialize(child)).join("");
  return `<${el.tag}${id}${cls}>${el.textContent}${kids}</${el.tag}>`;
}

/** Fake overlay root with an id, attached to the doc. */
function makeOverlay(doc: FakeDoc, id: string): FakeEl {
  const el = doc.createElement("div");
  el.setAttribute("id", id);
  return doc.mount(el);
}

/** Fake end screen: winner callout plus a `standings`-classed table. */
function makeEndScreen(doc: FakeDoc): void {
  const screen = makeOverlay(doc, "end-screen");
  const winner = doc.createElement("div");
  winner.setAttribute("id", "end-winner");
  winner.textContent = "Winner: You";
  screen.appendChild(winner);
  const standings = doc.createElement("div");
  standings.setAttribute("id", "end-standings");
  const table = doc.createElement("table");
  const row = doc.createElement("tr");
  row.setAttribute("class", "standings winner");
  const cell = doc.createElement("td");
  cell.textContent = "You";
  row.appendChild(cell);
  table.appendChild(row);
  standings.appendChild(table);
  screen.appendChild(standings);
}

describe("layer bands", () => {
  it("orders canvas < HUD < overlay < menu numerically", () => {
    expect(LAYER_CANVAS).toBe(0);
    expect(LAYER_HUD).toBe(10);
    expect(LAYER_OVERLAY).toBe(20);
    expect(LAYER_MENU).toBe(30);
    expect(LAYER_CANVAS).toBeLessThan(LAYER_HUD);
    expect(LAYER_HUD).toBeLessThan(LAYER_OVERLAY);
    expect(LAYER_OVERLAY).toBeLessThan(LAYER_MENU);
  });

  it("owns every menu/overlay id exactly once", () => {
    expect([...OVERLAY_IDS].sort()).toEqual(
      ["end-screen", "howto", "settings", "setup"].sort(),
    );
  });
});

describe("showOnly", () => {
  it("leaves exactly the named overlay with display \"\"", () => {
    const doc = new FakeDoc();
    for (const id of OVERLAY_IDS) {
      makeOverlay(doc, id);
    }
    showOnly(doc as unknown as Document, "setup");
    for (const id of OVERLAY_IDS) {
      const el = doc.getElementById(id);
      expect(el?.style["display"]).toBe(id === "setup" ? "" : "none");
    }
    showOnly(doc as unknown as Document, "end-screen");
    for (const id of OVERLAY_IDS) {
      const el = doc.getElementById(id);
      expect(el?.style["display"]).toBe(id === "end-screen" ? "" : "none");
    }
  });

  it("skips missing overlays without throwing", () => {
    const doc = new FakeDoc();
    makeOverlay(doc, "setup");
    expect(() =>
      showOnly(doc as unknown as Document, "setup"),
    ).not.toThrow();
    expect(doc.getElementById("setup")?.style["display"]).toBe("");
  });

  it("no-ops on builder-less docs", () => {
    expect(() => showOnly(null, "setup")).not.toThrow();
    expect(() => showOnly(undefined, "setup")).not.toThrow();
    expect(() => showOnly({}, "setup")).not.toThrow();
  });
});

describe("destroyStandings", () => {
  it("removes every `standings` trace from the fake body HTML", () => {
    const doc = new FakeDoc();
    makeEndScreen(doc);
    expect(doc.querySelector(".standings")).not.toBe(null);
    expect(doc.bodyHTML()).toContain("standings");
    destroyStandings(doc as unknown as Document);
    expect(doc.querySelector(".standings")).toBe(null);
    expect(doc.getElementById("end-standings")).toBe(null);
    expect(doc.bodyHTML().split("standings")).toHaveLength(1);
    expect(doc.getElementById("end-winner")?.textContent).toBe("");
    // The screen itself survives for the exclusive hide that follows.
    expect(doc.getElementById("end-screen")).not.toBe(null);
  });

  it("no-ops on builder-less docs", () => {
    expect(() => destroyStandings(null)).not.toThrow();
    expect(() => destroyStandings(undefined)).not.toThrow();
    expect(() => destroyStandings({})).not.toThrow();
    const bare = new FakeDoc();
    expect(() => destroyStandings(bare as unknown as Document)).not.toThrow();
  });
});

describe("ensureStandings", () => {
  it("recreates the container idempotently after destruction", () => {
    const doc = new FakeDoc();
    makeEndScreen(doc);
    destroyStandings(doc as unknown as Document);
    expect(doc.getElementById("end-standings")).toBe(null);
    const first = ensureStandings(doc as unknown as Document);
    expect(first).not.toBe(null);
    const found = doc.getElementById("end-standings");
    expect(found).not.toBe(null);
    expect(found?.parent?.id).toBe("end-screen");
    const second = ensureStandings(doc as unknown as Document);
    expect(second).toBe(first);
    expect(doc.getElementById("end-standings")).toBe(first);
  });

  it("returns the present container untouched", () => {
    const doc = new FakeDoc();
    makeEndScreen(doc);
    const before = doc.getElementById("end-standings");
    expect(ensureStandings(doc as unknown as Document)).toBe(before);
  });

  it("returns null without a screen or element builders", () => {
    expect(ensureStandings(null)).toBe(null);
    expect(ensureStandings(undefined)).toBe(null);
    expect(ensureStandings({})).toBe(null);
    const bare = new FakeDoc();
    expect(ensureStandings(bare as unknown as Document)).toBe(null);
  });
});
