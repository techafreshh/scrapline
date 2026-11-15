// Round-trip probes for the bit-packed RECON wire codec: snapshot tolerance,
// input-packet size/exactness, delta gain, determinism, and rejection cases.
// Pure in-process imports (the codec has no sockets or top-level work).
import { describe, expect, it } from "vitest";
import { World } from "../../core/src/world";
import {
  BitReader,
  BitWriter,
  decodeInputPacket,
  decodeSnapshot,
  encodeInputPacket,
  encodeSnapshot,
  FLAG_ALIVE,
  FLAG_CROUCHING,
  FLAG_JETTING,
  FLAG_ON_GROUND,
  FLAG_PROTECTED,
  FLAG_RELOADING,
  playerToSnapshot,
} from "../src/codec";
import type { Snapshot, SnapshotEvent, SnapshotPlayer } from "../src/codec";

const TWO_PI = Math.PI * 2;

/** Aim step matching the codec's quantizeAim-style wrapping. */
function aimStep(aim: number): number {
  const wrapped = ((aim % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round((wrapped / TWO_PI) * 4096) % 4096;
}

describe("encode/decode round-trip", () => {
  it("packs bits MSB-first and reports the zero-padded tail", () => {
    const w = new BitWriter();
    w.bits(0b101, 3);
    w.bits(0x3ff, 10);
    const buf = w.finish();
    const r = new BitReader(buf);
    expect(r.bits(3)).toBe(0b101);
    expect(r.bits(10)).toBe(0x3ff);
    expect(r.remainingBits()).toBe(3);
  });

  it("round-trips a snapshot sample within tolerance with exact hp/shield", () => {
    const players: SnapshotPlayer[] = [
      { id: 0, x: 100.13, y: 200.77, aim: 0.1, flags: FLAG_ALIVE | FLAG_ON_GROUND, weapon: "pistol", hp: 100, shield: 0 },
      { id: 1, x: 640.5, y: 320.25, aim: TWO_PI + 0.5, flags: FLAG_ALIVE | FLAG_CROUCHING | FLAG_RELOADING, weapon: "smg", hp: 80, shield: 17 },
      { id: 2, x: 33.03, y: 599.9, aim: -Math.PI / 2, flags: FLAG_ALIVE | FLAG_JETTING, weapon: "rifle", hp: 0, shield: 63 },
      { id: 3, x: 1200.0, y: 100.0, aim: 10 * TWO_PI - 1.2, flags: FLAG_ALIVE | FLAG_ON_GROUND | FLAG_PROTECTED, weapon: "shotgun", hp: 80, shield: 5 },
      { id: 4, x: 0.02, y: 0.03, aim: Math.PI, flags: 0, weapon: "sniper", hp: 1, shield: 63 },
      { id: 5, x: 2047.9, y: 640.0, aim: 3 * Math.PI, flags: FLAG_ALIVE, weapon: "rocket", hp: 100, shield: 0 },
    ];
    // Event coordinates sit on the 1/32 px grid, so they round-trip exactly.
    const events: SnapshotEvent[] = [
      { kind: "shot", player: 0, x: 100.5, y: 200.25 },
      { kind: "damage", player: 1, x: 640.0, y: 320.0625 },
      { kind: "kill", player: 2, x: 33.125, y: 599.875 },
      { kind: "bounce", player: 5, x: 1200.5, y: 100.25 },
    ];
    const snap: Snapshot = { tick: 4242, players, events };
    const back = decodeSnapshot(encodeSnapshot(snap));
    expect(back.tick).toBe(4242);
    expect(back.players.length).toBe(players.length);
    for (let i = 0; i < players.length; i += 1) {
      const orig = players[i] as SnapshotPlayer;
      const got = back.players[i] as SnapshotPlayer;
      expect(got.id).toBe(orig.id);
      expect(Math.abs(got.x - orig.x)).toBeLessThan(0.5);
      expect(Math.abs(got.y - orig.y)).toBeLessThan(0.5);
      expect(got.hp).toBe(orig.hp);
      expect(got.shield).toBe(orig.shield);
      expect(got.weapon).toBe(orig.weapon);
      expect(got.flags).toBe(orig.flags);
      expect(aimStep(got.aim)).toBe(aimStep(orig.aim));
    }
    expect(back.events).toEqual(events);
  });

  it("encodes 12 distinct inputs in under 120 bytes with exact decode", () => {
    const inputs = Array.from({ length: 12 }, (_, i) => ({
      moveX: (i - 6) / 64,
      aim: (((i * 373) % 4096) / 4096) * TWO_PI,
      buttons: (i * 89) % 1024,
    }));
    const buf = encodeInputPacket({ firstTick: 4321, inputs, viewDelay: 300 });
    expect(buf.byteLength).toBeLessThan(120);
    const back = decodeInputPacket(buf);
    expect(back.firstTick).toBe(4321);
    expect(back.viewDelay).toBe(300);
    expect(back.ack).toBeUndefined();
    expect(back.inputs).toEqual(inputs);
  });

  it("delta-compresses 12 identical inputs into 24 bytes or fewer, exactly", () => {
    const one = { moveX: 0.5, aim: (123 / 4096) * TWO_PI, buttons: 5 };
    const inputs = Array.from({ length: 12 }, () => ({ ...one }));
    const buf = encodeInputPacket({ firstTick: 7, inputs });
    expect(buf.byteLength).toBeLessThanOrEqual(24);
    const back = decodeInputPacket(buf);
    expect(back.firstTick).toBe(7);
    expect(back.viewDelay).toBe(0);
    expect(back.inputs).toEqual(inputs);
  });

  it("round-trips ack and viewDelay alongside the inputs", () => {
    const inputs = [
      { moveX: 1, aim: (4095 / 4096) * TWO_PI, buttons: 1023 },
      { moveX: 1, aim: (4095 / 4096) * TWO_PI, buttons: 1023 },
      { moveX: -1, aim: 0, buttons: 0 },
    ];
    const buf = encodeInputPacket({
      firstTick: 65535,
      inputs,
      viewDelay: 511,
      ack: { ackSeq: 60000, delayMs: 200, rttMs: 45 },
    });
    const back = decodeInputPacket(buf);
    expect(back.firstTick).toBe(65535);
    expect(back.viewDelay).toBe(511);
    expect(back.ack).toEqual({ ackSeq: 60000, delayMs: 200, rttMs: 45 });
    expect(back.inputs).toEqual(inputs);
  });

  it("is deterministic and rejects bad counts, weapons, and truncation", () => {
    const players: SnapshotPlayer[] = [
      { id: 9, x: 10.5, y: 20.25, aim: 1.0, flags: FLAG_ALIVE, weapon: "pistol", hp: 100, shield: 3 },
    ];
    const snap: Snapshot = {
      tick: 1,
      players,
      events: [{ kind: "shot", player: 9, x: 10.5, y: 20.25 }],
    };
    const a = encodeSnapshot(snap);
    expect(encodeSnapshot(snap).equals(a)).toBe(true);
    const inputs = [{ moveX: 0, aim: 0, buttons: 0 }];
    const b = encodeInputPacket({ firstTick: 3, inputs });
    expect(encodeInputPacket({ firstTick: 3, inputs }).equals(b)).toBe(true);

    const thirteen = Array.from({ length: 13 }, () => ({ moveX: 0, aim: 0, buttons: 0 }));
    expect(() => encodeInputPacket({ firstTick: 0, inputs: thirteen })).toThrow(RangeError);
    expect(() => encodeInputPacket({ firstTick: 0, inputs: [] })).toThrow(RangeError);
    const badWeapon = {
      ...(players[0] as SnapshotPlayer),
      weapon: "blaster" as unknown as SnapshotPlayer["weapon"],
    };
    expect(() => encodeSnapshot({ tick: 0, players: [badWeapon], events: [] })).toThrow(
      RangeError,
    );
    const badShield = { ...(players[0] as SnapshotPlayer), shield: 64 };
    expect(() => encodeSnapshot({ tick: 0, players: [badShield], events: [] })).toThrow(
      RangeError,
    );
    expect(() => decodeSnapshot(a.subarray(0, a.length - 1))).toThrow(RangeError);
    expect(() => decodeSnapshot(Buffer.alloc(0))).toThrow(RangeError);
    expect(() => decodeInputPacket(Buffer.alloc(0))).toThrow(RangeError);
  });

  it("derives snapshot flags from a live World player", () => {
    const world = new World({ seed: 7 });
    const p = world.addPlayer({ x: 100, y: 100 });
    p.onGround = true;
    p.crouching = false;
    p.reloading = true;
    p.jetting = true;
    p.protectionTicks = 5;
    const s = playerToSnapshot(p, 17);
    expect(s.flags).toBe(FLAG_ALIVE | FLAG_ON_GROUND | FLAG_RELOADING | FLAG_JETTING | FLAG_PROTECTED);
    expect(s.shield).toBe(17);
    expect(s.id).toBe(p.id);
    expect(s.weapon).toBe(p.weapon);
    expect(playerToSnapshot(p).shield).toBe(0);
  });
});
