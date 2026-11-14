// Bottom-right ammo module tests: pure display-model cases plus
// fake-element binder drives (no jsdom), mirroring the updateHud ammo /
// resources block construction style.
import { describe, expect, it } from "vitest";
import { GRENADE_MAX } from "../../core/src/constants";
import {
  AMMO_RESERVE_MULTIPLIER,
  buildAmmo,
  displayNameFor,
  formatAmmoCounts,
  grenadePipStates,
  iconFor,
  normalizeWeaponId,
  pipClass,
  reserveFor,
  updateAmmo,
  type AmmoHandles,
  type AmmoSnapshot,
} from "../src/ui/ammo";

describe("normalizeWeaponId", () => {
  it("resolves ids case- and whitespace-insensitively", () => {
    expect(normalizeWeaponId("smg")).toBe("smg");
    expect(normalizeWeaponId(" SMG ")).toBe("smg");
    expect(normalizeWeaponId("Rifle")).toBe("rifle");
    expect(normalizeWeaponId("rocket")).toBe("rocket");
  });

  it("resolves the Hornet aliases to the SMG", () => {
    expect(normalizeWeaponId("hornet")).toBe("smg");
    expect(normalizeWeaponId("Hornet")).toBe("smg");
    expect(normalizeWeaponId("hornet smg")).toBe("smg");
    expect(normalizeWeaponId("  Hornet SMG  ")).toBe("smg");
  });

  it("falls back to the pistol for unknown or missing readings", () => {
    expect(normalizeWeaponId("blaster")).toBe("pistol");
    expect(normalizeWeaponId("")).toBe("pistol");
    expect(normalizeWeaponId(null)).toBe("pistol");
    expect(normalizeWeaponId(undefined)).toBe("pistol");
    expect(normalizeWeaponId(42)).toBe("pistol");
  });
});

describe("displayNameFor", () => {
  it("names the SMG Hornet SMG", () => {
    expect(displayNameFor("smg")).toBe("Hornet SMG");
    expect(displayNameFor("hornet")).toBe("Hornet SMG");
    expect(displayNameFor("smg")).toContain("Hornet");
  });

  it("reads every other weapon from the stat table", () => {
    expect(displayNameFor("pistol")).toBe("Pistol");
    expect(displayNameFor("rifle")).toBe("Rifle");
    expect(displayNameFor("shotgun")).toBe("Shotgun");
    expect(displayNameFor("sniper")).toBe("Sniper");
    expect(displayNameFor("rocket")).toBe("Rocket");
  });

  it("falls back to the pistol name for unknown readings", () => {
    expect(displayNameFor("blaster")).toBe("Pistol");
  });
});

describe("reserveFor", () => {
  it("reads 3x the stat-table mag", () => {
    expect(AMMO_RESERVE_MULTIPLIER).toBe(3);
    expect(reserveFor("smg")).toBe(96);
    expect(reserveFor("pistol")).toBe(36);
    expect(reserveFor("rifle")).toBe(90);
    expect(reserveFor("shotgun")).toBe(15);
    expect(reserveFor("sniper")).toBe(15);
    expect(reserveFor("rocket")).toBe(6);
  });
});

describe("formatAmmoCounts", () => {
  it("formats mag/reserve per weapon", () => {
    expect(formatAmmoCounts(32, "smg")).toBe("32/96");
    expect(formatAmmoCounts(12, "pistol")).toBe("12/36");
    expect(formatAmmoCounts(30, "rifle")).toBe("30/90");
    expect(formatAmmoCounts(5, "shotgun")).toBe("5/15");
    expect(formatAmmoCounts(5, "sniper")).toBe("5/15");
    expect(formatAmmoCounts(2, "rocket")).toBe("2/6");
  });

  it("tracks mag deltas against a fixed reserve", () => {
    expect(formatAmmoCounts(27, "smg")).toBe("27/96");
  });

  it("clamps negative and non-finite mags at zero", () => {
    expect(formatAmmoCounts(-4, "smg")).toBe("0/96");
    expect(formatAmmoCounts(Number.NaN, "smg")).toBe("0/96");
  });
});

