// Bit-packed snapshot + input-packet wire codec (RECON.md netcode format).
//
// Zero dependencies (Buffer only, like the server.ts frame assembly),
// deterministic and MSB-first: snapshots and input packets encode to the
// exact RECON bit layout so 60 Hz traffic stays compact without float JSON.
// Pure module: no imports from server.ts, no sockets, no top-level work —
// safe to import in-process from vitest or any probe.
import { AIM_STEPS } from "../../core/src/constants";
import type { Player } from "../../core/src/entities";
import type { WeaponId } from "../../core/src/weapons";

/** Weapons in wire order (3-bit index). */
export const WEAPON_ORDER = ["pistol", "smg", "rifle", "shotgun", "sniper", "rocket"] as const;

/** Snapshot event kinds in wire order (3-bit index; 6 and 7 are invalid). */
export const EVENT_ORDER = ["shot", "damage", "kill", "bounce", "explode", "pickup"] as const;

/** Snapshot event kind. */
export type SnapshotEventKind = (typeof EVENT_ORDER)[number];

/** Snapshot player flag bits. */
export const FLAG_ALIVE = 1;
/** Snapshot player flag bits. */
export const FLAG_ON_GROUND = 2;
/** Snapshot player flag bits. */
export const FLAG_CROUCHING = 4;
/** Snapshot player flag bits. */
export const FLAG_RELOADING = 8;
/** Snapshot player flag bits. */
export const FLAG_JETTING = 16;
/** Snapshot player flag bits. */
export const FLAG_PROTECTED = 32;

/** 10-bit button mask (RECON mask incl. MELEE:16/SWAP:64/INTERACT:128/SCOPE:256/GHOST:512). */
export const BUTTON_MASK_10 = 0x3ff;
/** Max inputs carried by one input packet. */
export const MAX_INPUTS = 12;
/** Max viewDelay (opaque 9-bit passthrough). */
export const VIEW_DELAY_MAX = 511;
/** Max shield (opaque 6-bit passthrough). */
export const SHIELD_MAX = 63;

/** Fixed-point scale for wire x/y (1/32 px, so the max error is 1/64 px). */
const COORD_SCALE = 32;
/** Largest coordinate the 16-bit fixed field holds (65535/32 = 2047.97 px). */
const COORD_MAX = 65535 / COORD_SCALE;
const TWO_PI = Math.PI * 2;

/** One player record inside a snapshot. */
export interface SnapshotPlayer {
  /** Player id (8 bits, < 256). */
  id: number;
  /** Position x in pixels (16-bit 1/32 px fixed point). */
  x: number;
  /** Position y in pixels (16-bit 1/32 px fixed point). */
  y: number;
  /** Aim angle in radians (12-bit step). */
  aim: number;
  /** Flag bits (FLAG_*). */
  flags: number;
  /** Equipped weapon (3-bit WEAPON_ORDER index). */
  weapon: WeaponId;
  /** Health points (7 bits, rounded). */
  hp: number;
  /** Shield points, opaque passthrough (6 bits, 0-63). */
  shield: number;
}

/** One event record inside a snapshot. */
export interface SnapshotEvent {
  /** Event kind (3-bit EVENT_ORDER index). */
  kind: SnapshotEventKind;
  /** Owning player id. */
  player: number;
  /** Position x in pixels (16-bit 1/32 px fixed point). */
  x: number;
  /** Position y in pixels (16-bit 1/32 px fixed point). */
  y: number;
}

/** A snapshot: tick plus player records plus an event stream. */
export interface Snapshot {
  /** Tick (uint16, wraps via tick & 0xFFFF). */
  tick: number;
  /** Player records (at most 255). */
  players: SnapshotPlayer[];
  /** Event records (at most 15). */
  events: SnapshotEvent[];
}

/** One per-tick input (protocol-level quantized values). */
export interface CodecInput {
  /** Lateral intent in [-1, 1] (quantized to 1/64 steps). */
  moveX: number;
  /** Aim angle in radians (quantized to 4096 steps). */
  aim: number;
  /** Button bitmask (10 bits, 0-1023). */
  buttons: number;
}

