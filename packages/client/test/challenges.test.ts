// Daily challenge tests: local day-id identity plus rollover reset,
// rifle vs grenade vs bot kill attribution, dune-win gating, one-shot
// XP banking, and the 3-row `data-challenge` panel render. Mirrors
// profile.test.ts (small local builders, behavior assertions, no
// padding, fake storage/docs only — no jsdom).
import { describe, expect, it, afterEach } from "vitest";
import {
  bindChallenges,
  challengeProgressText,
  challengeRows,
  CHALLENGE_ROW_ATTR,
  CHALLENGE_TEMPLATES,
  CHALLENGES_KEY,
  CHALLENGES_OPEN_ID,
  CHALLENGES_PANEL_ID,
  collectDueXp,
  dayIdFor,
  defaultChallengeState,
  ensureChallengesPanel,
  loadChallenges,
  parseChallengeState,
  recordKill,
  recordWin,
  saveChallenges,
  updateChallengesPanel,
  type ChallengeStorage,
} from "../src/meta/challenges";

/** In-memory stand-in for localStorage. */
function fakeStorage(entries?: Record<string, string>): ChallengeStorage {
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
  className: string;
  textContent: string | null;
  style: Record<string, string>;
  children: FakeEl[];
  attrs: Map<string, string>;
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
    className: "",
    textContent: "",
    style: {},
    children: [],
    attrs: new Map<string, string>(),
    listeners: new Map<string, Array<() => void>>(),
    setAttribute: (k: string, v: string): void => {
      el.attrs.set(k, v);
      if (k === "id") {
        el.id = v;
      }
    },
    getAttribute: (k: string): string | null => {
      if (k === "id") {
        return el.id === "" ? null : el.id;
      }
      return el.attrs.has(k) ? (el.attrs.get(k) as string) : null;
    },
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

/** Minimal fake document resolving ids plus `[data-challenge]` scans. */
interface FakeDoc {
  elements: Map<string, FakeEl>;
  created: FakeEl[];
  getElementById(id: string): FakeEl | null;
  createElement(tag: string): FakeEl;
  querySelectorAll(sel: string): FakeEl[];
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
    querySelectorAll: (sel: string): FakeEl[] => {
      const out: FakeEl[] = [];
      const seen = new Set<FakeEl>();
      const collect = (el: FakeEl): void => {
        if (seen.has(el)) {
          return;
        }
        seen.add(el);
        if (sel === `[${CHALLENGE_ROW_ATTR}]`) {
          if (el.attrs.has(CHALLENGE_ROW_ATTR)) {
            out.push(el);
          }
        } else if (sel.startsWith(".")) {
          const want = sel.slice(1);
          if (el.className.split(/\s+/).includes(want)) {
            out.push(el);
          }
        }
        for (const kid of el.children) {
          collect(kid);
        }
      };
      for (const el of elements.values()) {
        collect(el);
      }
      for (const el of doc.created) {
        if (!elements.has(el.id) || el.id === "") {
          collect(el);
        }
      }
      return out;
    },
  };
  return doc;
}