describe("grenadePipStates", () => {
  it("fills the first n of exactly GRENADE_MAX pips", () => {
    expect(GRENADE_MAX).toBe(3);
    expect(grenadePipStates(3)).toEqual([true, true, true]);
    expect(grenadePipStates(2)).toEqual([true, true, false]);
    expect(grenadePipStates(0)).toEqual([false, false, false]);
  });

  it("clamps out-of-range and non-finite counts", () => {
    expect(grenadePipStates(9)).toEqual([true, true, true]);
    expect(grenadePipStates(-2)).toEqual([false, false, false]);
    expect(grenadePipStates(Number.NaN)).toEqual([false, false, false]);
  });

  it("labels pip classes for the capture probe", () => {
    expect(pipClass(true)).toBe("pip filled");
    expect(pipClass(false)).toBe("pip empty");
  });
});

describe("iconFor", () => {
  it("maps the SMG to the Hornet card art", () => {
    expect(iconFor("smg")).toBe("./assets/weapon-hornet.svg");
  });

  it("maps every other weapon to its own card", () => {
    expect(iconFor("pistol")).toBe("./assets/weapon-pistol.svg");
    expect(iconFor("rifle")).toBe("./assets/weapon-rifle.svg");
    expect(iconFor("shotgun")).toBe("./assets/weapon-shotgun.svg");
    expect(iconFor("sniper")).toBe("./assets/weapon-sniper.svg");
    expect(iconFor("rocket")).toBe("./assets/weapon-rocket.svg");
  });

  it("falls back to the pistol card for unknown readings", () => {
    expect(iconFor("blaster")).toBe("./assets/weapon-pistol.svg");
  });
});

/** Fake text element (textContent plus a data-value attr mirror). */
function fakeText(): {
  textContent: string;
  attrs: Map<string, string>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
} {
  const attrs = new Map<string, string>();
  return {
    textContent: "",
    attrs,
    setAttribute(k: string, v: string): void {
      attrs.set(k, v);
    },
    getAttribute(k: string): string | null {
      return attrs.get(k) ?? null;
    },
  };
}

/** Fake image element carrying src/alt as plain props plus attrs. */
function fakeImg(): {
  src: string;
  alt: string;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
} {
  const attrs = new Map<string, string>();
  return {
    src: "",
    alt: "",
    setAttribute(k: string, v: string): void {
      attrs.set(k, v);
      if (k === "src") {
        (this as { src: string }).src = v;
      }
      if (k === "alt") {
        (this as { alt: string }).alt = v;
      }
    },
    getAttribute(k: string): string | null {
      return attrs.get(k) ?? null;
    },
  };
}

/** Fake pip span with class storage via attrs and className. */
function fakePip(): {
  className: string;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
} {
  const attrs = new Map<string, string>();
  return {
    className: "",
    setAttribute(k: string, v: string): void {
      attrs.set(k, v);
      if (k === "class") {
        (this as { className: string }).className = v;
      }
    },
    getAttribute(k: string): string | null {
      if (k === "class") {
        const direct = (this as { className: string }).className;
        if (direct !== "") {
          return direct;
        }
      }
      return attrs.get(k) ?? null;
    },
  };
}

