// Roster + remote-nametag helpers (issue #217): name normalization,
// roster lookups/merges, leave banners, snapshot pose flags, and the
// shared `Killer ▸ Victim` feed line. Pure imports only (no DOM).
import { describe, expect, it } from "vitest";
import {
  LEAVE_BANNER_TEXT,
  leaveBannerFor,
  mergeRoster,
  nameForRoster,
  normalizeRosterName,
  rosterFrom,
  type RosterEntry,
} from "../src/net/roster";
import { formatKillLine, KILL_SEPARATOR } from "../src/ui/feed";
import { onlineStateFor } from "../src/net/render";
import { poseFromFlags, SnapshotBuffer } from "../src/net/interpolation";
import { OnlineClient, type OnlineSocket } from "../src/net/client";

describe("normalizeRosterName", () => {
  it("trims and caps at 16 chars, falling back on blank input", () => {
    expect(normalizeRosterName("  Bob  ", "Player9")).toBe("Bob");
    expect(normalizeRosterName("a".repeat(30), "Player9")).toBe("a".repeat(16));
    expect(normalizeRosterName("   ", "Player9")).toBe("Player9");
    expect(normalizeRosterName(null, "Player9")).toBe("Player9");
    expect(normalizeRosterName(42, "Player9")).toBe("Player9");
  });
});

describe("rosterFrom", () => {
  it("normalizes rows and drops id-less rows", () => {
    const rows = rosterFrom([
      { id: 0, name: " Alice " },
      { id: 1, name: "" },
      { name: "Ghost" },
      null,
      "Bob",
    ]);
    expect(rows).toEqual([
      { id: 0, name: "Alice" },
      { id: 1, name: "Player1" },
    ]);
  });

  it("reads empty for non-array payloads", () => {
    expect(rosterFrom(undefined)).toEqual([]);
    expect(rosterFrom({ id: 0 })).toEqual([]);
  });
});

describe("nameForRoster", () => {
  const roster: RosterEntry[] = [
    { id: 0, name: "Alice" },
    { id: 1, name: "Bob" },
  ];

  it("reads the roster name for Bob as seen by Alice", () => {
    expect(nameForRoster(roster, 1, "Raptor")).toBe("Bob");
  });

  it("falls back for unknown ids", () => {
    expect(nameForRoster(roster, 7, "Raptor")).toBe("Raptor");
    expect(nameForRoster(roster, 7)).toBe("Player7");
    expect(nameForRoster(null, 7)).toBe("Player7");
  });
});

describe("mergeRoster", () => {
  it("replaces on authoritative non-empty snapshots", () => {
    const next = mergeRoster([{ id: 0, name: "Alice" }], [{ id: 1, name: "Bob" }]);
    expect(next).toEqual([{ id: 1, name: "Bob" }]);
  });

  it("keeps the previous roster when the payload carries no rows", () => {
    const prev: RosterEntry[] = [{ id: 0, name: "Alice" }];
    expect(mergeRoster(prev, [])).toEqual(prev);
    expect(mergeRoster(prev, null)).toEqual(prev);
    expect(mergeRoster(prev, null)[0]).not.toBe(prev[0]);
  });
});

describe("leaveBannerFor", () => {
  it("always contains the `Player left` acceptance substring", () => {
    expect(leaveBannerFor("Bob")).toContain(LEAVE_BANNER_TEXT);
    expect(leaveBannerFor("Bob")).toContain("Bob");
    expect(leaveBannerFor("")).toBe("Player left");
    expect(leaveBannerFor(null)).toBe("Player left");
  });
});

describe("shared killfeed line", () => {
  it("formats the identical `Bob ▸ Alice` string online and offline", () => {
    expect(KILL_SEPARATOR).toBe("▸");
    expect(formatKillLine("Bob", "Alice")).toBe("Bob ▸ Alice");
  });
});

describe("poseFromFlags", () => {
  it("decodes alive/on-ground/crouch/jet/protected bits", () => {
    expect(poseFromFlags(1 | 2)).toMatchObject({
      alive: true,
      onGround: true,
      crouching: false,
      jetting: false,
      protected: false,
    });
    expect(poseFromFlags(1 | 4 | 16)).toMatchObject({
      alive: true,
      crouching: true,
      jetting: true,
    });
    expect(poseFromFlags(32)).toMatchObject({ alive: false, protected: true });
  });

  it("reads neutral-alive for flag-less snapshots", () => {
    expect(poseFromFlags(undefined)).toMatchObject({ alive: true, onGround: true });
  });
});

