// Floating pickup-pad label tests: label text, visibility rules, and
// the per-frame fake-doc reconciler (projection, Hornet->Rocket swap,
// collected-hidden, offscreen culling). Fake elements only (no jsdom).
import { describe, expect, it } from "vitest";
import type { Camera } from "../src/renderer/camera";
import {
  buildPadlabels,
  isHeldWeaponPad,
  labelTextFor,
  normalizePadWeaponId,
  selectVisiblePadlabels,
  PADLABEL_FADE_FLOOR,
  PADLABEL_FADE_START_PX,
  PADLABEL_LIFT_PX,
  PADLABEL_MAX_VISIBLE,
  PADLABEL_RADIUS_PX,
  padDistancePx,
  padLabelOpacity,
  shouldShowLabel,
  updatePadlabels,
  type PadlabelPickup,
  type PadlabelsFrame,
  type PadlabelsHandles,
} from "../src/ui/padlabels";

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
  handles: PadlabelsHandles;
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
  // buildPadlabels duck-types getElementById plus instanceof
  // HTMLElement, which reads null under node: wire the grabbed
  // container straight into handles (the shape buildPadlabels returns
  // in a real DOM).
  const handles: PadlabelsHandles = {
    container: container as unknown as HTMLElement,
  };
  return { doc, container, handles };
}

/** Head-on camera at the origin, 1x scale, 640x360 backing store. */
function headOnCamera(): Camera {
  return { x: 0, y: 0, scale: 1 } as unknown as Camera;
}

function threePads(): PadlabelPickup[] {
  return [
    { id: 0, kind: "weapon", weapon: "hornet", x: 0, y: 0, active: true },
    { id: 1, kind: "health", x: 100, y: 50, active: true },
    { id: 2, kind: "grenades", x: -100, y: -50, active: true },
  ];
}

/** Two health pads projecting to logical (333, 174) and (433, 224).
 * Health pads never suppress on the held weapon, so the HUD-guard
 * scaling block isolates the guard mapping. */
function twoPads(): PadlabelPickup[] {
  return [
    { id: 0, kind: "health", x: 13, y: 2, active: true },
    { id: 1, kind: "health", x: 113, y: 52, active: true },
  ];
}

function frameFor(pickups: PadlabelPickup[]): PadlabelsFrame {
  return {
    pickups,
    camera: headOnCamera(),
    canvasW: 640,
    canvasH: 360,
  };
}

/** Frame variant carrying the issue #393 focus plus held weapon. */
function focusedFrame(
  pickups: PadlabelPickup[],
  focusX: number,
  focusY: number,
  heldWeapon?: unknown,
): PadlabelsFrame {
  return {
    ...frameFor(pickups),
    focusX,
    focusY,
    heldWeapon,
  };
}

describe("padlabel model", () => {
  it("labels Hornet holdings (hornet, smg) as Hornet", () => {
    expect(labelTextFor("weapon", "hornet")).toBe("Hornet");
    expect(labelTextFor("weapon", "Hornet")).toBe("Hornet");
    expect(labelTextFor("weapon", "smg")).toBe("Hornet");
  });

  it("labels other weapons by plaque name", () => {
    expect(labelTextFor("weapon", "rocket")).toBe("Rocket");
    expect(labelTextFor("weapon", "rifle")).toBe("Rifle");
    expect(labelTextFor("weapon", "shotgun")).toBe("Shotgun");
  });

  it("labels health pads HP and grenade pads GREN (issue #267)", () => {
    expect(labelTextFor("health", undefined)).toBe("HP");
    expect(labelTextFor("grenades", undefined)).toBe("GREN");
    expect(labelTextFor("grenade", undefined)).toBe("GREN");
  });

  it("falls back to the pistol label for unknown weapons", () => {
    expect(labelTextFor("weapon", "blaster-9000")).toBe("Pistol");
    expect(labelTextFor("weapon", undefined)).toBe("Pistol");
  });

  it("shows labels only when active and projectable", () => {
    const camera = headOnCamera();
    expect(shouldShowLabel(true, camera)).toBe(true);
    expect(shouldShowLabel(false, camera)).toBe(false);
    expect(shouldShowLabel(true, null)).toBe(false);
  });

  it("lifts labels just above the pad center", () => {
    expect(PADLABEL_LIFT_PX).toBe(8);
  });
});