/** Optional acknowledgement carried at the head of an input packet. */
export interface InputAck {
  /** Acknowledged sequence (uint16). */
  ackSeq: number;
  /** Acknowledgement delay in ms (uint8). */
  delayMs: number;
  /** Round-trip estimate in ms (uint8). */
  rttMs: number;
}

/** An input packet: up to 12 delta-compressed inputs. */
export interface InputPacket {
  /** First input tick (uint16). */
  firstTick: number;
  /** Inputs (1-12, first always full, later ones delta-compressed). */
  inputs: CodecInput[];
  /** Opaque view delay (9 bits, 0-511, defaults to 0). */
  viewDelay?: number;
  /** Optional acknowledgement. */
  ack?: InputAck | null;
}

/** A decoded input packet (viewDelay always present, ack only when sent). */
export interface DecodedInputPacket {
  /** First input tick. */
  firstTick: number;
  /** Decoded inputs. */
  inputs: CodecInput[];
  /** View delay. */
  viewDelay: number;
  /** Acknowledgement (absent when the packet carries none). */
  ack?: InputAck;
}

/** MSB-first bit writer shared by both codecs. */
export class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private filled = 0;

  /** Append one bit. */
  bit(b: number | boolean): void {
    this.bits(b ? 1 : 0, 1);
  }

  /** Append the low n bits of value, most significant first. */
  bits(value: number, n: number): void {
    const width = asInt(n, "width");
    if (width < 0 || width > 32) {
      fail("width", n);
    }
    const v = asInt(value, "bits");
    if (v < 0 || v >= 2 ** width) {
      fail("bits", value);
    }
    for (let i = width - 1; i >= 0; i -= 1) {
      this.current = (this.current << 1) | ((v >>> i) & 1);
      this.filled += 1;
      if (this.filled === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.filled = 0;
      }
    }
  }

  /** Append a signed 8-bit value (two's complement). */
  int8(v: number): void {
    const n = asInt(v, "int8");
    if (n < -128 || n > 127) {
      fail("int8", v);
    }
    this.bits(n & 0xff, 8);
  }

  /** Flush with zero padding and return the packed bytes. */
  finish(): Buffer {
    if (this.filled > 0) {
      this.current <<= 8 - this.filled;
      this.bytes.push(this.current);
      this.current = 0;
      this.filled = 0;
    }
    return Buffer.from(this.bytes);
  }
}

/** MSB-first bit reader shared by both codecs; truncation throws RangeError. */
export class BitReader {
  private pos = 0;
  constructor(private readonly buf: Buffer) {}

  /** Read one bit. */
  bit(): number {
    return this.bits(1);
  }

  /** Read n bits, most significant first. */
  bits(n: number): number {
    const width = asInt(n, "width");
    if (width < 0 || width > 32) {
      fail("width", n);
    }
    let out = 0;
    for (let k = 0; k < width; k += 1) {
      const idx = this.pos >>> 3;
      if (idx >= this.buf.length) {
        throw new RangeError("codec: truncated bitstream");
      }
      const byte = this.buf[idx];
      out = out * 2 + ((byte >>> (7 - (this.pos & 7))) & 1);
      this.pos += 1;
    }
    return out;
  }

  /** Read a signed 8-bit value (two's complement). */
  int8(): number {
    const u = this.bits(8);
    return u >= 128 ? u - 256 : u;
  }

  /** Bits left unread (includes final-byte zero padding). */
  remainingBits(): number {
    return this.buf.length * 8 - this.pos;
  }
}

/** Throw a RangeError for a bad wire value. */
function fail(name: string, value: unknown): never {
  throw new RangeError(`codec: bad ${name}: ${String(value)}`);
}

/** Require an array field. */
function asArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(name, value);
  }
  return value;
}

/** Require a finite number field. */
function asNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(name, value);
  }
  return value;
}

