// Online match-timer tests (issue #254): the HUD countdown renders from
// the room's authoritative tick plus cap, so Alice and Bob share one
// value at the same wall-clock moment instead of counting from their
// own join times. Fake-socket style (no network, no DOM), mirroring
// net-client.test.ts and net-render.test.ts.
import { describe, expect, it, afterEach } from "vitest";
import { MATCH_TIME_LIMIT_TICKS } from "../../core/src/constants";
import { formatTimer } from "../src/hud/hud";
import {
  INTERP_DELAY_MS,
  OnlineClient,
  type OnlineSocket,
} from "../src/net/client";
import { bindOnline } from "../src/net/online";
import { renderOnlineSnapshot } from "../src/net/render";

/** In-memory socket recording sends and replaying inbound frames. */
interface FakeSocket extends OnlineSocket {
  sent: string[];
  closed: boolean;
  receive(text: string): void;
}

function makeFakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    closed: false,
    readyState: 1,
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data: string): void {
      socket.sent.push(data);
    },
    close(): void {
      socket.closed = true;
    },
    receive(text: string): void {
      socket.onmessage?.({ data: text });
    },
  };
  return socket;
}

function welcomes(
  socket: FakeSocket,
  fields: Record<string, unknown> = {},
): void {
  socket.receive(
    JSON.stringify({ t: "welcome", pid: 0, session: "s-1", tick: 0, ...fields }),
  );
}

function snapshots(socket: FakeSocket, tick: number, extra: Record<string, unknown> = {}): void {
  socket.receive(
    JSON.stringify({
      t: "snapshot",
      tick,
      players: [{ id: 0, x: 10, y: 20, aim: 0, hp: 100, weapon: "pistol" }],
      ...extra,
    }),
  );
}

describe("OnlineClient match clock", () => {
  it("starts at zero with the offline cap before the first frame", () => {
    const socket = makeFakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
    });
    try {
      expect(client.matchTick()).toBe(0);
      expect(client.matchTimeLimitTicks()).toBe(MATCH_TIME_LIMIT_TICKS);
    } finally {
      client.close();
    }
  });

  it("adopts the welcome tick and cap", () => {
    const socket = makeFakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
    });
    try {
      client.connect("dune");
      welcomes(socket, { tick: 600, timeLimitTicks: 18000 });
      expect(client.connected).toBe(true);
      expect(client.matchTick()).toBe(600);
      expect(client.matchTimeLimitTicks()).toBe(18000);
    } finally {
      client.close();
    }
  });

  it("re-arms the tick on every snapshot and keeps the cap when absent", () => {
    const socket = makeFakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
    });
    try {
      client.connect("dune");
      welcomes(socket, { tick: 600, timeLimitTicks: 18000 });
      snapshots(socket, 660);
      expect(client.matchTick()).toBe(660);
      expect(client.matchTimeLimitTicks()).toBe(18000);
      snapshots(socket, 663, { timeLimitTicks: 18000 });
      expect(client.matchTick()).toBe(663);
      expect(client.matchTimeLimitTicks()).toBe(18000);
    } finally {
      client.close();
    }
  });

  it("ignores non-finite clocks so a partial frame never rewinds the HUD", () => {
    const socket = makeFakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
    });
    try {
      client.connect("dune");
      welcomes(socket, { tick: 600, timeLimitTicks: 18000 });
      snapshots(socket, 660, { timeLimitTicks: "soon" });
      expect(client.matchTick()).toBe(660);
      expect(client.matchTimeLimitTicks()).toBe(18000);
      socket.receive(JSON.stringify({ t: "snapshot", tick: "late", players: [] }));
      expect(client.matchTick()).toBe(660);
      expect(client.matchTimeLimitTicks()).toBe(18000);
    } finally {
      client.close();
    }
  });
});

