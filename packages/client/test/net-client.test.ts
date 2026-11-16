// Honest-mode transport client tests: hello shape, 60 Hz input cadence
// under a fake clock, probe counters, and between-snapshot sampling.
// Fake-socket style (no network, no DOM), mirroring menu-scene.test.ts.
import { describe, expect, it } from "vitest";
import {
  INTERP_DELAY_MS,
  ONLINE_PROTO,
  OnlineClient,
  defaultOnlineUrl,
  onlineUrlFor,
  type OnlineSocket,
} from "../src/net/client";

/** In-memory socket recording sends and replaying inbound frames. */
interface FakeSocket extends OnlineSocket {
  sent: string[];
  closed: boolean;
  receive(text: string): void;
  fireOpen(): void;
}

function makeFakeSocket(openOnCreate = true): FakeSocket {
  const socket: FakeSocket = {
    sent: [],
    closed: false,
    readyState: openOnCreate ? 1 : 0,
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
    fireOpen(): void {
      socket.readyState = 1;
      socket.onopen?.();
    },
  };
  return socket;
}

function welcomes(socket: FakeSocket, session = "s-1", pid = 0): void {
  socket.receive(JSON.stringify({ t: "welcome", pid, session, room: "dune", tick: 0 }));
}

describe("online URL helpers", () => {
  it("builds ws://host/room for a bare host", () => {
    expect(onlineUrlFor("example.com")).toBe("ws://example.com/room");
    expect(onlineUrlFor("example.com", "/room")).toBe("ws://example.com/room");
    expect(onlineUrlFor("example.com", "arena")).toBe("ws://example.com/arena");
  });

  it("falls back to the localhost room endpoint outside a page", () => {
    expect(defaultOnlineUrl()).toBe("ws://localhost/room");
  });
});

describe("OnlineClient hello", () => {
  it("hellos with proto 1 and the view on connect", () => {
    const socket = makeFakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
      view: "dune",
      url: "ws://test/room",
    });
    try {
      client.connect("dune");
      expect(socket.sent).toHaveLength(1);
      const hello = JSON.parse(socket.sent[0] as string) as Record<string, unknown>;
      expect(hello["t"]).toBe("hello");
      expect(hello["proto"]).toBe(ONLINE_PROTO);
      expect(hello["proto"]).toBe(1);
      expect(hello["view"]).toBe("dune");
      expect(client.connected).toBe(false);
      welcomes(socket);
      expect(client.connected).toBe(true);
      expect(client.sessionId).toBe("s-1");
      expect(client.playerId).toBe(0);
    } finally {
      client.close();
    }
  });

  it("hellos on open when the socket starts connecting", () => {
    const socket = makeFakeSocket(false);
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
      view: "kilima",
    });
    try {
      client.connect();
      expect(socket.sent).toHaveLength(0);
      socket.fireOpen();
      expect(socket.sent).toHaveLength(1);
      const hello = JSON.parse(socket.sent[0] as string) as Record<string, unknown>;
      expect(hello["t"]).toBe("hello");
      expect(hello["view"]).toBe("kilima");
    } finally {
      client.close();
    }
  });
});

describe("OnlineClient input cadence", () => {
  it("sends >=50 inputs in one simulated second at 60 Hz", () => {
    const socket = makeFakeSocket();
    let now = 1000;
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => now,
      sendHz: 60,
      sampleInput: () => ({ moveX: 1, aim: 0.5, buttons: 4 }),
    });
    try {
      client.connect("dune");
      welcomes(socket);
      const helloSends = socket.sent.length;
      // Advance the fake clock in exact 10ms steps (binary-exact, well
      // clear of the 16.67ms quantum), polling each step: 50 sends/sec.
      for (let i = 0; i < 100; i += 1) {
        now += 10;
        client.poll();
      }
      const inputs = socket.sent.slice(helloSends).map((text) => JSON.parse(text));
      expect(inputs.length).toBeGreaterThanOrEqual(50);
      expect(inputs.length).toBeLessThanOrEqual(75);
      for (let i = 0; i < inputs.length; i += 1) {
        const frame = inputs[i] as Record<string, unknown>;
        expect(frame["t"]).toBe("input");
        expect(frame["session"]).toBe("s-1");
        expect(frame["tick"]).toBe(i);
        expect(typeof frame["moveX"]).toBe("number");
        expect(typeof frame["aim"]).toBe("number");
        expect(typeof frame["buttons"]).toBe("number");
      }
      expect(client.inputsSent).toBe(inputs.length);
    } finally {
      client.close();
    }
  });

  it("masks buttons to 10 bits and sends nothing before welcome", () => {
    const socket = makeFakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
      sampleInput: () => ({ moveX: 0, aim: 0, buttons: 0x1fff }),
    });
    try {
      client.connect("dune");
      client.poll();
      // Only the hello went out: no session yet, no input loop.
      expect(socket.sent).toHaveLength(1);
      welcomes(socket);
      // Force the quantum to elapse with a far-future clock bump.
      (client as unknown as { lastSendMs: number }).lastSendMs = -1000;
      client.poll();
      const last = JSON.parse(socket.sent[socket.sent.length - 1] as string) as Record<
        string,
        unknown
      >;
      expect(last["buttons"]).toBe(0x3ff);
      expect(client.inputsSent).toBe(1);
    } finally {
      client.close();
    }
  });
});