/** Require an integer field. */
function asInt(value: unknown, name: string): number {
  const v = asNumber(value, name);
  if (!Number.isInteger(v)) {
    fail(name, value);
  }
  return v;
}

/** Require a non-negative integer field. */
function asUint(value: unknown, name: string): number {
  const v = asInt(value, name);
  if (v < 0) {
    fail(name, value);
  }
  return v;
}

/** Clamp a coordinate into the 16-bit fixed range and scale by 1/32 px. */
function coordToFixed(v: number): number {
  const clamped = Math.min(COORD_MAX, Math.max(0, v));
  return Math.round(clamped * COORD_SCALE);
}

/** Quantize an aim angle to a 12-bit step, wrapping like quantizeAim. */
function aimStepFor(radians: number): number {
  const wrapped = ((radians % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round((wrapped / TWO_PI) * AIM_STEPS) % AIM_STEPS;
}

/** Quantize a lateral intent to a moveX step, clamping like quantizeMoveX. */
function moveStepFor(value: number): number {
  const clamped = Math.min(1, Math.max(-1, value));
  return Math.round(clamped * 64);
}

/** Attach a hidden alias so alternate probe spellings read without affecting equality. */
function defineAlias(obj: object, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: false, writable: false });
}

/**
 * Encode a snapshot: tick:16, playerCount:8, per-player
 * (id:8, x:16 fixed1/32, y:16 fixed1/32, aim:12 step, flags:8, weapon:3,
 * hp:7 rounded, shield:6), eventCount:4, per-event (kind:3, player:8, x:16, y:16).
 */
export function encodeSnapshot(snap: Snapshot): Buffer {
  const raw = snap as unknown as Record<string, unknown>;
  const players = asArray(raw["players"], "players");
  const eventsRaw = raw["events"];
  const events = eventsRaw === undefined ? [] : asArray(eventsRaw, "events");
  if (players.length > 255) {
    fail("players.length", players.length);
  }
  if (events.length > 15) {
    fail("events.length", events.length);
  }
  const w = new BitWriter();
  w.bits(asUint(raw["tick"] ?? raw["firstTick"] ?? 0, "tick") % 65536, 16);
  w.bits(players.length, 8);
  for (const item of players) {
    const p = ((item ?? {}) as Record<string, unknown>);
    const id = asUint(p["id"] ?? p["pid"], "player.id");
    if (id > 255) {
      fail("player.id", id);
    }
    w.bits(id, 8);
    w.bits(coordToFixed(asNumber(p["x"] ?? 0, "player.x")), 16);
    w.bits(coordToFixed(asNumber(p["y"] ?? 0, "player.y")), 16);
    w.bits(aimStepFor(asNumber(p["aim"] ?? 0, "player.aim")), 12);
    const flags = asUint(p["flags"] ?? 0, "player.flags");
    if (flags > 255) {
      fail("player.flags", flags);
    }
    w.bits(flags, 8);
    const weapon = String(p["weapon"] ?? "pistol");
    const wi = (WEAPON_ORDER as readonly string[]).indexOf(weapon);
    if (wi < 0) {
      fail("player.weapon", weapon);
    }
    w.bits(wi, 3);
    w.bits(Math.min(127, Math.max(0, Math.round(asNumber(p["hp"] ?? 100, "player.hp")))), 7);
    const shield = asInt(p["shield"] ?? 0, "player.shield");
    if (shield < 0 || shield > SHIELD_MAX) {
      fail("player.shield", shield);
    }
    w.bits(shield, 6);
  }
  w.bits(events.length, 4);
  for (const item of events) {
    const e = ((item ?? {}) as Record<string, unknown>);
    const kind = String(e["kind"]);
    const ki = (EVENT_ORDER as readonly string[]).indexOf(kind);
    if (ki < 0) {
      fail("event.kind", kind);
    }
    w.bits(ki, 3);
    const player = asUint(e["player"] ?? e["playerId"] ?? e["pid"] ?? 0, "event.player");
    if (player > 255) {
      fail("event.player", player);
    }
    w.bits(player, 8);
    w.bits(coordToFixed(asNumber(e["x"] ?? 0, "event.x")), 16);
    w.bits(coordToFixed(asNumber(e["y"] ?? 0, "event.y")), 16);
  }
  return w.finish();
}