describe("updatePadlabels shown", () => {
  it("shows one label per active pickup near the projected pad", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(handles, frameFor(threePads()));
    expect(container.children).toHaveLength(3);
    const hornet = container.children.find(
      (kid) => kid.getAttribute("data-pickup") === "0",
    ) as FakeEl;
    expect(hornet.getAttribute("class")).toBe("padlabel");
    expect(hornet.textContent).toBe("Hornet");
    expect(hornet.getAttribute("data-kind")).toBe("weapon");
    expect(hornet.getAttribute("data-weapon")).toBe("hornet");
    // Projected pad center (0, 0) minus the 8px lift lands at
    // (320, 172): within 40px of the pad in both axes.
    const left = Number.parseFloat(hornet.style["left"] ?? "NaN");
    const top = Number.parseFloat(hornet.style["top"] ?? "NaN");
    expect(left).toBe(320);
    expect(top).toBe(180 - PADLABEL_LIFT_PX);
    expect(Math.abs(left - 320)).toBeLessThanOrEqual(40);
    expect(Math.abs(top - 180)).toBeLessThanOrEqual(40);
    const health = container.children.find(
      (kid) => kid.getAttribute("data-pickup") === "1",
    ) as FakeEl;
    expect(health.textContent).toBe("HP");
    const grenades = container.children.find(
      (kid) => kid.getAttribute("data-pickup") === "2",
    ) as FakeEl;
    expect(grenades.textContent).toBe("GREN");
    expect(container.style["display"]).toBe("");
  });

  it("centers the health label within 10px of the pad", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(
      handles,
      frameFor([{ id: 7, kind: "health", x: 0, y: 0, active: true }]),
    );
    expect(container.children).toHaveLength(1);
    const node = container.children[0];
    const left = Number.parseFloat(node.style["left"] ?? "NaN");
    const top = Number.parseFloat(node.style["top"] ?? "NaN");
    expect(Math.abs(left - 320)).toBeLessThanOrEqual(10);
    expect(Math.abs(top - 180)).toBeLessThanOrEqual(10);
  });

  it("rewrites Hornet to Rocket on the same id with no remnant", () => {
    const { handles, container } = makeHarness();
    const pickups: PadlabelPickup[] = [
      { id: 0, kind: "weapon", weapon: "hornet", x: 0, y: 0, active: true },
    ];
    updatePadlabels(handles, frameFor(pickups));
    expect(container.children).toHaveLength(1);
    expect(container.children[0].textContent).toBe("Hornet");
    pickups[0].weapon = "rocket";
    updatePadlabels(handles, frameFor(pickups));
    expect(container.children).toHaveLength(1);
    expect(container.children[0].textContent).toBe("Rocket");
    expect(container.children[0].textContent).not.toContain("Hornet");
    expect(container.children[0].getAttribute("data-weapon")).toBe("rocket");
  });
});