/** Fake pips container with a working element builder (no jsdom). */
function fakePipsContainer(): {
  children: object[];
  ownerDocument: { createElement(tag: string): object };
  appendChild(child: object): void;
  removeChild(child: object): void;
} {
  const children: object[] = [];
  return {
    children,
    ownerDocument: {
      createElement: (): object => fakePip(),
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

function ammoHandles(): {
  handles: AmmoHandles;
  name: ReturnType<typeof fakeText>;
  counts: ReturnType<typeof fakeText>;
  icon: ReturnType<typeof fakeImg>;
  pips: ReturnType<typeof fakePipsContainer>;
} {
  const name = fakeText();
  const counts = fakeText();
  const icon = fakeImg();
  const pips = fakePipsContainer();
  const handles = {
    module: null,
    icon,
    name,
    counts,
    pips,
  } as unknown as AmmoHandles;
  return { handles, name, counts, icon, pips };
}

function filledPips(pips: { children: object[] }): number {
  let filled = 0;
  for (const child of pips.children) {
    const cls = (child as { getAttribute(k: string): string | null }).getAttribute(
      "class",
    );
    if (cls === "pip filled") {
      filled += 1;
    }
  }
  return filled;
}

describe("updateAmmo binder", () => {
  it("renders Hornet SMG 32/96 with three filled pips", () => {
    const { handles, name, counts, icon, pips } = ammoHandles();
    updateAmmo(handles, { magAmmo: 32, weapon: "smg", grenades: 3 });
    expect(name.textContent).toBe("Hornet SMG");
    expect(counts.textContent).toBe("32/96");
    expect(icon.src).toBe("./assets/weapon-hornet.svg");
    expect(pips.children.length).toBe(3);
    expect(filledPips(pips)).toBe(3);
  });

  it("drops to two pips after one grenade throw", () => {
    const { handles, pips } = ammoHandles();
    updateAmmo(handles, { magAmmo: 32, weapon: "smg", grenades: 3 });
    updateAmmo(handles, { magAmmo: 32, weapon: "smg", grenades: 2 });
    expect(pips.children.length).toBe(3);
    expect(filledPips(pips)).toBe(2);
  });

  it("tracks five fired rounds as 27/96", () => {
    const { handles, counts } = ammoHandles();
    updateAmmo(handles, { magAmmo: 32, weapon: "smg", grenades: 3 });
    updateAmmo(handles, { magAmmo: 27, weapon: "smg", grenades: 3 });
    expect(counts.textContent).toBe("27/96");
  });

  it("empties every pip at zero grenades", () => {
    const { handles, pips } = ammoHandles();
    updateAmmo(handles, { magAmmo: 32, weapon: "smg", grenades: 3 });
    updateAmmo(handles, { magAmmo: 32, weapon: "smg", grenades: 0 });
    expect(filledPips(pips)).toBe(0);
  });

  it("skips DOM writes when the snapshot is unchanged", () => {
    let writes = 0;
    let value = "";
    const name = {
      get textContent(): string {
        return value;
      },
      set textContent(next: string) {
        writes += 1;
        value = next;
      },
    };
    const snapshot: AmmoSnapshot = { magAmmo: 32, weapon: "smg", grenades: 3 };
    const handles = {
      module: null,
      icon: null,
      name,
      counts: null,
      pips: null,
    } as unknown as AmmoHandles;
    updateAmmo(handles, snapshot);
    expect(name.textContent).toBe("Hornet SMG");
    const firstWrites = writes;
    expect(firstWrites).toBeGreaterThan(0);
    updateAmmo(handles, { ...snapshot });
    expect(writes).toBe(firstWrites);
  });

  it("no-ops on null handles and all-null handles", () => {
    const snapshot: AmmoSnapshot = { magAmmo: 32, weapon: "smg", grenades: 3 };
    expect(() =>
      updateAmmo(null, snapshot),
    ).not.toThrow();
    expect(() =>
      updateAmmo(undefined, snapshot),
    ).not.toThrow();
    expect(() =>
      updateAmmo(
        { module: null, icon: null, name: null, counts: null, pips: null },
        snapshot,
      ),
    ).not.toThrow();
  });

  it("no-ops on builder-less pips containers", () => {
    const { handles } = ammoHandles();
    (handles as unknown as { pips: unknown }).pips = { textContent: "" };
    expect(() =>
      updateAmmo(handles, { magAmmo: 32, weapon: "smg", grenades: 3 }),
    ).not.toThrow();
  });
});

describe("buildAmmo", () => {
  it("reads all null when no module nodes exist", () => {
    const doc = {
      getElementById: (): null => null,
    } as unknown as Document;
    expect(buildAmmo(doc)).toEqual({
      module: null,
      icon: null,
      name: null,
      counts: null,
      pips: null,
    });
  });

  it("reads all null on docs without element lookup", () => {
    expect(buildAmmo({} as unknown as Document)).toEqual({
      module: null,
      icon: null,
      name: null,
      counts: null,
      pips: null,
    });
    expect(buildAmmo(null as unknown as Document)).toEqual({
      module: null,
      icon: null,
      name: null,
      counts: null,
      pips: null,
    });
  });
});
