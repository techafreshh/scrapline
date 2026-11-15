// Honest-mode menu binder tests: click opens a session with the live
// view, the fake renderer receives between-snapshot states, the probe
// mirror refreshes, and stop() restores the menu. Fake-doc style, no
// DOM (mirrors menu-scene.test.ts).
import { describe, expect, it } from "vitest";
import {
  ONLINE_BUTTON_ID,
  bindOnline,
  onlineStateFor,
  type OnlineClientLike,
} from "../src/net/online";
import { OnlineClient, type OnlineSocket } from "../src/net/client";

/** Minimal fake element with click handling and a style bag. */
interface FakeEl {
  id: string;
  style: Record<string, string>;
  listeners: Map<string, Array<() => void>>;
  addEventListener(name: string, cb: () => void): void;
  click(): void;
}

function makeEl(id: string): FakeEl {
  const el: FakeEl = {
    id,
    style: {},
    listeners: new Map(),
    addEventListener(name: string, cb: () => void): void {
      const list = el.listeners.get(name) ?? [];
      list.push(cb);
      el.listeners.set(name, list);
    },
    click(): void {
      for (const cb of el.listeners.get("click") ?? []) {
        cb();
      }
    },
  };
  return el;
}

/** Stub client recording connects and serving scripted snapshots. */
interface StubClient extends OnlineClientLike {
  views: string[];
  rows: { id: number; x: number; y: number; aim: number; hp: number; weapon: string }[];
  closed: boolean;
}

function makeStub(): StubClient {
  const stub: StubClient = {
    connected: false,
    inputsSent: 42,
    snapshotsReceived: 7,
    views: [],
    rows: [],
    closed: false,
    connect(view?: string): void {
      stub.views.push(view ?? "");
      stub.connected = true;
    },
    sample(): StubClient["rows"] {
      return stub.rows.map((p) => ({ ...p }));
    },
    interpDelayMs(): number {
      return 100;
    },
    close(): void {
      stub.closed = true;
      stub.connected = false;
    },
  };
  return stub;
}

function makeDoc() {
  const menu = makeEl("menu");
  const button = makeEl(ONLINE_BUTTON_ID);
  const doc = {
    getElementById(id: string): FakeEl | null {
      if (id === "menu") return menu;
      if (id === ONLINE_BUTTON_ID) return button;
      return null;
    },
  };
  return { doc, menu, button };
}

describe("bindOnline", () => {
  it("connects with the live view and hides the menu on click", () => {
    const { doc, menu, button } = makeDoc();
    const stub = makeStub();
    const binder = bindOnline(doc as unknown as Document, {
      createClient: () => stub,
      getView: () => "kilima",
      getRenderer: () => null,
    });
    try {
      expect(binder.client).toBeNull();
      button.click();
      expect(stub.views).toEqual(["kilima"]);
      expect(menu.style["display"]).toBe("none");
      expect(binder.client).toBe(stub);
      expect(binder.active).toBe(true);
      const probe = binder.refresh();
      expect(probe.connected).toBe(true);
      expect(probe.inputsSent).toBe(42);
      expect(probe.snapshotsReceived).toBe(7);
      expect(probe.interpDelayMs).toBe(100);
    } finally {
      binder.stop();
    }
    expect(stub.closed).toBe(true);
    expect(menu.style["display"]).toBe("");
    expect(binder.active).toBe(false);
  });

  it("paints renderer states whose remote x lies between the fed snapshots", () => {
    const { doc, button } = makeDoc();
    let now = 5000;
    const sent: string[] = [];
    const fake = {
      sent,
      readyState: 1,
      onopen: null as null | (() => void),
      onmessage: null as null | ((ev: { data?: unknown }) => void),
      onclose: null,
      onerror: null,
      send(data: string): void {
        sent.push(data);
      },
      close(): void {},
    };
    const drawn: unknown[] = [];
    const binder = bindOnline(doc as unknown as Document, {
      now: () => now,
      createClient: (options) =>
        new OnlineClient({
          ...options,
          createSocket: () => fake as unknown as OnlineSocket,
          now: () => now,
        }),
      getRenderer: () => ({
        draw(state: unknown): void {
          drawn.push(state);
        },
      }),
    });
    try {
      button.click();
      fake.onmessage?.({
        data: JSON.stringify({ t: "welcome", pid: 0, session: "s-9", tick: 0 }),
      });
      const playersA = [{ id: 3, x: 0, y: 10, aim: 0, hp: 100, weapon: "pistol" }];
      const playersB = [{ id: 3, x: 100, y: 10, aim: 0, hp: 100, weapon: "pistol" }];
      fake.onmessage?.({ data: JSON.stringify({ t: "snapshot", tick: 4, players: playersA }) });
      now += 50;
      fake.onmessage?.({ data: JSON.stringify({ t: "snapshot", tick: 5, players: playersB }) });
      // Render at the buffer midpoint: remote x strictly between the pair.
      // (The click already painted one empty-buffer frame; reset it.)
      drawn.length = 0;
      binder.render(now + 100 - 25);
      expect(drawn).toHaveLength(1);
      const state = drawn[0] as {
        players: { id: number; x: number }[];
        projectiles: unknown[];
      };
      expect(state.players).toHaveLength(1);
      expect(state.players[0]?.id).toBe(3);
      expect(state.players[0]?.x).toBeGreaterThan(0);
      expect(state.players[0]?.x).toBeLessThan(100);
      expect(state.projectiles).toEqual([]);
      expect(binder.refresh().remoteCount).toBe(1);
    } finally {
      binder.stop();
    }
  });

  it("shapes a renderer StateLike with neutral entity streams", () => {
    const state = onlineStateFor(
      [{ id: 0, x: 5, y: 6, aim: 0.1, hp: 80, weapon: "rifle" }],
      33,
    );
    expect(state.tick).toBe(33);
    expect(state.players).toHaveLength(1);
    expect(state.players[0]?.["x"]).toBe(5);
    expect(state.players[0]?.["alive"]).toBe(true);
    expect(state.projectiles).toEqual([]);
    expect(state.pickups).toEqual([]);
    expect(state.props).toEqual([]);
  });

  it("is a no-op binder when the button is missing", () => {
    const doc = { getElementById: (): null => null };
    const binder = bindOnline(doc as unknown as Document, {});
    const probe = binder.refresh();
    expect(probe.connected).toBe(false);
    expect(probe.remoteCount).toBe(0);
    binder.render();
    binder.stop();
  });
});