describe("OnlineClient snapshots", () => {
  it("samples strictly between the last two snapshots", () => {
    const socket = makeFakeSocket();
    let now = 5000;
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => now,
    });
    try {
      client.connect("dune");
      welcomes(socket);
      const playersA = [
        { id: 0, x: 0, y: 0, aim: 0, hp: 100, weapon: "pistol" },
        { id: 1, x: 100, y: 0, aim: 0, hp: 100, weapon: "pistol" },
      ];
      const playersB = [
        { id: 0, x: 100, y: 0, aim: 0, hp: 100, weapon: "pistol" },
        { id: 1, x: 200, y: 0, aim: 0, hp: 100, weapon: "pistol" },
      ];
      socket.receive(JSON.stringify({ t: "snapshot", tick: 10, players: playersA }));
      now += 50;
      socket.receive(JSON.stringify({ t: "snapshot", tick: 11, players: playersB }));
      expect(client.snapshotsReceived).toBe(2);
      // Render clock: newest atMs (5050) + half the span to the midpoint.
      const rows = client.sample(now + INTERP_DELAY_MS - 25);
      const local = rows.find((p) => p.id === 0);
      const remote = rows.find((p) => p.id === 1);
      expect(local).toBeDefined();
      expect(remote).toBeDefined();
      expect(local?.x).toBeGreaterThan(0);
      expect(local?.x).toBeLessThan(100);
      expect(remote?.x).toBeGreaterThan(100);
      expect(remote?.x).toBeLessThan(200);
      expect(client.interpDelayMs()).toBe(INTERP_DELAY_MS);
      expect(client.interpDelayMs()).toBeGreaterThanOrEqual(80);
      expect(client.interpDelayMs()).toBeLessThanOrEqual(120);
    } finally {
      client.close();
    }
  });

  it("zips welcome and snapshot scores by pid for the 3-player board", () => {
    const socket = makeFakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
    });
    try {
      client.connect("dune");
      socket.receive(
        JSON.stringify({
          t: "welcome",
          pid: 0,
          session: "s-1",
          players: [
            { id: 0, x: 0, y: 0 },
            { id: 1, x: 100, y: 0 },
            { id: 2, x: 200, y: 0 },
          ],
          scores: [1, 2, 3],
          roster: [
            { id: 0, name: "Alice" },
            { id: 1, name: "Bob" },
            { id: 2, name: "Viper" },
          ],
        }),
      );
      expect(client.scoresList()).toEqual([
        { id: 0, score: 1 },
        { id: 1, score: 2 },
        { id: 2, score: 3 },
      ]);
      expect(client.scoreFor(2)).toBe(3);
      socket.receive(
        JSON.stringify({
          t: "snapshot",
          tick: 3,
          players: [
            { id: 0, x: 0, y: 0 },
            { id: 1, x: 100, y: 0 },
            { id: 2, x: 200, y: 0 },
          ],
          scores: [4, 0, 0],
          roster: [
            { id: 0, name: "Alice" },
            { id: 1, name: "Bob" },
            { id: 2, name: "Viper" },
          ],
        }),
      );
      expect(client.scoresList()).toEqual([
        { id: 0, score: 4 },
        { id: 1, score: 0 },
        { id: 2, score: 0 },
      ]);
      expect(client.scoreFor(7)).toBe(0);
    } finally {
      client.close();
    }
  });

  it("closes the socket and drops the session on close()", () => {
    const socket = makeFakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => 0,
    });
    client.connect("dune");
    welcomes(socket);
    expect(client.connected).toBe(true);
    client.close();
    expect(client.connected).toBe(false);
    expect(socket.closed).toBe(true);
  });
});
