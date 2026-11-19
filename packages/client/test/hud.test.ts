// HUD helper tests: names, ordinals, timer text, standings rows, and
// score/alive-diff kill attribution. Pure helpers only (no DOM/jsdom),
// mirroring packages/core/test builder style.
import { describe, expect, it } from "vitest";
import { ENEMY_A_CSS, ENEMY_B_CSS, LOCAL_CSS } from "../src/view/character";
import {
  BOT_NAMES,
  endStandingsRows,
  flashHpDamage,
  formatTimer,
  HP_DAMAGE_FLASH_MS,
  killsFromDiff,
  onlineScoreRows,
  ordinal,
  playerColor,
  playerName,
  pushKillfeed,
  renderOnlineScoreboard,
  standingsRows,
  updateHud,
  type HudHandles,
  type HudSnapshot,
} from "../src/hud/hud";

describe("playerName", () => {
  it("names the local id 0 You and bots from the generated pool", () => {
    expect(BOT_NAMES).toHaveLength(12);
    expect(playerName(0)).toBe("You");
    expect(playerName(1)).toBe(BOT_NAMES[0]);
    expect(playerName(3)).toBe(BOT_NAMES[2]);
  });

  it("wraps bot ids around the 12-name pool", () => {
    expect(playerName(13)).toBe(BOT_NAMES[0]);
    expect(playerName(12)).toBe(BOT_NAMES[11]);
  });
});

describe("ordinal", () => {
  it("labels 1st, 2nd, 3rd, 4th, and 11th", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
  });

  it("keeps the teen exception and rolls over at 21st", () => {
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
  });
});

describe("formatTimer", () => {
  it("shows 5:00 at tick 0 of an 18000-tick limit", () => {
    expect(formatTimer(0, 18000)).toBe("5:00");
  });

  it("counts down and clamps at 0:00 past the cap", () => {
    expect(formatTimer(17940, 18000)).toBe("0:01");
    expect(formatTimer(18000, 18000)).toBe("0:00");
    expect(formatTimer(19000, 18000)).toBe("0:00");
  });
});

describe("standingsRows", () => {
  it("orders by score desc, id asc on ties, with ordinal ranks", () => {
    const rows = standingsRows([3, 5, 5], [0, 1, 2]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 0]);
    expect(rows.map((row) => row.rank)).toEqual(["1st", "2nd", "3rd"]);
    expect(rows[0]).toMatchObject({ name: BOT_NAMES[0], score: 5 });
    expect(rows[2]).toMatchObject({ name: "You", score: 3 });
  });
});

describe("endStandingsRows", () => {
  it("orders by kills desc with id-asc tiebreak", () => {
    const rows = endStandingsRows([3, 5, 5], [0, 0, 0], [0, 1, 2]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 0]);
    expect(rows.map((row) => row.kills)).toEqual([5, 5, 3]);
  });

  it("marks only the first row winner", () => {
    const rows = endStandingsRows([3, 5, 5], [0, 0, 0], [0, 1, 2]);
    expect(rows.map((row) => row.winner)).toEqual([true, false, false]);
  });

  it("defaults missing death entries to 0", () => {
    const rows = endStandingsRows([1, 0], [], [0, 1]);
    expect(rows.map((row) => row.deaths)).toEqual([0, 0]);
    const partial = endStandingsRows([1, 0], [2], [0, 1]);
    expect(partial.map((row) => row.deaths)).toEqual([2, 0]);
  });

  it("names id 0 You and bots from the pool", () => {
    const rows = endStandingsRows([3, 5], [1, 2], [0, 1]);
    expect(rows[1]).toMatchObject({ id: 0, name: "You", kills: 3, deaths: 1 });
    expect(rows[0]).toMatchObject({
      id: 1,
      name: BOT_NAMES[0],
      kills: 5,
      deaths: 2,
    });
  });
});