describe("updatePadlabels hidden", () => {
  it("hides collected pickups while keeping live labels", () => {
    const { handles, container } = makeHarness();
    const pickups = threePads();
    pickups[0].active = false;
    updatePadlabels(handles, frameFor(pickups));
    expect(container.children).toHaveLength(2);
    expect(
      container.children.find(
        (kid) => kid.getAttribute("data-pickup") === "0",
      ),
    ).toBeUndefined();
    // The collection arriving a frame later drops the stale node.
    pickups[1].active = false;
    updatePadlabels(handles, frameFor(pickups));
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-pickup")).toBe("2");
  });

  it("recreates the label when a pad respawns with new contents", () => {
    const { handles, container } = makeHarness();
    const pickups: PadlabelPickup[] = [
      { id: 0, kind: "weapon", weapon: "hornet", x: 0, y: 0, active: true },
    ];
    updatePadlabels(handles, frameFor(pickups));
    expect(container.children).toHaveLength(1);
    pickups[0].active = false;
    updatePadlabels(handles, frameFor(pickups));
    expect(container.children).toHaveLength(0);
    pickups[0].active = true;
    pickups[0].weapon = "rocket";
    updatePadlabels(handles, frameFor(pickups));
    expect(container.children).toHaveLength(1);
    expect(container.children[0].textContent).toBe("Rocket");
  });

  it("culls labels projected outside the view", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(
      handles,
      frameFor([
        { id: 0, kind: "weapon", weapon: "hornet", x: 0, y: 0, active: true },
        {
          id: 1,
          kind: "weapon",
          weapon: "rocket",
          x: 100000,
          y: 50000,
          active: true,
        },
      ]),
    );
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-pickup")).toBe("0");
  });

  it("hides every label with no camera", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(handles, frameFor(threePads()));
    expect(container.children).toHaveLength(3);
    updatePadlabels(handles, {
      pickups: threePads(),
      camera: null,
      canvasW: 640,
      canvasH: 360,
    });
    expect(container.children).toHaveLength(0);
    expect(container.style["display"]).toBe("none");
  });

  it("buildPadlabels reads null on builder-less docs", () => {
    expect(buildPadlabels({} as unknown as Document)).toEqual({
      container: null,
    });
    expect(buildPadlabels(null as unknown as Document)).toEqual({
      container: null,
    });
  });

  it("no-ops on null handles or containers", () => {
    const frame = frameFor(threePads());
    expect(() => updatePadlabels(null, frame)).not.toThrow();
    expect(() => updatePadlabels({ container: null }, frame)).not.toThrow();
  });
});