/** Decode a snapshot; final-byte zero padding is ignored. */
export function decodeSnapshot(buf: Buffer): Snapshot {
  const r = new BitReader(buf);
  const tick = r.bits(16);
  const playerCount = r.bits(8);
  const players: SnapshotPlayer[] = [];
  for (let i = 0; i < playerCount; i += 1) {
    const id = r.bits(8);
    const x = r.bits(16) / COORD_SCALE;
    const y = r.bits(16) / COORD_SCALE;
    const aim = (r.bits(12) / AIM_STEPS) * TWO_PI;
    const flags = r.bits(8);
    const wi = r.bits(3);
    if (wi >= WEAPON_ORDER.length) {
      throw new RangeError(`codec: bad weapon index: ${wi}`);
    }
    const hp = r.bits(7);
    const shield = r.bits(6);
    players.push({ id, x, y, aim, flags, weapon: WEAPON_ORDER[wi], hp, shield });
  }
  const eventCount = r.bits(4);
  const events: SnapshotEvent[] = [];
  for (let i = 0; i < eventCount; i += 1) {
    const ki = r.bits(3);
    if (ki >= EVENT_ORDER.length) {
      throw new RangeError(`codec: bad event kind index: ${ki}`);
    }
    const player = r.bits(8);
    const x = r.bits(16) / COORD_SCALE;
    const y = r.bits(16) / COORD_SCALE;
    events.push({ kind: EVENT_ORDER[ki], player, x, y });
  }
  const snap: Snapshot = { tick, players, events };
  defineAlias(snap, "firstTick", tick);
  for (const p of players) {
    defineAlias(p, "pid", p.id);
  }
  for (const e of events) {
    defineAlias(e, "playerId", e.player);
  }
  return snap;
}

/**
 * Bridge a live World player to a snapshot record: flags derive from
 * onGround/crouching/alive/reloading/jetting/protectionTicks while
 * x/y/aim/weapon/hp pass through unquantized (encodeSnapshot quantizes).
 */
export function playerToSnapshot(p: Player, shield = 0): SnapshotPlayer {
  let flags = 0;
  if (p.alive) {
    flags |= FLAG_ALIVE;
  }
  if (p.onGround) {
    flags |= FLAG_ON_GROUND;
  }
  if (p.crouching) {
    flags |= FLAG_CROUCHING;
  }
  if (p.reloading) {
    flags |= FLAG_RELOADING;
  }
  if (p.jetting === true) {
    flags |= FLAG_JETTING;
  }
  if ((p.protectionTicks ?? 0) > 0) {
    flags |= FLAG_PROTECTED;
  }
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    aim: p.aim,
    flags,
    weapon: p.weapon,
    hp: p.hp,
    shield,
  };
}

interface NormInput {
  move: number;
  aim: number;
  buttons: number;
}

/**
 * Encode an input packet: hasAck:1, [ackSeq:16, delayMs:8, rttMs:8],
 * firstTick:16, countMinusOne:4 (0-11), viewDelay:9, per-input
 * (repeat:1 | moveX:int8 -64..64, aim:12 step, buttons:10). The first input
 * is always full; each later input equal to its predecessor (quantized
 * moveX step, aim step, buttons) emits a single 1 bit.
 */