describe("killsFromDiff", () => {
  it("attributes a single kill to the scorer", () => {
    const kills = killsFromDiff([0, 0], [1, 0], [true, true], [true, false]);
    expect(kills).toEqual([{ killerId: 0, victimId: 1 }]);
  });

  it("reports killer null for unattributed deaths", () => {
    const kills = killsFromDiff([0, 0], [0, 0], [true, true], [true, false]);
    expect(kills).toEqual([{ killerId: null, victimId: 1 }]);
  });

  it("pairs two same-tick kills with their scorers in order", () => {
    const kills = killsFromDiff(
      [0, 0, 0, 0],
      [1, 0, 1, 0],
      [true, true, true, true],
      [true, false, true, false],
    );
    expect(kills).toEqual([
      { killerId: 0, victimId: 1 },
      { killerId: 2, victimId: 3 },
    ]);
  });
});

describe("updateHud ammo", () => {
  it("renders weapon plus mag only from a reserve-free snapshot", () => {
    const ammo = { textContent: "" };
    const handles = {
      hud: null,
      health: null,
      fuel: null,
      grenades: null,
      weapon: null,
      ammo,
      score: null,
      timer: null,
      killfeed: null,
      respawn: null,
      endScreen: null,
      endStandings: null,
    } as unknown as HudHandles;
    const snapshot = {
      hp: 100,
      fuel: 100,
      magAmmo: 7,
      weaponName: "Pistol",
      grenades: 3,
      killedBy: null,
      scores: [0],
      ids: [0],
      tick: 0,
      timeLimitTicks: 18000,
      localAlive: true,
      respawnTicks: 0,
    } as HudSnapshot;
    expect("reserveAmmo" in snapshot).toBe(false);
    updateHud(handles, snapshot);
    expect(ammo.textContent).toBe("Pistol 7");
  });
});

