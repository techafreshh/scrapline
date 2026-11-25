// Local profile tests: defaults/corrupt fallback, storage round-trip,
// name truncation, palette fallback, XP sums, the linear level curve,
// badge painting, and the shared local-name identity. Mirrors
// setup.test.ts (small local builders, behavior assertions, no padding,
// fake storage/docs only — no jsdom).
import { describe, expect, it } from "vitest";
import { LOCAL_CSS } from "../src/view/character";
import { ENEMY_A_CSS } from "../src/view/character";
import {
  endStandingsRows,
  playerName,
  standingsRows,
} from "../src/hud/hud";
import { tagColorFor, tagTextFor } from "../src/ui/nametags";
import {
  DEFAULT_PROFILE,
  PROFILE_KEY,
  XP_COMPLETE,
  XP_KILL,
  XP_WIN,
  awardMatchXp,
  bindProfile,
  ensureProfileBadge,
  formatLevelBadge,
  levelForXp,
  loadProfile,
  parseProfile,
  parseProfileName,
  parseProfilePalette,
  saveProfile,
  updateProfileBadge,
  xpForLevel,
  xpForMatch,
  type ProfileStorage,
} from "../src/meta/profile";

/** In-memory stand-in for localStorage. */
function fakeStorage(entries?: Record<string, string>): ProfileStorage {
  const backing = new Map<string, string>(Object.entries(entries ?? {}));
  return {
    getItem: (key: string): string | null =>
      backing.has(key) ? (backing.get(key) as string) : null,
    setItem: (key: string, value: string): void => {
      backing.set(key, value);
    },
  };
}

/** Minimal fake element with attrs, a style bag, children, and listeners. */
interface FakeEl {
  id: string;
  textContent: string | null;
  value: string;
  style: Record<string, string>;
  children: FakeEl[];
  listeners: Map<string, Array<() => void>>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(kid: FakeEl): void;
  addEventListener(type: string, listener: () => void): void;
  fire(type: string): void;
}

function makeEl(id = ""): FakeEl {
  const el: FakeEl = {
    id,
    textContent: "",
    value: "",
    style: {},
    children: [],
    listeners: new Map<string, Array<() => void>>(),
    setAttribute: (k: string, v: string): void => {
      if (k === "id") {
        el.id = v;
      }
    },
    getAttribute: (k: string): string | null =>
      k === "id" ? (el.id === "" ? null : el.id) : null,
    appendChild: (kid: FakeEl): void => {
      el.children.push(kid);
    },
    addEventListener: (type: string, listener: () => void): void => {
      const list = el.listeners.get(type) ?? [];
      list.push(listener);
      el.listeners.set(type, list);
    },
    fire: (type: string): void => {
      for (const listener of el.listeners.get(type) ?? []) {
        listener();
      }
    },
  };
  return el;
}

/** Minimal fake document resolving ids from a table. */
interface FakeDoc {
  elements: Map<string, FakeEl>;
  created: FakeEl[];
  getElementById(id: string): FakeEl | null;
  createElement(tag: string): FakeEl;
}

function makeDoc(ids: string[] = ["menu"]): FakeDoc {
  const elements = new Map<string, FakeEl>();
  for (const id of ids) {
    elements.set(id, makeEl(id));
  }
  const doc: FakeDoc = {
    elements,
    created: [],
    getElementById: (id: string): FakeEl | null =>
      elements.get(id) ?? doc.created.find((el) => el.id === id) ?? null,
    createElement: (): FakeEl => {
      const el = makeEl();
      doc.created.push(el);
      return el;
    },
  };
  // ensureProfileBadge prepends when available, else appends.
  const menu = elements.get("menu");
  if (menu !== undefined) {
    (menu as unknown as Record<string, unknown>)["prepend"] = (
      kid: FakeEl,
    ): void => {
      menu.children.unshift(kid);
    };
  }
  return doc;
}

