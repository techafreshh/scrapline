// Remote rendering path tests (issue #217): the online frame paints
// through the full soldier renderer with server roster nametags, queues
// the identical offline `Bob ▸ Alice` killfeed line, and banners
// `Player left` on departure. Fake-doc style (no DOM, no network).
import { describe, expect, it } from "vitest";
import {
  createOnlineCamera,
  renderOnlineSnapshot,
  type OnlineKillEvent,
  type OnlineLeaveEvent,
} from "../src/net/render";
import type { InterpPlayer } from "../src/net/interpolation";
import type { RosterEntry } from "../src/net/roster";
import { LEAVE_BANNER_TEXT } from "../src/net/roster";
import type { FeedHandles } from "../src/ui/feed";
import type { NametagsHandles } from "../src/ui/nametags";
import type { ToastHandles } from "../src/ui/toast";

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

interface FakeDoc {
  timers: Array<() => void>;
  createElement(tag: string): FakeEl;
  defaultView: { setTimeout(fn: () => void, ms: number): number };
}

function syncClass(el: FakeEl): void {
  const raw = el.attrs.get("class") ?? "";
  el.attrs.set("class", raw.split(" ").filter((part) => part !== "").join(" "));
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
        el.attrs.set(
          "class",
          raw
            .split(" ")
            .filter((part) => part !== "" && part !== c)
            .join(" "),
        );
      },
    },
    ownerDocument: doc,
    setAttribute: (k: string, v: string): void => {
      el.attrs.set(k, v);
      if (k === "class") {
        syncClass(el);
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
  const timers: Array<() => void> = [];
  const doc: FakeDoc = {
    timers,
    createElement: (tag: string): FakeEl => makeEl(doc, tag),
    defaultView: {
      setTimeout: (fn: () => void): number => {
        timers.push(fn);
        return timers.length;
      },
    },
  };
  return doc;
}

/** Collect every appended text fragment under a node (real-DOM semantics). */
function textOf(node: FakeEl): string {
  let out = node.textContent;
  for (const kid of node.children) {
    out += textOf(kid);
  }
  return out;
}

function rows(): InterpPlayer[] {
  return [
    {
      id: 0, x: 620, y: 300, aim: 0, hp: 100, weapon: "pistol",
      name: "Alice", alive: true, onGround: true, crouching: false, jetting: false,
    },
    {
      id: 1, x: 660, y: 300, aim: 0, hp: 100, weapon: "rifle",
      name: "Bob", alive: true, onGround: true, crouching: false, jetting: false,
    },
  ];
}

function roster(): RosterEntry[] {
  return [
    { id: 0, name: "Alice" },
    { id: 1, name: "Bob" },
  ];
}

describe("renderOnlineSnapshot", () => {
  it("paints remotes through the soldier renderer with roster nametags", () => {
    const doc = makeDoc();
    const nametagBox = makeEl(doc, "div");
    const feedBox = makeEl(doc, "div");
    const toastBox = makeEl(doc, "div");
    const drawn: unknown[] = [];
    const { state } = renderOnlineSnapshot({
      renderer: { draw: (s: unknown): void => { drawn.push(s); } },
      rows: rows(),
      tick: 7,
      roster: roster(),
      kills: [],
      leaves: [],
      nametags: { container: nametagBox as unknown as HTMLElement },
      feed: { feed: feedBox as unknown as HTMLElement },
      toast: { toast: toastBox as unknown as HTMLElement },
      camera: createOnlineCamera(),
      canvasW: 640,
      canvasH: 360,
    });
    // Full soldier shape reaches the renderer (both remotes present).
    expect(drawn).toHaveLength(1);
    expect(state.tick).toBe(7);
    expect(state.players).toHaveLength(2);
    // Server roster nametags: Bob renders Bob for Alice.
    const tags = nametagBox.children.map((kid) => kid.textContent).sort();
    expect(tags).toEqual(["Alice", "Bob"]);
  });

  it("queues the identical offline `Bob ▸ Alice` killfeed line", () => {
    const doc = makeDoc();
    const feedBox = makeEl(doc, "div");
    const kills: OnlineKillEvent[] = [
      { killer: 1, victim: 0, killerName: "Bob", victimName: "Alice", weapon: "rifle" },
    ];
    renderOnlineSnapshot({
      renderer: { draw: (): void => {} },
      rows: rows(),
      tick: 8,
      roster: roster(),
      kills,
      leaves: [],
      nametags: { container: null } as unknown as NametagsHandles,
      feed: { feed: feedBox as unknown as HTMLElement } as FeedHandles,
      toast: { toast: null } as unknown as ToastHandles,
      camera: createOnlineCamera(),
      canvasW: 640,
      canvasH: 360,
    });
    expect(feedBox.children).toHaveLength(1);
    const entry = feedBox.children[0] as FakeEl;
    // Structured killer/icon/separator/victim reads the shared line.
    expect(entry.children).toHaveLength(4);
    expect(entry.children[0]?.textContent).toBe("Bob");
    expect(entry.children[3]?.textContent).toBe("Alice");
    expect(textOf(entry)).toBe("Bob ▸ Alice");
  });

  it("banners `Player left` within the frame on departure", () => {
    const doc = makeDoc();
    const toastBox = makeEl(doc, "div");
    const leaves: OnlineLeaveEvent[] = [{ id: 1, name: "Bob" }];
    renderOnlineSnapshot({
      renderer: { draw: (): void => {} },
      rows: rows().slice(0, 1),
      tick: 9,
      roster: roster(),
      kills: [],
      leaves,
      nametags: { container: null } as unknown as NametagsHandles,
      feed: { feed: null } as unknown as FeedHandles,
      toast: { toast: toastBox as unknown as HTMLElement },
      camera: createOnlineCamera(),
      canvasW: 640,
      canvasH: 360,
    });
    expect(toastBox.children).toHaveLength(1);
    expect(textOf(toastBox.children[0] as FakeEl)).toContain(LEAVE_BANNER_TEXT);
  });

  it("lists all three roster rows in pid order on the HUD score node", () => {
    const doc = makeDoc();
    const scoreEl = makeEl(doc, "div");
    renderOnlineSnapshot({
      renderer: { draw: (): void => {} },
      rows: [
        { id: 0, x: 620, y: 300, aim: 0, hp: 100, weapon: "pistol" },
        { id: 1, x: 660, y: 300, aim: 0, hp: 100, weapon: "pistol" },
        { id: 2, x: 700, y: 300, aim: 0, hp: 100, weapon: "pistol" },
      ],
      tick: 7,
      roster: [
        { id: 0, name: "Alice" },
        { id: 1, name: "Bob" },
        { id: 2, name: "Viper" },
      ],
      scores: [
        { id: 0, score: 1 },
        { id: 1, score: 2 },
        { id: 2, score: 3 },
      ],
      kills: [],
      leaves: [],
      nametags: { container: null } as unknown as NametagsHandles,
      feed: { feed: null } as unknown as FeedHandles,
      toast: { toast: null } as unknown as ToastHandles,
      camera: createOnlineCamera(),
      canvasW: 640,
      canvasH: 360,
      scoreEl: scoreEl as unknown as { textContent: string | null },
    });
    expect(scoreEl.textContent).toContain("Alice");
    expect(scoreEl.textContent).toContain("Bob");
    expect(scoreEl.textContent).toContain("Viper");
    expect(scoreEl.textContent.indexOf("Alice")).toBeLessThan(
      scoreEl.textContent.indexOf("Bob"),
    );
    expect(scoreEl.textContent.indexOf("Bob")).toBeLessThan(
      scoreEl.textContent.indexOf("Viper"),
    );
  });

  it("is a no-op binder when overlays and the renderer are missing", () => {
    expect(() =>
      renderOnlineSnapshot({
        renderer: null,
        rows: [],
        tick: 0,
        roster: [],
        kills: [],
        leaves: [],
        nametags: { container: null },
        feed: { feed: null },
        toast: { toast: null },
        camera: null,
        canvasW: 640,
        canvasH: 360,
      }),
    ).not.toThrow();
  });
});