describe("updateHud resources", () => {
  function resourceHandles(): {
    handles: HudHandles;
    weapon: { textContent: string | null };
    grenades: { textContent: string | null };
    fuel: { style: { width: string } };
    respawn: { textContent: string | null; style: { display: string } };
  } {
    const weapon = { textContent: "" };
    const grenades = { textContent: "" };
    const fuel = { style: { width: "" } };
    const respawn = { textContent: "", style: { display: "none" } };
    const handles = {
      hud: null,
      health: null,
      fuel,
      grenades,
      weapon,
      ammo: null,
      score: null,
      timer: null,
      killfeed: null,
      respawn,
      endScreen: null,
      endStandings: null,
    } as unknown as HudHandles;
    return { handles, weapon, grenades, fuel, respawn };
  }

  function baseSnapshot(overrides: Partial<HudSnapshot>): HudSnapshot {
    return {
      hp: 100,
      fuel: 100,
      magAmmo: 7,
      weaponName: "rifle",
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

  it("mirrors the weapon id verbatim in lowercase", () => {
    const { handles, weapon } = resourceHandles();
    updateHud(handles, baseSnapshot({ weaponName: "rocket" }));
    expect(weapon.textContent).toBe("rocket");
  });

  it("mirrors the grenade count as plain text", () => {
    const { handles, grenades } = resourceHandles();
    updateHud(handles, baseSnapshot({ grenades: 2 }));
    expect(grenades.textContent).toBe("2");
  });

  it("maps fuel 0/100 to 0%/100% width", () => {
    const { handles, fuel } = resourceHandles();
    updateHud(handles, baseSnapshot({ fuel: 0 }));
    expect(fuel.style.width).toBe("0%");
    updateHud(handles, baseSnapshot({ fuel: 100 }));
    expect(fuel.style.width).toBe("100%");
  });

  it("renders eliminated-by in the respawn node while dead, hides it alive", () => {
    const { handles, respawn } = resourceHandles();
    updateHud(
      handles,
      baseSnapshot({ localAlive: false, respawnTicks: 180, killedBy: "Bot 1" }),
    );
    expect(respawn.style.display).toBe("");
    expect(respawn.textContent).toMatch(/eliminated by Bot 1/);
    updateHud(handles, baseSnapshot({ localAlive: true, killedBy: null }));
    expect(respawn.style.display).toBe("none");
  });

  it("falls back to the plain respawn text when the killer is null", () => {
    const { handles, respawn } = resourceHandles();
    updateHud(
      handles,
      baseSnapshot({ localAlive: false, respawnTicks: 120, killedBy: null }),
    );
    expect(respawn.textContent).toMatch(/Respawning in/);
    expect(respawn.textContent).not.toMatch(/eliminated by/);
  });
});

describe("pushKillfeed entry class", () => {
  it("tags entries with kill-entry flash and keeps the 5-entry cap", () => {
    const created: { textContent: string | null; attrs: Map<string, string> }[] = [];
    const children: object[] = [];
    const feed = {
      ownerDocument: {
        createElement: () => {
          const entry = {
            textContent: null as string | null,
            attrs: new Map<string, string>(),
            setAttribute: (key: string, value: string): void => {
              entry.attrs.set(key, value);
            },
            getAttribute: (key: string): string | null =>
              entry.attrs.get(key) ?? null,
          };
          created.push(entry);
          return entry;
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
      get children(): object[] {
        return children;
      },
    };
    const handles = {
      hud: null,
      health: null,
      fuel: null,
      grenades: null,
      weapon: null,
      ammo: null,
      score: null,
      timer: null,
      killfeed: feed,
      respawn: null,
      endScreen: null,
      endStandings: null,
    } as unknown as HudHandles;
    for (let i = 0; i < 7; i += 1) {
      pushKillfeed(handles, `Bot ${i + 1}`, "You");
    }
    expect(children.length).toBe(5);
    for (const entry of created) {
      expect(entry.attrs.get("class")).toBe("kill-entry flash");
    }
    expect(created[6]?.textContent).toBe("Bot 7 \u25B8 You");
  });
});

describe("pushKillfeed weapon entries", () => {
  /** Fake element with attrs, a style bag, children, and a class list. */
  function fakeNode(
    doc: { createElement(tag: string): FakeNode },
    tag: string,
  ): FakeNode {
    const attrs = new Map<string, string>();
    const node: FakeNode = {
      tag,
      attrs,
      style: {},
      textContent: "",
      children: [],
      ownerDocument: doc,
      setAttribute: (key: string, value: string): void => {
        attrs.set(key, value);
      },
      getAttribute: (key: string): string | null => attrs.get(key) ?? null,
      appendChild: (kid: FakeNode): void => {
        node.children.push(kid);
      },
      removeChild: (kid: FakeNode): void => {
        const index = node.children.indexOf(kid);
        if (index >= 0) {
          node.children.splice(index, 1);
        }
      },
    };
    return node;
  }

  interface FakeNode {
    tag: string;
    attrs: Map<string, string>;
    style: Record<string, string>;
    textContent: string;
    children: FakeNode[];
    ownerDocument: unknown;
    setAttribute(key: string, value: string): void;
    getAttribute(key: string): string | null;
    appendChild(kid: FakeNode): void;
    removeChild(kid: FakeNode): void;
  }

  function fakeFeed(): {
    handles: HudHandles;
    feed: FakeNode;
    timers: Array<() => void>;
  } {
    const timers: Array<() => void> = [];
    const doc = {
      createElement: (tag: string): FakeNode => fakeNode(doc, tag),
      defaultView: {
        setTimeout: (fn: () => void): number => {
          timers.push(fn);
          return timers.length;
        },
      },
    };
    const feed = fakeNode(doc, "div");
    const handles = { killfeed: feed } as unknown as HudHandles;
    return { handles, feed, timers };
  }

  it("renders colored names with a weapon icon between them", () => {
    const { handles, feed } = fakeFeed();
    pushKillfeed(handles, "Raptor", "You", "smg", 1, 0);
    expect(feed.children).toHaveLength(1);
    const entry = feed.children[0];
    expect(entry.children).toHaveLength(4);
    const [killer, icon, , victim] = entry.children;
    expect(killer.textContent).toBe("Raptor");
    expect(killer.getAttribute("class")).toBe("killer");
    expect(killer.style["color"]).toBe(ENEMY_A_CSS);
    expect(icon.tag).toBe("img");
    expect(icon.getAttribute("class")).toBe("kill-weapon");
    expect(icon.getAttribute("src")).toBe("./assets/weapon-hornet.svg");
    expect(victim.textContent).toBe("You");
    expect(victim.style["color"]).toBe(LOCAL_CSS);
  });

  it("paints a bot victim span with its team color", () => {
    const { handles, feed } = fakeFeed();
    pushKillfeed(handles, "Raptor", "Viper", "rifle", 1, 2);
    expect(feed.children).toHaveLength(1);
    const entry = feed.children[0];
    expect(entry.children).toHaveLength(4);
    const [, , , victim] = entry.children;
    expect(victim.textContent).toBe("Viper");
    expect(victim.getAttribute("class")).toBe("victim");
    expect(victim.style["color"]).toBe(ENEMY_B_CSS);
  });

  it("renders suicides as `X died` with no icon", () => {
    const { handles, feed } = fakeFeed();
    pushKillfeed(handles, null, "You", null, null, 0);
    expect(feed.children).toHaveLength(1);
    const entry = feed.children[0];
    expect(entry.children).toHaveLength(0);
    expect(entry.textContent).toBe("You died");
  });

  it("keeps the flat `Killer ▸ Victim` line for weapon-less killer blows", () => {
    const { handles, feed } = fakeFeed();
    pushKillfeed(handles, "Raptor", "You");
    const entry = feed.children[0];
    expect(entry.children).toHaveLength(0);
    expect(entry.textContent).toBe("Raptor \u25B8 You");
  });
});

describe("onlineScoreRows", () => {
  it("lists all three pids in pid order even when scores sort otherwise", () => {
    const roster = [
      { id: 0, name: "Alice" },
      { id: 1, name: "Bob" },
      { id: 2, name: "Viper" },
    ];
    const rows = onlineScoreRows(roster, [
      { id: 0, score: 0 },
      { id: 1, score: 0 },
      { id: 2, score: 4 },
    ]);
    expect(rows.map((row) => row.id)).toEqual([0, 1, 2]);
    expect(rows.map((row) => row.name)).toEqual(["Alice", "Bob", "Viper"]);
    expect(rows.map((row) => row.score)).toEqual([0, 0, 4]);
  });

  it("mirrors all three names into the HUD score node", () => {
    const score = { textContent: "" };
    renderOnlineScoreboard(
      score,
      [
        { id: 0, name: "Alice" },
        { id: 1, name: "Bob" },
        { id: 2, name: "Viper" },
      ],
      [
        { id: 0, score: 1 },
        { id: 1, score: 2 },
        { id: 2, score: 3 },
      ],
    );
    expect(score.textContent).toContain("Alice");
    expect(score.textContent).toContain("Bob");
    expect(score.textContent).toContain("Viper");
    expect(score.textContent.indexOf("Alice")).toBeLessThan(
      score.textContent.indexOf("Bob"),
    );
    expect(score.textContent.indexOf("Bob")).toBeLessThan(
      score.textContent.indexOf("Viper"),
    );
  });
});

describe("playerColor", () => {
  it("reads the team source per index and null when unknown", () => {
    expect(playerColor(0)).toBe(LOCAL_CSS);
    expect(playerColor(1)).toBe(ENEMY_A_CSS);
    expect(playerColor(null)).toBe(null);
    expect(playerColor(Number.NaN)).toBe(null);
  });
});

describe("updateHud pixel chrome snapshot (issue #270)", () => {
  /** Fake handles with text, attr capture, and a style bag. */
  function chromeHandles(): {
    handles: HudHandles;
    hud: { attrs: Map<string, string>; style: Record<string, string> };
    health: { textContent: string | null };
    ammo: { textContent: string | null };
  } {
    const hud = { attrs: new Map<string, string>(), style: {} as Record<string, string> };
    const hudEl = {
      setAttribute: (k: string, v: string): void => {
        hud.attrs.set(k, v);
      },
      getAttribute: (k: string): string | null => hud.attrs.get(k) ?? null,
      style: hud.style,
    };
    const health = { textContent: "" as string | null };
    const ammo = { textContent: "" as string | null };
    const handles = {
      hud: hudEl,
      health,
      fuel: null,
      grenades: null,
      weapon: null,
      ammo,
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
    } as unknown as HudHandles;
    return { handles, hud, health, ammo };
  }

  it("mirrors 75 HP / 12 mag digits with the `ui.` HUD frame key", () => {
    const { handles, hud, health, ammo } = chromeHandles();
    updateHud(handles, {
      hp: 75,
      fuel: 100,
      magAmmo: 12,
      weaponName: "rifle",
      grenades: 3,
      killedBy: null,
      scores: [0],
      ids: [0],
      tick: 0,
      timeLimitTicks: 18000,
      localAlive: true,
      respawnTicks: 0,
    } as HudSnapshot);
    expect(health.textContent).toBe("75");
    expect(ammo.textContent).toContain("12");
    expect(hud.attrs.get("data-frame")).toContain("ui.");
  });
});

describe("updateHud HP bar width (issue #318)", () => {
  function hpHandles(): {
    handles: HudHandles;
    hpFill: { style: { width: string } };
  } {
    const hpFill = { style: { width: "" } };
    const handles = {
      hud: null,
      health: null,
      hpFill,
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
    } as unknown as HudHandles;
    return { handles, hpFill };
  }

  function hpSnapshot(hp: number): HudSnapshot {
    return {
      hp,
      fuel: 100,
      magAmmo: 7,
      weaponName: "rifle",
      grenades: 3,
      killedBy: null,
      scores: [0],
      ids: [0],
      tick: 0,
      timeLimitTicks: 18000,
      localAlive: true,
      respawnTicks: 0,
    } as HudSnapshot;
  }

  it("maps hp 0/75/100 to 0%/75%/100% width", () => {
    const { handles, hpFill } = hpHandles();
    updateHud(handles, hpSnapshot(0));
    expect(hpFill.style.width).toBe("0%");
    updateHud(handles, hpSnapshot(75));
    expect(hpFill.style.width).toBe("75%");
    updateHud(handles, hpSnapshot(100));
    expect(hpFill.style.width).toBe("100%");
  });

  it("clamps out-of-range hp into 0..100%", () => {
    const { handles, hpFill } = hpHandles();
    updateHud(handles, hpSnapshot(-20));
    expect(hpFill.style.width).toBe("0%");
    updateHud(handles, hpSnapshot(240));
    expect(hpFill.style.width).toBe("100%");
  });

  it("skips the width write when the HP handle is missing", () => {
    const { handles } = hpHandles();
    handles.hpFill = null;
    expect(() => updateHud(handles, hpSnapshot(75))).not.toThrow();
  });
});

describe("flashHpDamage (issue #318)", () => {
  /** Fake doc resolving #hud-hp to a classList-only element. */
  function fakeHpDoc(): {
    doc: Document;
    classes: Set<string>;
    timers: { fn: () => void; cleared: boolean }[];
  } {
    const classes = new Set<string>();
    const timers: { fn: () => void; cleared: boolean }[] = [];
    const el = {
      classList: {
        add: (c: string): void => {
          classes.add(c);
        },
        remove: (c: string): void => {
          classes.delete(c);
        },
      },
    };
    const view = {
      setTimeout: (fn: () => void): number => {
        timers.push({ fn, cleared: false });
        return timers.length - 1;
      },
      clearTimeout: (id: number): void => {
        if (timers[id] !== undefined) {
          timers[id].cleared = true;
        }
      },
    };
    const doc = {
      getElementById: (id: string): unknown =>
        id === "hud-hp" ? el : null,
      defaultView: view,
    } as unknown as Document;
    return { doc, classes, timers };
  }

  it("holds the flash window inside the 1500ms recovery budget", () => {
    expect(HP_DAMAGE_FLASH_MS).toBeGreaterThan(0);
    expect(HP_DAMAGE_FLASH_MS).toBeLessThan(1500);
  });

  it("adds hurt synchronously and clears it when the timer fires", () => {
    const { doc, classes, timers } = fakeHpDoc();
    flashHpDamage(doc);
    expect(classes.has("hurt")).toBe(true);
    expect(timers).toHaveLength(1);
    timers[0].fn();
    expect(classes.has("hurt")).toBe(false);
  });

  it("re-arms the full window: a stale timer never clears early", () => {
    const { doc, classes, timers } = fakeHpDoc();
    flashHpDamage(doc);
    flashHpDamage(doc);
    expect(timers).toHaveLength(2);
    timers[0].fn();
    expect(classes.has("hurt")).toBe(true);
    timers[1].fn();
    expect(classes.has("hurt")).toBe(false);
  });

  it("never throws on builder-less or timer-less fake docs", () => {
    expect(() => flashHpDamage({} as Document)).not.toThrow();
    const bare = {
      getElementById: (): null => null,
    } as unknown as Document;
    expect(() => flashHpDamage(bare)).not.toThrow();
    const noTimers = {
      getElementById: (): unknown => ({
        classList: { add: (): void => {}, remove: (): void => {} },
      }),
    } as unknown as Document;
    expect(() => flashHpDamage(noTimers)).not.toThrow();
  });
});

describe("pushKillfeed own highlight (issue #318)", () => {
  function ownFeed(): {
    handles: HudHandles;
    created: { attrs: Map<string, string> }[];
  } {
    const created: { attrs: Map<string, string> }[] = [];
    const children: object[] = [];
    const feed = {
      ownerDocument: {
        createElement: () => {
          const entry = {
            textContent: null as string | null,
            attrs: new Map<string, string>(),
            setAttribute: (key: string, value: string): void => {
              entry.attrs.set(key, value);
            },
            getAttribute: (key: string): string | null =>
              entry.attrs.get(key) ?? null,
          };
          created.push(entry);
          return entry;
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
      get children(): object[] {
        return children;
      },
    };
    const handles = { killfeed: feed } as unknown as HudHandles;
    return { handles, created };
  }

  it("tags killer index 0 with the own token", () => {
    const { handles, created } = ownFeed();
    pushKillfeed(handles, "You", "Viper", null, 0, 1);
    expect(created[0]?.attrs.get("class")).toBe("kill-entry flash own");
  });

  it("leaves killer index 1 without the own token", () => {
    const { handles, created } = ownFeed();
    pushKillfeed(handles, "Raptor", "You", null, 1, 0);
    expect(created[0]?.attrs.get("class")).toBe("kill-entry flash");
  });

  it("leaves unattributed deaths without the own token", () => {
    const { handles, created } = ownFeed();
    pushKillfeed(handles, null, "You", null, null, 0);
    expect(created[0]?.attrs.get("class")).toBe("kill-entry flash");
  });

  it("tags structured weapon entries for killer index 0", () => {
    const { handles, created } = ownFeed();
    pushKillfeed(handles, "You", "Viper", "rifle", 0, 1);
    expect(created[0]?.attrs.get("class")).toBe("kill-entry flash own");
  });
});