describe("parseProfile", () => {
  it("falls back to defaults on empty or missing input", () => {
    expect(parseProfile(undefined)).toEqual(DEFAULT_PROFILE);
    expect(parseProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(parseProfile({})).toEqual(DEFAULT_PROFILE);
  });

  it("falls back per field on corrupt values", () => {
    expect(
      parseProfile({ name: 42, palette: "banana", xp: "zzz" }),
    ).toEqual(DEFAULT_PROFILE);
  });

  it("truncates long names to 16 chars", () => {
    expect(parseProfileName("a".repeat(20))).toBe("a".repeat(16));
  });

  it("strips control chars and blanks to the You fallback", () => {
    expect(parseProfileName("A\u0000B\u001FC")).toBe("ABC");
    expect(parseProfileName("   ")).toBe("");
    expect(parseProfileName(42)).toBe("");
  });

  it("keeps listed palettes canonical and other hex verbatim", () => {
    expect(parseProfilePalette("#FF6B35")).toBe("#FF6B35");
    expect(parseProfilePalette("#abcdef")).toBe("#abcdef");
    expect(parseProfilePalette("red")).toBe(DEFAULT_PROFILE.palette);
  });

  it("backfills xp from an explicit stored level", () => {
    expect(parseProfile({ level: 3 }).xp).toBe(200);
    expect(parseProfile({ xp: 250, level: 3 }).xp).toBe(250);
  });
});

describe("loadProfile/saveProfile", () => {
  it("returns defaults when storage is empty or absent", () => {
    expect(loadProfile(fakeStorage())).toEqual(DEFAULT_PROFILE);
    expect(loadProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(loadProfile(undefined)).toEqual(DEFAULT_PROFILE);
  });

  it("round-trips name, palette, and xp under scrapline.profile", () => {
    const storage = fakeStorage();
    saveProfile(storage, { name: "TestPilot", palette: "#FF6B35", xp: 90 });
    const raw = storage.getItem(PROFILE_KEY) ?? "";
    expect(JSON.parse(raw)).toEqual({
      name: "TestPilot",
      palette: "#FF6B35",
      xp: 90,
    });
    expect(loadProfile(storage)).toEqual({
      name: "TestPilot",
      palette: "#FF6B35",
      xp: 90,
    });
  });

  it("reads a seeded level-3 profile as Lv 3 XP", () => {
    const storage = fakeStorage({ [PROFILE_KEY]: '{"level":3}' });
    expect(loadProfile(storage).xp).toBe(200);
  });

  it("ignores corrupt JSON and throwing storage", () => {
    expect(loadProfile(fakeStorage({ [PROFILE_KEY]: "{nope" }))).toEqual(
      DEFAULT_PROFILE,
    );
    const throwing: ProfileStorage = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: (): void => {
        throw new Error("denied");
      },
    };
    expect(loadProfile(throwing)).toEqual(DEFAULT_PROFILE);
    expect(() =>
      saveProfile(throwing, { name: "X", palette: "#00E5FF", xp: 1 }),
    ).not.toThrow();
  });
});

describe("xp and levels", () => {
  it("awards 50 on win, 10 per kill, 20 on completion", () => {
    expect(XP_WIN).toBe(50);
    expect(XP_KILL).toBe(10);
    expect(XP_COMPLETE).toBe(20);
    expect(xpForMatch({ win: true, kills: 2, completed: true })).toBe(90);
    expect(xpForMatch({ win: false, kills: 0, completed: false })).toBe(0);
    expect(xpForMatch({ win: false, kills: 0, completed: true })).toBe(20);
  });

  it("follows the linear 100-XP level curve", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(200)).toBe(3);
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(3)).toBe(200);
  });

  it("formats the badge as Lv N with a Lv 1 floor", () => {
    expect(formatLevelBadge(3)).toBe("Lv 3");
    expect(formatLevelBadge(0)).toBe("Lv 1");
  });

  it("adds the match award onto the stored XP", () => {
    expect(
      awardMatchXp(
        { name: "", palette: "#00E5FF", xp: 0 },
        { win: true, kills: 2, completed: true },
      ).xp,
    ).toBe(90);
  });
});

describe("profile badge binder", () => {
  it("creates the badge inside #menu and paints Lv 3", () => {
    const doc = makeDoc();
    const badge = ensureProfileBadge(
      doc as unknown as Document,
    ) as unknown as FakeEl;
    expect(badge).not.toBeNull();
    const text = updateProfileBadge(doc as unknown as Document, {
      name: "TestPilot",
      palette: "#FF6B35",
      xp: 200,
    });
    expect(text).toBe("Lv 3");
    expect(badge.textContent).toBe("Lv 3");
    expect(badge.style["backgroundColor"]).toBe("#FF6B35");
  });

  it("reads Lv 3 from a seeded level-only profile", () => {
    const doc = makeDoc();
    expect(
      updateProfileBadge(doc as unknown as Document, { level: 3 }),
    ).toBe("Lv 3");
  });

  it("binds the editor: prefill, persist on input, repaint the badge", () => {
    const doc = makeDoc(["menu", "profile-name", "profile-palette"]);
    const storage = fakeStorage({
      [PROFILE_KEY]: JSON.stringify({
        name: "TestPilot",
        palette: "#00E5FF",
        xp: 200,
      }),
    });
    let changed = 0;
    const binder = bindProfile(doc as unknown as Document, storage, () => {
      changed += 1;
    });
    const nameInput = doc.elements.get("profile-name") as FakeEl;
    expect(nameInput.value).toBe("TestPilot");
    expect(binder.profile.name).toBe("TestPilot");
    nameInput.value = "Ace";
    nameInput.fire("input");
    expect(loadProfile(storage).name).toBe("Ace");
    expect(binder.profile.name).toBe("Ace");
    expect(changed).toBeGreaterThan(0);
    const badge = doc.elements.get("profile-badge") as unknown as
      | FakeEl
      | undefined;
    const created = doc.created[0] as FakeEl | undefined;
    expect((badge ?? created)?.textContent).toBe("Lv 3");
  });

  it("no-ops on builder-less docs", () => {
    expect(ensureProfileBadge({} as unknown as Document)).toBeNull();
    expect(updateProfileBadge({} as unknown as Document, {})).toBe("");
    expect(() =>
      bindProfile({} as unknown as Document, fakeStorage()),
    ).not.toThrow();
  });
});

describe("local name identity", () => {
  it("overrides the id-0 nametag with the pilot name", () => {
    expect(tagTextFor(0, "TestPilot")).toContain("TestPilot");
    expect(tagTextFor(0)).toBe("You");
    expect(tagTextFor(0, "   ")).toBe("You");
    expect(tagTextFor(1, "TestPilot")).not.toContain("TestPilot");
  });

  it("tints only the local tag with the avatar palette", () => {
    expect(tagColorFor(0, "#A3E635")).toBe("#A3E635");
    expect(tagColorFor(0)).toBe(LOCAL_CSS);
    expect(tagColorFor(1, "#A3E635")).toBe(ENEMY_A_CSS);
  });

  it("carries the pilot name through standings and end screens", () => {
    expect(playerName(0, "TestPilot")).toBe("TestPilot");
    expect(playerName(0)).toBe("You");
    const rows = standingsRows([3, 5], [0, 1], "TestPilot");
    expect(rows.find((row) => row.id === 0)?.name).toBe("TestPilot");
    const end = endStandingsRows([3, 5], [0, 0], [0, 1], "TestPilot");
    expect(end.find((row) => row.id === 0)?.name).toBe("TestPilot");
  });
});