describe("SnapshotBuffer pose and identity", () => {
  it("carries names and decoded pose into sampled rows", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1, 0, [
      { id: 0, x: 0, y: 300, aim: 0, hp: 100, weapon: "pistol", name: "Alice", flags: 1 | 2 },
      { id: 1, x: 600, y: 300, aim: 0, hp: 80, weapon: "rifle", name: "Bob", flags: 1 | 4 },
    ]);
    buffer.push(2, 50, [
      { id: 0, x: 100, y: 300, aim: 0, hp: 100, weapon: "pistol", name: "Alice", flags: 1 | 2 },
      { id: 1, x: 500, y: 280, aim: 0, hp: 80, weapon: "rifle", name: "Bob", flags: 1 | 4 },
    ]);
    const rows = buffer.sample(125);
    const bob = rows.find((p) => p.id === 1);
    expect(bob?.name).toBe("Bob");
    expect(bob?.crouching).toBe(true);
    expect(bob?.alive).toBe(true);
    const alice = rows.find((p) => p.id === 0);
    expect(alice?.name).toBe("Alice");
    expect(aliveOf(alice)).toBe(true);
  });

  it("derives per-row velocity from the bracketing pair", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1, 0, [{ id: 0, x: 0, y: 0, aim: 0, hp: 100, weapon: "pistol" }]);
    buffer.push(2, 50, [{ id: 0, x: 100, y: 0, aim: 0, hp: 100, weapon: "pistol" }]);
    const rows = buffer.sample(125);
    expect(rows[0]?.x).toBeCloseTo(50, 9);
    expect(rows[0]?.vx).toBeCloseTo(2000, 6);
    expect(rows[0]?.vy).toBeCloseTo(0, 9);
  });
});

function aliveOf(row: { alive?: boolean } | undefined): boolean {
  return row?.alive ?? false;
}

describe("OnlineClient roster and event intake", () => {
  function fakeSocket(): OnlineSocket & { sent: string[]; receive(text: string): void } {
    const socket: OnlineSocket & { sent: string[]; receive(text: string): void } = {
      sent: [],
      readyState: 1,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data: string): void {
        socket.sent.push(data);
      },
      close(): void {},
      receive(text: string): void {
        socket.onmessage?.({ data: text });
      },
    };
    return socket;
  }

  it("hellos with the trimmed pilot name and parses roster snapshots", () => {
    let now = 1000;
    const socket = fakeSocket();
    const client = new OnlineClient({
      createSocket: () => socket,
      now: () => now,
      name: "  Alice  ",
    });
    try {
      client.connect("dune");
      const hello = JSON.parse(socket.sent[0] as string) as Record<string, unknown>;
      expect(hello["name"]).toBe("Alice");
      socket.receive(
        JSON.stringify({
          t: "welcome",
          pid: 0,
          session: "s-1",
          roster: [
            { id: 0, name: "Alice" },
            { id: 1, name: "Bob" },
          ],
        }),
      );
      expect(client.rosterList()).toEqual([
        { id: 0, name: "Alice" },
        { id: 1, name: "Bob" },
      ]);
      expect(client.nameFor(1)).toBe("Bob");
      socket.receive(
        JSON.stringify({
          t: "snapshot",
          tick: 3,
          players: [
            { id: 0, x: 620, y: 300, aim: 0, hp: 100, weapon: "pistol", name: "Alice", flags: 1 | 2, fuel: 90 },
            { id: 1, x: 660, y: 300, aim: 0, hp: 100, weapon: "rifle", name: "Bob", flags: 1 | 4 | 16, fuel: 80 },
          ],
          roster: [
            { id: 0, name: "Alice" },
            { id: 1, name: "Bob" },
          ],
          events: [
            { kind: "kill", killer: 1, victim: 0, killerName: "Bob", victimName: "Alice", weapon: "rifle" },
          ],
        }),
      );
      expect(client.snapshotsReceived).toBe(1);
      const kills = client.drainKills();
      expect(kills).toEqual([
        { killer: 1, victim: 0, killerName: "Bob", victimName: "Alice", weapon: "rifle" },
      ]);
      expect(client.drainKills()).toEqual([]);
      now += 200;
      const bob = client.sample(now).find((p) => p.id === 1);
      expect(bob?.name).toBe("Bob");
      expect(bob?.weapon).toBe("rifle");
      expect(bob?.crouching).toBe(true);
      expect(bob?.jetting).toBe(true);
      socket.receive(JSON.stringify({ t: "leave", id: 1, name: "Bob", reason: "Player left" }));
      const leaves = client.drainLeaves();
      expect(leaves).toEqual([{ id: 1, name: "Bob" }]);
      socket.receive(JSON.stringify({ t: "join", id: 2, name: "Nova" }));
      expect(client.nameFor(2)).toBe("Nova");
    } finally {
      client.close();
    }
  });
});

describe("onlineStateFor soldier shape", () => {
  it("passes pose, fuel, and velocity through for the soldier renderer", () => {
    const state = onlineStateFor(
      [
        {
          id: 1,
          x: 640,
          y: 300,
          aim: 0.5,
          hp: 80,
          weapon: "rifle",
          name: "Bob",
          alive: false,
          onGround: false,
          crouching: true,
          jetting: false,
          protected: true,
          vx: 120,
          vy: -40,
          fuel: 55,
        },
      ],
      9,
    );
    expect(state.tick).toBe(9);
    expect(state.players).toHaveLength(1);
    expect(state.players[0]).toMatchObject({
      id: 1,
      alive: false,
      crouching: true,
      jetting: false,
      onGround: false,
      fuel: 55,
      vx: 120,
      vy: -40,
    });
    expect(state.projectiles).toEqual([]);
    expect(state.pickups).toEqual([]);
    expect(state.props).toEqual([]);
  });
});
