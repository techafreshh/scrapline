// HU-01 HUD restyle contract tests (issue #349): HP three-state bands,
// low-fuel flag, five magazine pips with low-ammo styling, per-weapon
// crosshair plus hit/kill markers, sniper scope state, pickup toasts,
// status grenade pips, and the respawn card target. Pure helpers plus
// fake-doc binder drives (no jsdom), mirroring ammo.test.ts style.
import { describe, expect, it } from "vitest";
import {
  CROSSHAIR_KILL_MS,
  CROSSHAIR_HIT_MS,
  flashKillMarker,
  fuelLowFor,
  hpStateFor,
  isSniperScoped,
  pickupToastFor,
  setCrosshairWeapon,
  updateCrosshairState,
  updateHud,
  type HudHandles,
  type HudSnapshot,
} from "../src/hud/hud";
import {
  MAG_PIP_COUNT,
  isLowAmmo,
  magPipClass,
  magPipStates,
  updateAmmo,
} from "../src/ui/ammo";

/** Fake classList with add/remove/contains over a set. */
function fakeClassList(): {
  list: Set<string>;
  add(c: string): void;
  remove(c: string): void;
  contains(c: string): boolean;
} {
  const list = new Set<string>();
  return {
    list,
    add: (c: string): void => {
      list.add(c);
    },
    remove: (c: string): void => {
      list.delete(c);
    },
    contains: (c: string): boolean => list.has(c),
  };
}

/** Fake element with style bag, attributes, and classList. */
function fakeEl(): {
  style: Record<string, unknown>;
  attrs: Map<string, string>;
  classList: ReturnType<typeof fakeClassList>;
  textContent: string;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
} {
  const attrs = new Map<string, string>();
  return {
    style: {},
    attrs,
    classList: fakeClassList(),
    textContent: "",
    setAttribute(k: string, v: string): void {
      attrs.set(k, v);
    },
    getAttribute(k: string): string | null {
      return attrs.get(k) ?? null;
    },
  };
}

/** Fake doc resolving ids to fake elements with timer capture. */
function fakeDoc(ids: Record<string, ReturnType<typeof fakeEl>>): {
  doc: unknown;
  timers: Array<() => void>;
} {
  const timers: Array<() => void> = [];
  const doc = {
    getElementById: (id: string): unknown => ids[id] ?? null,
    defaultView: {
      setTimeout: (fn: () => void): number => {
        timers.push(fn);
        return timers.length;
      },
    },
  };
  return { doc: doc as unknown, timers };
}

function baseSnapshot(overrides: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    hp: 100,
    fuel: 100,
    magAmmo: 32,
    weaponName: "smg",
    grenades: 3,
    killedBy: null,
    scores: [0],
    ids: [0],
    tick: 0,
    timeLimitTicks: 18000,
    localAlive: true,
    respawnTicks: 0,
    ...overrides,
  } as HudSnapshot;
}

describe("hpStateFor", () => {
  it("bands thirds of max into high/mid/low", () => {
    expect(hpStateFor(100)).toBe("high");
    expect(hpStateFor(67)).toBe("high");
    expect(hpStateFor(50)).toBe("mid");
    expect(hpStateFor(34)).toBe("mid");
    expect(hpStateFor(33)).toBe("low");
    expect(hpStateFor(0)).toBe("low");
  });

  it("reads non-finite and negative values as low", () => {
    expect(hpStateFor(Number.NaN)).toBe("low");
    expect(hpStateFor(-5)).toBe("low");
  });
});

describe("fuelLowFor", () => {
  it("flags only readings under a quarter tank", () => {
    expect(fuelLowFor(100)).toBe(false);
    expect(fuelLowFor(25)).toBe(false);
    expect(fuelLowFor(24)).toBe(true);
    expect(fuelLowFor(0)).toBe(true);
  });

  it("never flags non-finite readings", () => {
    expect(fuelLowFor(Number.NaN)).toBe(false);
  });
});