describe("renderOnlineSnapshot match clock", () => {
  it("paints the server countdown on the timer node", () => {
    const timerEl: { textContent: string | null } = { textContent: null };
    renderOnlineSnapshot({
      renderer: null,
      rows: [],
      tick: 900,
      roster: [],
      kills: [],
      leaves: [],
      nametags: { container: null },
      feed: { feed: null },
      toast: { toast: null },
      camera: null,
      canvasW: 640,
      canvasH: 360,
      timerEl,
      timeLimitTicks: 18000,
    });
    expect(timerEl.textContent).toBe(formatTimer(900, 18000));
    expect(timerEl.textContent).toBe("4:45");
  });

  it("falls back to the offline cap when the frame carries no limit", () => {
    const timerEl: { textContent: string | null } = { textContent: null };
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
      timerEl,
    });
    expect(timerEl.textContent).toBe("5:00");
  });

  it("renders one shared value for two clients on the same server tick", () => {
    const aliceTimer: { textContent: string | null } = { textContent: null };
    const bobTimer: { textContent: string | null } = { textContent: null };
    // Same wall-clock moment: both frames carry the room tick, even
    // though Bob joined 24 s (1440 ticks) after Alice.
    const frame = {
      renderer: null,
      rows: [],
      tick: 1500,
      roster: [],
      kills: [],
      leaves: [],
      nametags: { container: null },
      feed: { feed: null },
      toast: { toast: null },
      camera: null,
      canvasW: 640,
      canvasH: 360,
      timeLimitTicks: 18000,
    } as const;
    renderOnlineSnapshot({ ...frame, timerEl: aliceTimer });
    renderOnlineSnapshot({ ...frame, timerEl: bobTimer });
    expect(aliceTimer.textContent).toBe(bobTimer.textContent);
    expect(aliceTimer.textContent).toBe(formatTimer(1500, 18000));
  });

  it("skips the timer when the node is missing", () => {
    expect(() =>
      renderOnlineSnapshot({
        renderer: null,
        rows: [],
        tick: 900,
        roster: [],
        kills: [],
        leaves: [],
        nametags: { container: null },
        feed: { feed: null },
        toast: { toast: null },
        camera: null,
        canvasW: 640,
        canvasH: 360,
        timeLimitTicks: 18000,
      }),
    ).not.toThrow();
  });
});

describe("bindOnline match clock", () => {
  let saved: unknown;

  afterEach(() => {
    try {
      if (saved === undefined) {
        delete (globalThis as Record<string, unknown>)["HTMLElement"];
      } else {
        (globalThis as Record<string, unknown>)["HTMLElement"] = saved;
      }
    } catch {
      // Test-harness teardown best-effort only.
    }
  });

  it("paints the authoritative tick through the renderer and the HUD timer", () => {
    // buildHud keeps handles only for real HTMLElement instances; the
    // test double stands in so the binder wiring is observable.
    saved = (globalThis as Record<string, unknown>)["HTMLElement"];
    class El {
      textContent: string | null = null;
      style: Record<string, string> = {};
      listeners = new Map<string, Array<() => void>>();
      addEventListener(name: string, cb: () => void): void {
        const list = this.listeners.get(name) ?? [];
        list.push(cb);
        this.listeners.set(name, list);
      }
      click(): void {
        for (const cb of this.listeners.get("click") ?? []) {
          cb();
        }
      }
      setAttribute(): void {}
      getAttribute(): string | null {
        return null;
      }
    }
    (globalThis as Record<string, unknown>)["HTMLElement"] = El;

    const menu = new El();
    const button = new El();
    const timerEl = new El();
    const scoreEl = new El();
    const doc = {
      getElementById(id: string): El | null {
        if (id === "menu") return menu;
        if (id === "play-online") return button;
        if (id === "hud") return new El();
        if (id === "hud-timer") return timerEl;
        if (id === "hud-score") return scoreEl;
        return null;
      },
    };
    let now = 5000;
    const fake = makeFakeSocket();
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
        data: JSON.stringify({
          t: "welcome",
          pid: 0,
          session: "s-9",
          tick: 600,
          timeLimitTicks: 18000,
        }),
      });
      const players = [{ id: 0, x: 0, y: 10, aim: 0, hp: 100, weapon: "pistol" }];
      fake.onmessage?.({ data: JSON.stringify({ t: "snapshot", tick: 660, players }) });
      now += 60;
      fake.onmessage?.({
        data: JSON.stringify({
          t: "snapshot",
          tick: 663,
          players: players.map((p) => ({ ...p, x: 30 })),
          timeLimitTicks: 18000,
        }),
      });
      drawn.length = 0;
      binder.render(now);
      // The shaped state carries the room tick, never a join-relative 0.
      expect(drawn).toHaveLength(1);
      expect((drawn[0] as { tick: number }).tick).toBe(663);
      // The HUD timer mirrors the same authoritative countdown.
      expect(timerEl.textContent).toBe(formatTimer(663, 18000));
      expect(timerEl.textContent).toBe("4:49");
      expect(binder.refresh().remoteCount).toBe(1);
      expect(INTERP_DELAY_MS).toBe(100);
    } finally {
      binder.stop();
    }
  });
});
