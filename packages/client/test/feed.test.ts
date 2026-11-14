// Kill-feed overlay tests: weapon icon lookup, entry model, and the
// timed fake-doc binder (colored names, icon between them, 6s fade,
// removal, 5-entry cap). Fake elements only (no jsdom), mirroring the
// ammo.test.ts builder style.
import { describe, expect, it } from "vitest";
import { ENEMY_A_CSS, LOCAL_CSS } from "../src/view/character";
import {
  buildFeed,
  buildFeedEntry,
  feedIconFor,
  KILLFEED_FADE_MS,
  KILLFEED_HOLD_MS,
  KILLFEED_MAX_ENTRIES,
  pushFeed,
  type FeedHandles,
  type FeedModel,
} from "../src/ui/feed";

/** Fake timer capture: { fn, ms } in scheduled order. */
interface FakeTimers {
  queue: Array<{ fn: () => void; ms: number }>;
}

/** Minimal fake element with attrs, a style bag, and children. */
interface FakeEl {
  tag: string;
  attrs: Map<string, string>;
  style: Record<string, string>;
  textContent: string;
  children: FakeEl[];
  classList: { add(c: string): void; remove(c: string): void };
  ownerDocument: FakeDoc;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(kid: FakeEl): void;
  removeChild(kid: FakeEl): void;
}

/** Minimal fake document with a builder and capturing timers. */
interface FakeDoc {
  timers: FakeTimers;
  createElement(tag: string): FakeEl;
  defaultView: { setTimeout(fn: () => void, ms: number): number };
}

function syncClass(el: FakeEl): void {
  const raw = el.attrs.get("class") ?? "";
  const parts = raw.split(" ").filter((part) => part !== "");
  el.attrs.set("class", parts.join(" "));
}

function makeEl(doc: FakeDoc, tag: string): FakeEl {
  const el: FakeEl = {
    tag,
    attrs: new Map<string, string>(),
    style: {},
    textContent: "",
    children: [],
    classList: {
      add: (c: string): void => {
        const raw = el.attrs.get("class") ?? "";
        const parts = raw.split(" ").filter((part) => part !== "");
        if (!parts.includes(c)) {
          parts.push(c);
        }
        el.attrs.set("class", parts.join(" "));
      },
      remove: (c: string): void => {
        const raw = el.attrs.get("class") ?? "";
        const parts = raw
          .split(" ")
          .filter((part) => part !== "" && part !== c);
        el.attrs.set("class", parts.join(" "));
      },
    },
    ownerDocument: doc,
    setAttribute: (k: string, v: string): void => {
      el.attrs.set(k, v);
      if (k === "class") {
        syncClass(el);
      }
      if (k === "src" || k === "alt") {
        // Direct-prop mirror (matches the writeAttr idiom).
      }
    },
    getAttribute: (k: string): string | null => el.attrs.get(k) ?? null,
    appendChild: (kid: FakeEl): void => {
      el.children.push(kid);
    },
    removeChild: (kid: FakeEl): void => {
      const index = el.children.indexOf(kid);
      if (index >= 0) {
        el.children.splice(index, 1);
      }
    },
  };
  return el;
}

function makeDoc(): FakeDoc {
  const timers: FakeTimers = { queue: [] };
  const doc: FakeDoc = {
    timers,
    createElement: (tag: string): FakeEl => makeEl(doc, tag),
    defaultView: {
      setTimeout: (fn: () => void, ms: number): number => {
        timers.queue.push({ fn, ms });
        return timers.queue.length;
      },
    },
  };
  return doc;
}

function makeFeed(doc: FakeDoc): { handles: FeedHandles; feed: FakeEl } {
  const feed = makeEl(doc, "div");
  return { handles: { feed: feed as unknown as HTMLElement }, feed };
}

describe("feed timing constants", () => {
  it("holds entries 6s, then fades ~0.5s before removal", () => {
    expect(KILLFEED_HOLD_MS).toBe(6000);
    expect(KILLFEED_FADE_MS).toBe(500);
    expect(KILLFEED_MAX_ENTRIES).toBe(5);
  });
});

describe("feedIconFor", () => {
  it("maps the SMG and Hornet spellings to the Hornet card", () => {
    expect(feedIconFor("smg")).toBe("./assets/weapon-hornet.svg");
    expect(feedIconFor("Hornet")).toBe("./assets/weapon-hornet.svg");
    expect(feedIconFor("Hornet SMG")).toBe("./assets/weapon-hornet.svg");
  });

  it("maps every other gun to its own card", () => {
    expect(feedIconFor("pistol")).toBe("./assets/weapon-pistol.svg");
    expect(feedIconFor("rifle")).toBe("./assets/weapon-rifle.svg");
    expect(feedIconFor("shotgun")).toBe("./assets/weapon-shotgun.svg");
    expect(feedIconFor("sniper")).toBe("./assets/weapon-sniper.svg");
    expect(feedIconFor("rocket")).toBe("./assets/weapon-rocket.svg");
  });

  it("maps grenade kills to the pickup art", () => {
    expect(feedIconFor("grenade")).toBe("./assets/pickup-grenade.svg");
  });

  it("reads null for missing or unknown weapons (text-only entries)", () => {
    expect(feedIconFor(null)).toBe(null);
    expect(feedIconFor(undefined)).toBe(null);
    expect(feedIconFor("")).toBe(null);
    expect(feedIconFor("banana")).toBe(null);
  });
});