describe("updatePadlabels proximity gating (issue #393)", () => {
  it("exposes the radius/cap/fade contract constants", () => {
    expect(PADLABEL_RADIUS_PX).toBe(260);
    expect(PADLABEL_MAX_VISIBLE).toBe(3);
    expect(PADLABEL_FADE_START_PX).toBe(100);
    expect(PADLABEL_FADE_FLOOR).toBe(0.25);
  });

  it("culls pads beyond the readable radius from the focus", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(
      handles,
      focusedFrame(
        [
          { id: 0, kind: "weapon", weapon: "rocket", x: 0, y: 0, active: true },
          // Onscreen (projects to x=620) yet past the 260px radius.
          { id: 1, kind: "weapon", weapon: "rifle", x: 300, y: 0, active: true },
          { id: 2, kind: "health", x: 1000, y: 0, active: true },
        ],
        0,
        0,
      ),
    );
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-pickup")).toBe("0");
  });

  it("caps visible labels at the 3 nearest pads", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(
      handles,
      focusedFrame(
        [
          { id: 0, kind: "health", x: 0, y: 0, active: true },
          { id: 1, kind: "health", x: 50, y: 0, active: true },
          { id: 2, kind: "health", x: 100, y: 0, active: true },
          { id: 3, kind: "health", x: 150, y: 0, active: true },
          { id: 4, kind: "health", x: 200, y: 0, active: true },
        ],
        0,
        0,
      ),
    );
    expect(container.children).toHaveLength(3);
    const ids = container.children
      .map((kid) => kid.getAttribute("data-pickup"))
      .sort();
    expect(ids).toEqual(["0", "1", "2"]);
  });

  it("fades opacity with distance and mirrors rounded data-dist", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(
      handles,
      focusedFrame(
        [
          { id: 0, kind: "health", x: 0, y: 0, active: true },
          { id: 1, kind: "health", x: 200, y: 0, active: true },
        ],
        0,
        0,
      ),
    );
    expect(container.children).toHaveLength(2);
    const near = container.children.find(
      (kid) => kid.getAttribute("data-pickup") === "0",
    ) as FakeEl;
    const far = container.children.find(
      (kid) => kid.getAttribute("data-pickup") === "1",
    ) as FakeEl;
    expect(Number.parseFloat(near.style["opacity"] ?? "NaN")).toBe(1);
    expect(near.getAttribute("data-dist")).toBe("0");
    const farOpacity = Number.parseFloat(far.style["opacity"] ?? "NaN");
    expect(farOpacity).toBeGreaterThan(0.25);
    expect(farOpacity).toBeLessThan(1);
    expect(far.getAttribute("data-dist")).toBe("200");
  });

  it("grades the opacity helper from full to the floor", () => {
    expect(padLabelOpacity(0)).toBe(1);
    expect(padLabelOpacity(100)).toBe(1);
    const mid = padLabelOpacity(200);
    expect(mid).toBeGreaterThan(0.25);
    expect(mid).toBeLessThan(1);
    expect(padLabelOpacity(260)).toBe(0.25);
    expect(padLabelOpacity(1000)).toBe(0.25);
    expect(padLabelOpacity(Number.NaN)).toBe(1);
  });

  it("reads non-finite distances as infinitely far", () => {
    expect(padDistancePx(0, 0, Number.NaN, 0)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(padDistancePx(3, 4, 0, 0)).toBe(5);
  });

  it("suppresses only weapon pads matching the held weapon", () => {
    expect(isHeldWeaponPad("weapon", "rocket", "rocket")).toBe(true);
    expect(isHeldWeaponPad("weapon", "Hornet", "smg")).toBe(true);
    expect(isHeldWeaponPad("weapon", "smg", "hornet")).toBe(true);
    expect(isHeldWeaponPad("weapon", "SMG", "Hornet")).toBe(true);
    expect(isHeldWeaponPad("weapon", "rocket", "rifle")).toBe(false);
    expect(isHeldWeaponPad("health", undefined, "health")).toBe(false);
    expect(isHeldWeaponPad("grenades", undefined, "grenades")).toBe(false);
    expect(normalizePadWeaponId("hornet")).toBe("smg");
    expect(normalizePadWeaponId(" SMG ")).toBe("smg");
    expect(normalizePadWeaponId(undefined)).toBe("");
    expect(normalizePadWeaponId("hornet-x")).toBe("hornet-x");
    expect(normalizePadWeaponId("hornet smg")).toBe("hornet smg");
    expect(normalizePadWeaponId(" HORNET-X ")).toBe("hornet-x");
    expect(normalizePadWeaponId("superhornet")).toBe("superhornet");
    expect(isHeldWeaponPad("weapon", "hornet-x", "smg")).toBe(false);
    expect(isHeldWeaponPad("weapon", "smg", "hornet-x")).toBe(false);
    expect(isHeldWeaponPad("weapon", "smg", "hornet")).toBe(true);
  });

  it("hides a held-weapon pad while HP/GREN pads stay visible", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(
      handles,
      focusedFrame(
        [
          { id: 0, kind: "weapon", weapon: "hornet", x: 0, y: 0, active: true },
          { id: 1, kind: "health", x: 50, y: 0, active: true },
          { id: 2, kind: "grenades", x: 100, y: 0, active: true },
        ],
        0,
        0,
        "smg",
      ),
    );
    expect(container.children).toHaveLength(2);
    expect(
      container.children.find(
        (kid) => kid.getAttribute("data-pickup") === "0",
      ),
    ).toBeUndefined();
    expect(
      container.children.find(
        (kid) => kid.getAttribute("data-pickup") === "1",
      )?.textContent,
    ).toBe("HP");
    expect(
      container.children.find(
        (kid) => kid.getAttribute("data-pickup") === "2",
      )?.textContent,
    ).toBe("GREN");
  });

  it("falls back to the camera center without a focus", () => {
    const { handles, container } = makeHarness();
    updatePadlabels(handles, frameFor(threePads()));
    expect(container.children).toHaveLength(3);
  });

  it("removes a collected pad label in the same frame with focus", () => {
    const { handles, container } = makeHarness();
    const pickups: PadlabelPickup[] = [
      { id: 0, kind: "weapon", weapon: "rocket", x: 0, y: 0, active: true },
      { id: 1, kind: "health", x: 50, y: 0, active: true },
    ];
    updatePadlabels(handles, focusedFrame(pickups, 0, 0));
    expect(container.children).toHaveLength(2);
    pickups[0].active = false;
    updatePadlabels(handles, focusedFrame(pickups, 0, 0));
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-pickup")).toBe("1");
  });
});