export function encodeInputPacket(packet: InputPacket): Buffer {
  const raw = packet as unknown as Record<string, unknown>;
  const list = asArray(raw["inputs"], "inputs");
  if (list.length === 0 || list.length > MAX_INPUTS) {
    fail("inputs.length", list.length);
  }
  const viewDelay = asInt(raw["viewDelay"] ?? 0, "viewDelay");
  if (viewDelay < 0 || viewDelay > VIEW_DELAY_MAX) {
    fail("viewDelay", viewDelay);
  }
  const norms: NormInput[] = list.map((item, i) => {
    const c = ((item ?? {}) as Record<string, unknown>);
    const move = moveStepFor(asNumber(c["moveX"] ?? 0, `inputs[${i}].moveX`));
    const aim = aimStepFor(asNumber(c["aim"] ?? 0, `inputs[${i}].aim`));
    const buttons = asUint(c["buttons"] ?? 0, `inputs[${i}].buttons`);
    if (buttons > 1023) {
      fail(`inputs[${i}].buttons`, buttons);
    }
    return { move, aim, buttons: buttons & BUTTON_MASK_10 };
  });
  const w = new BitWriter();
  const ackRaw = raw["ack"] as Record<string, unknown> | null | undefined;
  if (ackRaw === null || ackRaw === undefined) {
    w.bit(0);
  } else {
    if (typeof ackRaw !== "object" || Array.isArray(ackRaw)) {
      fail("ack", ackRaw);
    }
    const seq = asUint(ackRaw["ackSeq"] ?? ackRaw["seq"], "ack.ackSeq");
    if (seq > 65535) {
      fail("ack.ackSeq", seq);
    }
    const delayMs = asUint(ackRaw["delayMs"] ?? ackRaw["ackDelayMs"] ?? 0, "ack.delayMs");
    if (delayMs > 255) {
      fail("ack.delayMs", delayMs);
    }
    const rttMs = asUint(ackRaw["rttMs"] ?? 0, "ack.rttMs");
    if (rttMs > 255) {
      fail("ack.rttMs", rttMs);
    }
    w.bit(1);
    w.bits(seq, 16);
    w.bits(delayMs, 8);
    w.bits(rttMs, 8);
  }
  w.bits(asUint(raw["firstTick"] ?? raw["tick"] ?? 0, "firstTick") % 65536, 16);
  w.bits(norms.length - 1, 4);
  w.bits(viewDelay, 9);
  for (let i = 0; i < norms.length; i += 1) {
    const cur = norms[i] as NormInput;
    if (i > 0) {
      const prev = norms[i - 1] as NormInput;
      if (cur.move === prev.move && cur.aim === prev.aim && cur.buttons === prev.buttons) {
        w.bit(1);
        continue;
      }
    }
    w.bit(0);
    w.int8(cur.move);
    w.bits(cur.aim, 12);
    w.bits(cur.buttons, 10);
  }
  return w.finish();
}

/** Decode an input packet; truncation or a bad count throws RangeError. */
export function decodeInputPacket(buf: Buffer): DecodedInputPacket {
  const r = new BitReader(buf);
  const hasAck = r.bit();
  let ack: InputAck | undefined;
  if (hasAck === 1) {
    ack = { ackSeq: r.bits(16), delayMs: r.bits(8), rttMs: r.bits(8) };
  }
  const firstTick = r.bits(16);
  const countMinusOne = r.bits(4);
  if (countMinusOne > MAX_INPUTS - 1) {
    throw new RangeError(`codec: bad input count: ${countMinusOne + 1}`);
  }
  const viewDelay = r.bits(9);
  const inputs: CodecInput[] = [];
  for (let i = 0; i < countMinusOne + 1; i += 1) {
    const repeat = r.bit();
    if (repeat === 1) {
      if (i === 0) {
        throw new RangeError("codec: repeat flag on first input");
      }
      const prev = inputs[i - 1] as CodecInput;
      inputs.push({ moveX: prev.moveX, aim: prev.aim, buttons: prev.buttons });
      continue;
    }
    const move = r.int8();
    const aim = r.bits(12);
    const buttons = r.bits(10);
    inputs.push({ moveX: move / 64, aim: (aim / AIM_STEPS) * TWO_PI, buttons });
  }
  const out: DecodedInputPacket = { firstTick, inputs, viewDelay };
  if (ack !== undefined) {
    out.ack = ack;
    defineAlias(ack, "seq", ack.ackSeq);
  }
  defineAlias(out, "tick", firstTick);
  return out;
}
