// Floating name-tag overlay tests: tag text/colors, visibility rules,
// and the per-frame fake-doc reconciler (projection, own highlight,
// OFF-hides-all, dead-hidden). Fake elements only (no jsdom).
import { describe, expect, it } from "vitest";
import { ENEMY_A_CSS, LOCAL_CSS } from "../src/view/character";
import { BOT_NAMES } from "../src/hud/hud";
import type { Camera } from "../src/renderer/camera";
import {
  buildNametags,
  isOwnTag,
  shouldShowTag,
  tagColorFor,
  tagTextFor,
  updateNametags,
  type NametagHandles,
  type NametagPlayer,
} from "../src/ui/nametags";

/** Minimal fake element with attrs, a style bag, and children. */
interface FakeEl {
  attrs: Map<string, string>;
  style: Record<string, string>;
  textContent: string;
  children: FakeEl[];
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(kid: FakeEl): void;
  removeChild(kid: FakeEl): void;
}

/** Minimal fake document resolving ids from a table. */
interface FakeDoc {
  elements: Map<string, FakeEl>;
  createElement(tag: string): FakeEl;
}

function makeEl(doc: FakeDoc): FakeEl {
  const el: FakeEl = {
    attrs: new Map<string, string>(),
    style: {},
    textContent: "",
    children: [],
    setAttribute: (k: string, v: string): void => {
      el.attrs.set(k, v);
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
  void doc;
  return el;
}

function makeHarness(): {
  doc: FakeDoc;
  container: FakeEl;
  handles: NametagHandles;
} {
  const elements = new Map<string, FakeEl>();
  const doc: FakeDoc = {
    elements,
    createElement: (): FakeEl => makeEl(doc),
  };
  const container = makeEl(doc);
  Object.defineProperty(container, "ownerDocument", {
    value: doc,
    enumerable: true,
  });
  // buildNametags duck-types getElementById plus instanceof
  // HTMLElement, which reads null under node: wire the grabbed
  // container straight into handles (the shape buildNametags returns
  // in a real DOM).
  const handles: NametagHandles = {
    container: container as unknown as HTMLElement,
  };
  return { doc, container, handles };
}

/** Head-on camera at the origin, 1x scale, 640x360 backing store. */
function headOnCamera(): Camera {
  return { x: 0, y: 0, scale: 1 } as unknown as Camera;
}

function twoPlayers(): NametagPlayer[] {
  return [
    { id: 0, x: 0, y: 0, alive: true },
    { id: 1, x: 100, y: 50, alive: true },
  ];
}

describe("nametag model", () => {
  it("reads You for the local id and pool names for bots", () => {
    expect(tagTextFor(0)).toBe("You");
    expect(tagTextFor(1)).toBe(BOT_NAMES[0]);
  });

  it("colors tags from the team source, never hardcoded hex", () => {
    expect(tagColorFor(0)).toBe(LOCAL_CSS);
    expect(tagColorFor(1)).toBe(ENEMY_A_CSS);
  });

  it("marks only array index 0 as the own tag", () => {
    expect(isOwnTag(0)).toBe(true);
    expect(isOwnTag(1)).toBe(false);
  });

  it("shows tags only when enabled, alive, and projectable", () => {
    const camera = headOnCamera();
    expect(shouldShowTag(true, true, camera)).toBe(true);
    expect(shouldShowTag(false, true, camera)).toBe(false);
    expect(shouldShowTag(true, false, camera)).toBe(false);
    expect(shouldShowTag(true, true, null)).toBe(false);
  });
});

describe("updateNametags enabled", () => {
  it("shows one tag per alive player with the own tag highlighted", () => {
    const { handles, container } = makeHarness();
    updateNametags(handles, {
      players: twoPlayers(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    });
    expect(container.children).toHaveLength(2);
    const own = container.children.find(
      (kid) => kid.getAttribute("data-player") === "0",
    ) as FakeEl;
    const bot = container.children.find(
      (kid) => kid.getAttribute("data-player") === "1",
    ) as FakeEl;
    expect(own.getAttribute("class")).toBe("nametag own");
    expect(own.textContent).toBe("You");
    expect(own.style["color"]).toBe(LOCAL_CSS);
    expect(bot.getAttribute("class")).toBe("nametag");
    expect(bot.textContent).toBe(BOT_NAMES[0]);
    expect(bot.style["color"]).toBe(ENEMY_A_CSS);
    // Projected above the head: local center (13, -6) lands in view.
    expect(own.style["left"]).toBe("333px");
    expect(container.style["display"]).toBe("");
  });

  it("reconciles positions across frames without duplicating nodes", () => {
    const { handles, container } = makeHarness();
    const frame = {
      players: twoPlayers(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    };
    updateNametags(handles, frame);
    expect(container.children).toHaveLength(2);
    frame.players[1].x = 120;
    updateNametags(handles, frame);
    expect(container.children).toHaveLength(2);
    const bot = container.children.find(
      (kid) => kid.getAttribute("data-player") === "1",
    ) as FakeEl;
    expect(bot.style["left"]).toBe("453px");
  });
});

describe("updateNametags hidden", () => {
  it("shows zero tags and hides the container when disabled", () => {
    const { handles, container } = makeHarness();
    updateNametags(handles, {
      players: twoPlayers(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    });
    expect(container.children).toHaveLength(2);
    updateNametags(handles, {
      players: twoPlayers(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: false,
    });
    expect(container.children).toHaveLength(0);
    expect(container.style["display"]).toBe("none");
  });

  it("hides dead players while keeping live tags", () => {
    const { handles, container } = makeHarness();
    const players = twoPlayers();
    players[1].alive = false;
    updateNametags(handles, {
      players,
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    });
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-player")).toBe("0");
    // The death arriving a frame later drops the stale node.
    players[0].alive = false;
    updateNametags(handles, {
      players,
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    });
    expect(container.children).toHaveLength(0);
  });

  it("culls tags projected outside the view", () => {
    const { handles, container } = makeHarness();
    updateNametags(handles, {
      players: [
        { id: 0, x: 0, y: 0, alive: true },
        { id: 1, x: 100000, y: 50000, alive: true },
      ],
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    });
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-player")).toBe("0");
  });

  it("buildNametags reads null on builder-less docs", () => {
    expect(buildNametags({} as unknown as Document)).toEqual({
      container: null,
    });
    expect(buildNametags(null as unknown as Document)).toEqual({
      container: null,
    });
  });

  it("no-ops on null handles or containers", () => {    const frame = {
      players: twoPlayers(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    };
    expect(() => updateNametags(null, frame)).not.toThrow();
    expect(() => updateNametags({ container: null }, frame)).not.toThrow();
  });
});

describe("updateNametags HUD guard scaling (issue #392)", () => {
  it("hides a tag inside the scaled cluster band while keeping others visible", () => {
    // 1109x624 stage over the 640x360 logical base: the guard maps
    // anchors with the overlay scale (issue #392), so the bot anchor at
    // logical (433, 224) reads viewport (850, 438) — inside the
    // padded cluster — while the old 1:1 mapping would read (533, 274)
    // and show both tags. The local anchor at logical (333, 174) reads
    // viewport (677, 352), clear of the band, and stays visible.
    const elements = new Map<string, FakeEl>();
    const doc: FakeDoc = {
      elements,
      createElement: (): FakeEl => makeEl(doc),
    };
    const cluster = { left: 820, top: 400, right: 880, bottom: 470 };
    (doc as unknown as Record<string, unknown>)["getElementById"] = (
      id: string,
    ): FakeEl | null => {
      if (id !== "hud-status") {
        return null;
      }
      const el = makeEl(doc);
      (el as unknown as Record<string, unknown>)["getBoundingClientRect"] =
        () => ({ ...cluster });
      return el;
    };
    const container = makeEl(doc);
    Object.defineProperty(container, "ownerDocument", {
      value: doc,
      enumerable: true,
    });
    (container as unknown as Record<string, unknown>)[
      "getBoundingClientRect"
    ] = () => ({ left: 100, top: 50, width: 1109, height: 624 });
    const handles: NametagHandles = {
      container: container as unknown as HTMLElement,
    };
    updateNametags(handles, {
      players: twoPlayers(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    });
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-player")).toBe("0");
  });

  it("still hides over the cluster when the rect is post-transform scaled", () => {
    // Live at 1109x624 the stamped scale(1.7328, 1.7333) makes
    // getBoundingClientRect return the post-transform box (~1921x1081).
    // The guard must read the layout size via offsetWidth/offsetHeight
    // (1109x624, unaffected by transforms) so the bot anchor still maps
    // to viewport (850, 438) — inside the padded cluster — and hides.
    // Reading the rect width would yield sx ~3.0, fling the anchor to
    // ~(1407, 724) outside the band, and wrongly show both tags.
    const elements = new Map<string, FakeEl>();
    const doc: FakeDoc = {
      elements,
      createElement: (): FakeEl => makeEl(doc),
    };
    const cluster = { left: 820, top: 400, right: 880, bottom: 470 };
    (doc as unknown as Record<string, unknown>)["getElementById"] = (
      id: string,
    ): FakeEl | null => {
      if (id !== "hud-status") {
        return null;
      }
      const el = makeEl(doc);
      (el as unknown as Record<string, unknown>)["getBoundingClientRect"] =
        () => ({ ...cluster });
      return el;
    };
    const container = makeEl(doc);
    Object.defineProperty(container, "ownerDocument", {
      value: doc,
      enumerable: true,
    });
    (container as unknown as Record<string, unknown>)[
      "getBoundingClientRect"
    ] = () => ({
      left: 100,
      top: 50,
      width: (1109 * 1109) / 640,
      height: (624 * 624) / 360,
    });
    Object.defineProperty(container, "offsetWidth", {
      value: 1109,
      enumerable: true,
    });
    Object.defineProperty(container, "offsetHeight", {
      value: 624,
      enumerable: true,
    });
    const handles: NametagHandles = {
      container: container as unknown as HTMLElement,
    };
    updateNametags(handles, {
      players: twoPlayers(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
      show: true,
    });
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-player")).toBe("0");
  });
});