/** Install a bare window stub so the probe mirror lands somewhere. */
function stubWindow(): void {
  (globalThis as { window?: unknown }).window = {};
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const TODAY = dayIdFor();

describe("day identity", () => {
  it("formats the local calendar day as zero-padded YYYY-MM-DD", () => {
    const stamp = new Date(2026, 0, 5, 12, 0, 0);
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
    expect(dayIdFor(stamp)).toBe(
      `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`,
    );
    expect(dayIdFor()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accepts epoch-ms and falls back to today on garbage", () => {
    expect(dayIdFor(new Date(2026, 4, 9).getTime())).toBe(dayIdFor(new Date(2026, 4, 9)));
    expect(dayIdFor("banana")).toBe(TODAY);
    expect(dayIdFor(NaN)).toBe(TODAY);
    expect(dayIdFor(null)).toBe(TODAY);
  });

  it("carries exactly the three fixed templates in order", () => {
    expect(CHALLENGE_TEMPLATES.map((t) => t.id)).toEqual([
      "rifle-5",
      "grenade-2",
      "win-dune-1",
    ]);
  });

  it("resets progress when the stored day differs from today", () => {
    const storage = fakeStorage({
      [CHALLENGES_KEY]: JSON.stringify({
        dayId: "2001-01-01",
        progress: {
          "rifle-5": { progress: 5, claimed: true },
          "grenade-2": { progress: 2, claimed: true },
          "win-dune-1": { progress: 1, claimed: true },
        },
      }),
    });
    const state = loadChallenges(storage);
    expect(state.dayId).toBe(TODAY);
    expect(state.progress["rifle-5"]).toEqual({ progress: 0, claimed: false });
  });

  it("keeps same-day progress across loads", () => {
    const storage = fakeStorage();
    saveChallenges(storage, {
      dayId: TODAY,
      progress: {
        "rifle-5": { progress: 3, claimed: false },
        "grenade-2": { progress: 0, claimed: false },
        "win-dune-1": { progress: 0, claimed: false },
      },
    });
    const state = loadChallenges(storage);
    expect(state.dayId).toBe(TODAY);
    expect(state.progress["rifle-5"]?.progress).toBe(3);
  });

  it("ignores corrupt JSON and throwing storage", () => {
    expect(loadChallenges(fakeStorage({ [CHALLENGES_KEY]: "{nope" })).dayId).toBe(
      TODAY,
    );
    const throwing: ChallengeStorage = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: (): void => {
        throw new Error("denied");
      },
    };
    expect(loadChallenges(throwing)).toEqual(defaultChallengeState(TODAY));
    expect(() =>
      saveChallenges(throwing, defaultChallengeState(TODAY)),
    ).not.toThrow();
    expect(loadChallenges(null).dayId).toBe(TODAY);
  });

  it("normalizes each field independently on corrupt rows", () => {
    const state = parseChallengeState(
      {
        dayId: TODAY,
        progress: { "rifle-5": { progress: "zzz", claimed: "yes" } },
      },
      TODAY,
    );
    expect(state.progress["rifle-5"]).toEqual({ progress: 0, claimed: false });
    expect(state.progress["grenade-2"]).toEqual({ progress: 0, claimed: false });
  });
});

describe("kill attribution", () => {
  it("counts only local-player rifle kills, clamped at 5", () => {
    const state = defaultChallengeState(TODAY);
    expect(recordKill(state, { killerId: 0, weapon: "rifle" })).toBe(true);
    expect(state.progress["rifle-5"]?.progress).toBe(1);
    expect(recordKill(state, { killerId: 1, weapon: "rifle" })).toBe(false);
    expect(recordKill(state, { killerId: null, weapon: "rifle" })).toBe(false);
    // A grenade kill advances the grenade row (true) but not the rifle fill.
    expect(recordKill(state, { killerId: 0, weapon: "grenade" })).toBe(true);
    expect(state.progress["grenade-2"]?.progress).toBe(1);
    expect(recordKill(state, { killerId: 0, weapon: "rocket" })).toBe(false);
    expect(state.progress["rifle-5"]?.progress).toBe(1);
    for (let i = 0; i < 10; i += 1) {
      recordKill(state, { killerId: 0, weapon: "rifle" });
    }
    expect(state.progress["rifle-5"]?.progress).toBe(5);
    expect(recordKill(state, { killerId: 0, weapon: "rifle" })).toBe(false);
  });

  it("reads 2/2 on the grenade row after 2 grenade kills", () => {
    const state = defaultChallengeState(TODAY);
    recordKill(state, { killerId: 0, weapon: "grenade" });
    expect(challengeProgressText(state, "grenade-2")).toBe("1/2");
    recordKill(state, { killerId: 0, weapon: "grenade" });
    expect(challengeProgressText(state, "grenade-2")).toBe("2/2");
    expect(challengeProgressText(state, "rifle-5")).toBe("0/5");
  });

  it("ignores garbage kills without throwing", () => {
    const state = defaultChallengeState(TODAY);
    expect(recordKill(state, null)).toBe(false);
    expect(recordKill(state, {})).toBe(false);
    expect(recordKill(null, { killerId: 0, weapon: "rifle" })).toBe(false);
    expect(challengeProgressText(null, "grenade-2")).toBe("0/2");
    expect(challengeProgressText(state, "nope")).toBe("0/0");
  });
});

describe("dune-win gating", () => {
  it("completes only on a win while the map is dune", () => {
    const state = defaultChallengeState(TODAY);
    expect(recordWin(state, { win: false, map: "dune" })).toBe(false);
    expect(recordWin(state, { win: true, map: "kilima" })).toBe(false);
    expect(recordWin(state, { win: true, map: "dune" })).toBe(true);
    expect(challengeProgressText(state, "win-dune-1")).toBe("1/1");
    expect(recordWin(state, { win: true, map: "dune" })).toBe(false);
  });

  it("ignores garbage outcomes without throwing", () => {
    const state = defaultChallengeState(TODAY);
    expect(recordWin(state, null)).toBe(false);
    expect(recordWin(null, { win: true, map: "dune" })).toBe(false);
  });
});

describe("one-shot XP banking", () => {
  it("sums fresh completions once, then returns 0", () => {
    const state = defaultChallengeState(TODAY);
    expect(collectDueXp(state)).toBe(0);
    recordKill(state, { killerId: 0, weapon: "grenade" });
    recordKill(state, { killerId: 0, weapon: "grenade" });
    recordWin(state, { win: true, map: "dune" });
    expect(collectDueXp(state)).toBe(80);
    expect(collectDueXp(state)).toBe(0);
  });

  it("persists the claimed flags so a reload never double-pays", () => {
    const storage = fakeStorage();
    const state = defaultChallengeState(TODAY);
    for (let i = 0; i < 5; i += 1) {
      recordKill(state, { killerId: 0, weapon: "rifle" });
    }
    expect(collectDueXp(state)).toBe(30);
    saveChallenges(storage, state);
    expect(collectDueXp(loadChallenges(storage))).toBe(0);
  });
});

describe("challenge panel binder", () => {
  it("renders exactly 3 data-challenge rows in template order", () => {
    const doc = makeDoc();
    const panel = ensureChallengesPanel(doc as unknown as Document);
    expect(panel).not.toBeNull();
    const rows = (doc as unknown as { querySelectorAll(sel: string): FakeEl[] }).querySelectorAll(
      `[${CHALLENGE_ROW_ATTR}]`,
    );
    expect(rows.map((row) => row.getAttribute(CHALLENGE_ROW_ATTR))).toEqual([
      "rifle-5",
      "grenade-2",
      "win-dune-1",
    ]);
    const panelEl = doc.getElementById(CHALLENGES_PANEL_ID) as unknown as FakeEl;
    expect(panelEl.children.length).toBe(4);
  });

  it("keeps the skeleton rows and repaints 2/2 without rebuilding", () => {
    const doc = makeDoc([ "menu", CHALLENGES_PANEL_ID ]);
    const panel = doc.getElementById(CHALLENGES_PANEL_ID) as unknown as FakeEl;
    for (const template of CHALLENGE_TEMPLATES) {
      const row = makeEl();
      row.setAttribute(CHALLENGE_ROW_ATTR, template.id);
      const slot = makeEl();
      slot.className = "challenge-progress";
      slot.textContent = `0/${template.target}`;
      row.appendChild(slot);
      panel.appendChild(row);
    }
    const state = defaultChallengeState(TODAY);
    recordKill(state, { killerId: 0, weapon: "grenade" });
    recordKill(state, { killerId: 0, weapon: "grenade" });
    const before = doc.querySelectorAll(`[${CHALLENGE_ROW_ATTR}]`);
    expect(updateChallengesPanel(doc as unknown as Document, state)).toBe(3);
    const after = doc.querySelectorAll(`[${CHALLENGE_ROW_ATTR}]`);
    expect(after.map((row) => row.getAttribute(CHALLENGE_ROW_ATTR))).toEqual(
      before.map((row) => row.getAttribute(CHALLENGE_ROW_ATTR)),
    );
    const grenade = after.find(
      (row) => row.getAttribute(CHALLENGE_ROW_ATTR) === "grenade-2",
    ) as unknown as FakeEl;
    const slot = grenade.children[0] as unknown as FakeEl;
    expect(slot.textContent).toBe("2/2");
    expect(grenade.getAttribute("data-done")).toBe("true");
  });

  it("binds the opener toggle and mirrors window.__challenges", () => {
    stubWindow();
    const doc = makeDoc(["menu", CHALLENGES_OPEN_ID]);
    const storage = fakeStorage();
    const state = defaultChallengeState(TODAY);
    recordKill(state, { killerId: 0, weapon: "grenade" });
    recordKill(state, { killerId: 0, weapon: "grenade" });
    saveChallenges(storage, state);
    const binder = bindChallenges(
      doc as unknown as Document,
      storage,
    );
    expect(binder.state.dayId).toBe(TODAY);
    const mirror = (globalThis as { window: { __challenges?: { setId: string; rows: Array<{ id: string; text: string }> } } }).window.__challenges;
    expect(mirror?.setId).toBe(TODAY);
    expect(mirror?.rows.map((row) => `${row.id}:${row.text}`)).toEqual([
      "rifle-5:0/5",
      "grenade-2:2/2",
      "win-dune-1:0/1",
    ]);
    // Opening the panel repaints from storage (midnight-safe).
    const panel = doc.getElementById(CHALLENGES_PANEL_ID) as unknown as FakeEl;
    expect(panel.style["display"]).toBe("none");
    const opener = doc.getElementById(CHALLENGES_OPEN_ID) as unknown as FakeEl;
    opener.fire("click");
    expect(panel.style["display"]).toBe("");
    expect(binder.refresh()).toBe(TODAY);
    opener.fire("click");
    expect(panel.style["display"]).toBe("none");
    binder.stop();
  });

  it("treats a missing #menu as a no-op and tops up shorn skeletons", () => {
    const doc = makeDoc([]);
    expect(ensureChallengesPanel(doc as unknown as Document)).toBeNull();
    expect(updateChallengesPanel(doc as unknown as Document, null)).toBe(0);
    const binder = bindChallenges(doc as unknown as Document, null);
    expect(binder.state.dayId).toBe(TODAY);
    binder.stop();
  });
});

describe("probe rows", () => {
  it("exposes id, text, done, and xp per template", () => {
    const state = defaultChallengeState(TODAY);
    recordKill(state, { killerId: 0, weapon: "grenade" });
    recordKill(state, { killerId: 0, weapon: "grenade" });
    const rows = challengeRows(state);
    expect(rows.map((row) => row.text)).toEqual(["0/5", "2/2", "0/1"]);
    expect(rows.map((row) => row.done)).toEqual([false, true, false]);
    expect(rows.map((row) => row.xp)).toEqual([30, 30, 50]);
  });
});