describe("buildFeedEntry", () => {
  it("resolves the icon plus both player colors for killer blows", () => {
    const entry = buildFeedEntry("Raptor", "You", "smg", 1, 0);
    expect(entry.suicide).toBe(false);
    expect(entry.icon).toBe("./assets/weapon-hornet.svg");
    expect(entry.killerColor).toBe(ENEMY_A_CSS);
    expect(entry.victimColor).toBe(LOCAL_CSS);
  });

  it("marks unattributed deaths suicide with no icon or colors", () => {
    const entry = buildFeedEntry(null, "You", null, null, 0);
    expect(entry.suicide).toBe(true);
    expect(entry.icon).toBe(null);
    expect(entry.killerColor).toBe(null);
  });

  it("leaves colors null when the indices are unknown", () => {
    const entry = buildFeedEntry("Raptor", "You", "rifle", null, null);
    expect(entry.icon).toBe("./assets/weapon-rifle.svg");
    expect(entry.killerColor).toBe(null);
    expect(entry.victimColor).toBe(null);
  });
});

describe("pushFeed structured entries", () => {
  it("renders killer span, weapon img, victim span in order with colors", () => {
    const doc = makeDoc();
    const { handles, feed } = makeFeed(doc);
    const entry: FeedModel = buildFeedEntry("Raptor", "You", "smg", 1, 0);
    pushFeed(handles, entry);
    expect(feed.children).toHaveLength(1);
    const node = feed.children[0] as FakeEl;
    expect(node.children).toHaveLength(3);
    const [killer, icon, victim] = node.children as [FakeEl, FakeEl, FakeEl];
    expect(killer.getAttribute("class")).toBe("killer");
    expect(killer.textContent).toBe("Raptor");
    expect(killer.style["color"]).toBe(ENEMY_A_CSS);
    expect(icon.tag).toBe("img");
    expect(icon.getAttribute("class")).toBe("kill-weapon");
    expect(icon.getAttribute("src")).toBe("./assets/weapon-hornet.svg");
    expect(victim.getAttribute("class")).toBe("victim");
    expect(victim.textContent).toBe("You");
    expect(victim.style["color"]).toBe(LOCAL_CSS);
  });

  it("keeps the legacy flat line for icon-less killer blows", () => {
    const doc = makeDoc();
    const { handles, feed } = makeFeed(doc);
    pushFeed(handles, buildFeedEntry("Raptor", "You", null, 1, 0));
    const node = feed.children[0] as FakeEl;
    expect(node.children).toHaveLength(0);
    expect(node.textContent).toBe("Raptor killed You");
  });

  it("renders unattributed deaths as `X died` with no icon", () => {
    const doc = makeDoc();
    const { handles, feed } = makeFeed(doc);
    pushFeed(handles, buildFeedEntry(null, "You", null, null, 0));
    const node = feed.children[0] as FakeEl;
    expect(node.children).toHaveLength(0);
    expect(node.textContent).toBe("You died");
  });
});

describe("pushFeed timing", () => {
  it("pops flash, fades at 6s, and removes the entry after the fade", () => {
    const doc = makeDoc();
    const { handles, feed } = makeFeed(doc);
    pushFeed(
      handles,
      buildFeedEntry("Raptor", "You", "smg", 1, 0),
      700,
    );
    expect(feed.children).toHaveLength(1);
    const node = feed.children[0] as FakeEl;
    expect(node.getAttribute("class")).toContain("flash");
    expect(doc.timers.queue.map((timer) => timer.ms)).toEqual([
      700,
      KILLFEED_HOLD_MS,
      KILLFEED_HOLD_MS + KILLFEED_FADE_MS,
    ]);
    // Flash pop settles; the entry stays visible.
    doc.timers.queue[0].fn();
    expect(node.getAttribute("class")).not.toContain("flash");
    expect(feed.children).toContain(node);
    // At 6s the entry fades to opacity 0.
    doc.timers.queue[1].fn();
    expect(node.getAttribute("class")).toContain("fade");
    expect(node.style["opacity"] ?? node.getAttribute("data-opacity")).toBe(
      "0",
    );
    expect(feed.children).toContain(node);
    // After the fade the entry leaves the DOM (opacity 0 or removed).
    doc.timers.queue[2].fn();
    expect(feed.children).not.toContain(node);
  });
});

describe("pushFeed cap", () => {
  it("keeps only the last 5 entries", () => {
    const doc = makeDoc();
    const { handles, feed } = makeFeed(doc);
    for (let i = 0; i < 7; i += 1) {
      pushFeed(handles, buildFeedEntry(`Raptor${i}`, "You", null, 1, 0));
    }
    expect(feed.children).toHaveLength(5);
    expect((feed.children[0] as FakeEl).textContent).toBe(
      "Raptor2 killed You",
    );
    expect((feed.children[4] as FakeEl).textContent).toBe(
      "Raptor6 killed You",
    );
  });
});

describe("pushFeed tolerance", () => {
  it("no-ops on null handles, null feeds, and null entries", () => {
    expect(() =>
      pushFeed(null, buildFeedEntry("A", "B", "smg", 1, 0)),
    ).not.toThrow();
    expect(() =>
      pushFeed({ feed: null }, buildFeedEntry("A", "B", "smg", 1, 0)),
    ).not.toThrow();
    const doc = makeDoc();
    const { handles } = makeFeed(doc);
    expect(() => pushFeed(handles, null)).not.toThrow();
  });

  it("buildFeed reads null on builder-less docs", () => {
    expect(buildFeed(null as unknown as Document)).toEqual({ feed: null });
    expect(
      buildFeed({} as unknown as Document),
    ).toEqual({ feed: null });
  });
});