describe("updatePadlabels HUD guard scaling (issue #398)", () => {
  it("hides a label inside the scaled cluster band while keeping others visible", () => {
    // 1109x624 stage over the 640x360 logical base: the guard maps
    // anchors with the overlay scale (issue #398), so the pad anchor at
    // logical (433, 224) reads viewport (850, 438) — inside the
    // padded cluster — while the old 1:1 mapping would read (533, 274)
    // and show both labels. The pad anchor at logical (333, 174) reads
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
    const handles: PadlabelsHandles = {
      container: container as unknown as HTMLElement,
    };
    updatePadlabels(handles, {
      pickups: twoPads(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
    });
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-pickup")).toBe("0");
  });

  it("still hides over the cluster when the rect is post-transform scaled", () => {
    // Live at 1109x624 the stamped scale(1.7328, 1.7333) makes
    // getBoundingClientRect return the post-transform box (~1921x1081).
    // The guard must read the layout size via offsetWidth/offsetHeight
    // (1109x624, unaffected by transforms) so the pad anchor still maps
    // to viewport (850, 438) — inside the padded cluster — and hides.
    // Reading the rect width would yield sx ~3.0, fling the anchor to
    // ~(1407, 724) outside the band, and wrongly show both labels.
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
    const handles: PadlabelsHandles = {
      container: container as unknown as HTMLElement,
    };
    updatePadlabels(handles, {
      pickups: twoPads(),
      camera: headOnCamera(),
      canvasW: 640,
      canvasH: 360,
    });
    expect(container.children).toHaveLength(1);
    expect(container.children[0].getAttribute("data-pickup")).toBe("0");
  });
});

describe("selectVisiblePadlabels probe parity (issue #401)", () => {
  /** Drive the DOM reconciler and the headless selector on one frame. */
  function parityTexts(frame: PadlabelsFrame): {
    dom: string[];
    probe: string[];
  } {
    const { handles, container } = makeHarness();
    updatePadlabels(handles, frame);
    const dom = container.children.map((kid) => kid.textContent);
    const probe = selectVisiblePadlabels(frame.pickups, {
      camera: frame.camera,
      canvasW: frame.canvasW,
      canvasH: frame.canvasH,
      focusX: frame.focusX,
      focusY: frame.focusY,
      heldWeapon: frame.heldWeapon,
    }).map((selection) => selection.text);
    return { dom, probe };
  }

  it("caps 5 in-radius pads at the 3 nearest ids on both surfaces", () => {
    const frame = focusedFrame(
      [
        { id: 0, kind: "health", x: 0, y: 0, active: true },
        { id: 1, kind: "health", x: 50, y: 0, active: true },
        { id: 2, kind: "health", x: 100, y: 0, active: true },
        { id: 3, kind: "health", x: 150, y: 0, active: true },
        { id: 4, kind: "health", x: 200, y: 0, active: true },
      ],
      0,
      0,
    );
    const { dom, probe } = parityTexts(frame);
    expect(dom).toHaveLength(3);
    expect(probe).toEqual(dom);
    const ids = selectVisiblePadlabels(frame.pickups, {
      camera: frame.camera,
      canvasW: frame.canvasW,
      canvasH: frame.canvasH,
      focusX: 0,
      focusY: 0,
    }).map((selection) => selection.pickup.id);
    expect(ids).toEqual([0, 1, 2]);
  });

  it("orders nearest-first with identical text sets on both surfaces", () => {
    const frame = focusedFrame(
      [
        { id: 0, kind: "weapon", weapon: "rifle", x: 150, y: 0, active: true },
        { id: 1, kind: "grenades", x: 100, y: 0, active: true },
        { id: 2, kind: "weapon", weapon: "rocket", x: 50, y: 0, active: true },
        { id: 3, kind: "health", x: 0, y: 0, active: true },
      ],
      0,
      0,
    );
    const { dom, probe } = parityTexts(frame);
    expect(dom).toEqual(["HP", "Rocket", "GREN"]);
    expect(probe).toEqual(dom);
  });

  it("excludes far pads from both surfaces", () => {
    const frame = focusedFrame(
      [
        { id: 0, kind: "weapon", weapon: "rocket", x: 0, y: 0, active: true },
        // Onscreen (projects to x=620) yet past the 260px radius.
        { id: 1, kind: "weapon", weapon: "rifle", x: 300, y: 0, active: true },
      ],
      0,
      0,
    );
    const { dom, probe } = parityTexts(frame);
    expect(dom).toEqual(["Rocket"]);
    expect(probe).toEqual(dom);
  });

  it("excludes held-weapon pads from both surfaces", () => {
    const frame = focusedFrame(
      [
        { id: 0, kind: "weapon", weapon: "hornet", x: 0, y: 0, active: true },
        { id: 1, kind: "health", x: 50, y: 0, active: true },
        { id: 2, kind: "grenades", x: 100, y: 0, active: true },
      ],
      0,
      0,
      "smg",
    );
    const { dom, probe } = parityTexts(frame);
    expect(dom).toEqual(["HP", "GREN"]);
    expect(probe).toEqual(dom);
  });

  it("excludes offscreen pads from both surfaces", () => {
    const frame = focusedFrame(
      [
        { id: 0, kind: "weapon", weapon: "hornet", x: 0, y: 0, active: true },
        { id: 1, kind: "weapon", weapon: "rocket", x: 100000, y: 50000, active: true },
      ],
      0,
      0,
    );
    const { dom, probe } = parityTexts(frame);
    expect(dom).toEqual(["Hornet"]);
    expect(probe).toEqual(dom);
  });

  it("tracks Hornet->Rocket swaps and collect/respawn on both surfaces", () => {
    const pickups: PadlabelPickup[] = [
      { id: 0, kind: "weapon", weapon: "hornet", x: 0, y: 0, active: true },
    ];
    expect(parityTexts(focusedFrame(pickups, 0, 0)).dom).toEqual(["Hornet"]);
    expect(parityTexts(focusedFrame(pickups, 0, 0)).probe).toEqual(["Hornet"]);
    pickups[0].weapon = "rocket";
    const swapped = parityTexts(focusedFrame(pickups, 0, 0));
    expect(swapped.dom).toEqual(["Rocket"]);
    expect(swapped.probe).toEqual(swapped.dom);
    pickups[0].active = false;
    const collected = parityTexts(focusedFrame(pickups, 0, 0));
    expect(collected.dom).toEqual([]);
    expect(collected.probe).toEqual([]);
    pickups[0].active = true;
    const respawned = parityTexts(focusedFrame(pickups, 0, 0));
    expect(respawned.dom).toEqual(["Rocket"]);
    expect(respawned.probe).toEqual(respawned.dom);
  });

  it("reads no labels without a camera on both surfaces", () => {
    const frame: PadlabelsFrame = {
      pickups: threePads(),
      camera: null,
      canvasW: 640,
      canvasH: 360,
    };
    const { dom, probe } = parityTexts(frame);
    expect(dom).toEqual([]);
    expect(probe).toEqual([]);
  });
});