describe("isSniperScoped", () => {
  it("scopes only a crouched sniper", () => {
    expect(isSniperScoped("sniper", true)).toBe(true);
    expect(isSniperScoped("sniper", false)).toBe(false);
    expect(isSniperScoped("rifle", true)).toBe(false);
    expect(isSniperScoped("rifle", false)).toBe(false);
  });

  it("rejects unknown weapons and non-boolean crouch readings", () => {
    expect(isSniperScoped("blaster", true)).toBe(false);
    expect(isSniperScoped("sniper", null)).toBe(false);
  });
});

describe("pickupToastFor", () => {
  it("labels health, grenade, and weapon pads", () => {
    expect(pickupToastFor("health")).toBe("+HP");
    expect(pickupToastFor("grenades")).toBe("+GREN");
    expect(pickupToastFor("weapon")).toBe("Weapon +");
  });

  it("stays silent for unknown or missing kinds", () => {
    expect(pickupToastFor("blaster")).toBe(null);
    expect(pickupToastFor(null)).toBe(null);
  });
});

describe("magPipStates", () => {
  it("fills all five pips on a full mag", () => {
    expect(MAG_PIP_COUNT).toBe(5);
    expect(magPipStates(32, "smg")).toEqual([true, true, true, true, true]);
  });

  it("scales filled pips with remaining rounds", () => {
    expect(magPipStates(27, "smg")).toEqual([true, true, true, true, false]);
    expect(magPipStates(16, "smg")).toEqual([true, true, false, false, false]);
    expect(magPipStates(1, "smg")).toEqual([true, false, false, false, false]);
    expect(magPipStates(0, "smg")).toEqual([false, false, false, false, false]);
  });

  it("clamps overfull and non-finite readings", () => {
    expect(magPipStates(99, "smg")).toEqual([true, true, true, true, true]);
    expect(magPipStates(Number.NaN, "smg")).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("isLowAmmo", () => {
  it("flags mags at or under one quarter of the stat-table mag", () => {
    expect(isLowAmmo(32, "smg")).toBe(false);
    expect(isLowAmmo(8, "smg")).toBe(true);
    expect(isLowAmmo(0, "smg")).toBe(true);
    expect(isLowAmmo(3, "pistol")).toBe(true);
    expect(isLowAmmo(4, "pistol")).toBe(false);
  });

  it("never flags non-finite readings", () => {
    expect(isLowAmmo(Number.NaN, "smg")).toBe(false);
  });
});

describe("magPipClass", () => {
  it("paints cyan filled/empty sockets, warm while low", () => {
    expect(magPipClass(true, false)).toBe("pip mag-pip filled");
    expect(magPipClass(false, false)).toBe("pip mag-pip empty");
    expect(magPipClass(true, true)).toBe("pip mag-pip filled low");
    expect(magPipClass(false, true)).toBe("pip mag-pip empty low");
  });
});

describe("updateAmmo magazine pips", () => {
  /** Fake pips container with a working element builder (no jsdom). */
  function fakeMags(): {
    children: object[];
    ownerDocument: { createElement(tag: string): object };
    appendChild(child: object): void;
    removeChild(child: object): void;
  } {
    const children: object[] = [];
    return {
      children,
      ownerDocument: {
        createElement: (): object => {
          const attrs = new Map<string, string>();
          return {
            className: "",
            setAttribute: (k: string, v: string): void => {
              attrs.set(k, v);
              if (k === "class") {
                ((this as unknown as { className: string }).className as string) = v;
              }
            },
            getAttribute: (k: string): string | null => attrs.get(k) ?? null,
          };
        },
      },
      appendChild: (child: object): void => {
        children.push(child);
      },
      removeChild: (child: object): void => {
        const index = children.indexOf(child);
        if (index >= 0) {
          children.splice(index, 1);
        }
      },
    };
  }

  function cls(mags: { children: object[] }): string[] {
    return mags.children.map(
      (kid) =>
        (kid as { getAttribute(k: string): string | null }).getAttribute("class") ??
        "",
    );
  }

  it("renders five magazine sockets beside the three grenade pips", () => {
    const mags = fakeMags();
    const pips = fakeMags();
    updateAmmo(
      { module: null, icon: null, name: null, counts: null, pips, mags } as unknown as Parameters<
        typeof updateAmmo
      >[0],
      { magAmmo: 32, weapon: "smg", grenades: 3 },
    );
    expect(mags.children.length).toBe(5);
    expect(pips.children.length).toBe(3);
    expect(cls(mags)).toEqual([
      "pip mag-pip filled",
      "pip mag-pip filled",
      "pip mag-pip filled",
      "pip mag-pip filled",
      "pip mag-pip filled",
    ]);
  });

  it("swaps pip styling to low once the mag runs down", () => {
    const mags = fakeMags();
    const handles = {
      module: null,
      icon: null,
      name: null,
      counts: null,
      pips: null,
      mags,
    } as unknown as Parameters<typeof updateAmmo>[0];
    updateAmmo(handles, { magAmmo: 32, weapon: "smg", grenades: 3 });
    updateAmmo(handles, { magAmmo: 4, weapon: "smg", grenades: 3 });
    expect(cls(mags)[0]).toContain("low");
    expect(cls(mags).every((c) => c.includes("low"))).toBe(true);
  });

  it("skips magazine writes when the handle is absent", () => {
    expect(() =>
      updateAmmo(
        { module: null, icon: null, name: null, counts: null, pips: null },
        { magAmmo: 4, weapon: "smg", grenades: 3 },
      ),
    ).not.toThrow();
  });
});

describe("setCrosshairWeapon", () => {
  it("stamps the normalized weapon id as data-weapon", () => {
    const crosshair = fakeEl();
    const { doc } = fakeDoc({ crosshair });
    setCrosshairWeapon(doc as unknown as Document, "rifle");
    expect(crosshair.attrs.get("data-weapon")).toBe("rifle");
    setCrosshairWeapon(doc as unknown as Document, "Hornet SMG");
    expect(crosshair.attrs.get("data-weapon")).toBe("smg");
  });

  it("falls back to the pistol skin for unknown readings", () => {
    const crosshair = fakeEl();
    const { doc } = fakeDoc({ crosshair });
    setCrosshairWeapon(doc as unknown as Document, "blaster");
    expect(crosshair.attrs.get("data-weapon")).toBe("pistol");
  });

  it("is a no-op without a crosshair element", () => {
    const { doc } = fakeDoc({});
    expect(() =>
      setCrosshairWeapon(doc as unknown as Document, "rifle"),
    ).not.toThrow();
  });
});

describe("flashKillMarker", () => {
  it("holds the kill window at or above the hit window", () => {
    expect(CROSSHAIR_KILL_MS).toBeGreaterThanOrEqual(CROSSHAIR_HIT_MS);
  });

  it("adds kill and removes it on the timer", () => {
    const crosshair = fakeEl();
    const { doc, timers } = fakeDoc({ crosshair });
    flashKillMarker(doc as unknown as Document);
    expect(crosshair.classList.list.has("kill")).toBe(true);
    expect(timers).toHaveLength(1);
    for (const timer of timers) {
      timer();
    }
    expect(crosshair.classList.list.has("kill")).toBe(false);
  });

  it("is a no-op without a crosshair element", () => {
    const { doc } = fakeDoc({});
    expect(() => flashKillMarker(doc as unknown as Document)).not.toThrow();
  });
});

describe("updateCrosshairState", () => {
  it("shows the scope overlay and hides the reticle while scoped", () => {
    const crosshair = fakeEl();
    const scope = fakeEl();
    scope.style.display = "none";
    const { doc } = fakeDoc({ crosshair, scope });
    updateCrosshairState(doc as unknown as Document, "sniper", true);
    expect(crosshair.attrs.get("data-weapon")).toBe("sniper");
    expect(scope.style.display).toBe("");
    expect(crosshair.classList.list.has("scoped")).toBe(true);
  });

  it("hides the overlay and restores the reticle unscoped", () => {
    const crosshair = fakeEl();
    crosshair.classList.list.add("scoped");
    const scope = fakeEl();
    scope.style.display = "";
    const { doc } = fakeDoc({ crosshair, scope });
    updateCrosshairState(doc as unknown as Document, "pistol", false);
    expect(scope.style.display).toBe("none");
    expect(crosshair.classList.list.has("scoped")).toBe(false);
  });
});

describe("updateHud HU-01 states", () => {
  /** Full handle shape with nulls plus the element under test. */
  function fullHandles(extra: Partial<HudHandles>): HudHandles {
    return {
      hud: null,
      health: null,
      hpFill: null,
      fuel: null,
      grenades: null,
      weapon: null,
      ammo: null,
      score: null,
      timer: null,
      killfeed: null,
      respawn: null,
      endScreen: null,
      endStandings: null,
      ammoModule: null,
      ammoIcon: null,
      ammoName: null,
      ammoCounts: null,
      ammoPips: null,
      ...extra,
    };
  }

  it("swaps the HP state token with the live value", () => {
    const hpFill = fakeEl();
    const handles = fullHandles({ hpFill: hpFill as unknown as HTMLElement });
    updateHud(handles, baseSnapshot({ hp: 100 }));
    expect(hpFill.classList.list.has("hp-high")).toBe(true);
    updateHud(handles, baseSnapshot({ hp: 45 }));
    expect(hpFill.classList.list.has("hp-mid")).toBe(true);
    expect(hpFill.classList.list.has("hp-high")).toBe(false);
    updateHud(handles, baseSnapshot({ hp: 10 }));
    expect(hpFill.classList.list.has("hp-low")).toBe(true);
    expect(hpFill.attrs.get("data-state")).toBe("hp-low");
  });

  it("flags low fuel without touching the width write", () => {
    const fuel = fakeEl();
    const handles = fullHandles({ fuel: fuel as unknown as HTMLElement });
    updateHud(handles, baseSnapshot({ fuel: 100 }));
    expect(fuel.classList.list.has("fuel-low")).toBe(false);
    updateHud(handles, baseSnapshot({ fuel: 10 }));
    expect(fuel.classList.list.has("fuel-low")).toBe(true);
    expect(fuel.style.width).toBe("10%");
  });

  it("reconciles three status grenade pips", () => {
    const children: { attrs: Map<string, string> }[] = [];
    const grenadePips = {
      children,
      ownerDocument: {
        createElement: (): unknown => {
          const attrs = new Map<string, string>();
          const node = {
            attrs,
            className: "",
            setAttribute: (k: string, v: string): void => {
              attrs.set(k, v);
            },
            getAttribute: (k: string): string | null => attrs.get(k) ?? null,
          };
          children.push(node);
          return node;
        },
      },
      appendChild: (kid: { attrs: Map<string, string> }): void => {
        if (!children.includes(kid)) {
          children.push(kid);
        }
      },
      removeChild: (kid: { attrs: Map<string, string> }): void => {
        const index = children.indexOf(kid);
        if (index >= 0) {
          children.splice(index, 1);
        }
      },
    };
    const handles = fullHandles({ grenadePips: grenadePips as unknown as HTMLElement });
    updateHud(handles, baseSnapshot({ grenades: 2 }));
    expect(children.length).toBe(3);
    expect(children.filter((kid) => (kid.attrs.get("class") ?? "").includes("filled")).length).toBe(
      2,
    );
  });

  it("writes the countdown into the respawn card when mounted", () => {
    const respawn = { textContent: "", style: { display: "none" } };
    const card = { textContent: "" };
    const handles = fullHandles({
      respawn: respawn as unknown as HTMLElement,
      respawnCard: card as unknown as HTMLElement,
    });
    updateHud(
      handles,
      baseSnapshot({ localAlive: false, respawnTicks: 120, killedBy: null }),
    );
    expect(respawn.style.display).toBe("");
    expect(card.textContent).toMatch(/Respawning in/);
    expect(respawn.textContent).toBe("");
  });

  it("falls back to the overlay node without a card", () => {
    const respawn = { textContent: "", style: { display: "none" } };
    const handles = fullHandles({ respawn: respawn as unknown as HTMLElement });
    updateHud(
      handles,
      baseSnapshot({ localAlive: false, respawnTicks: 120, killedBy: null }),
    );
    expect(respawn.textContent).toMatch(/Respawning in/);
  });
});
