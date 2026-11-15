// Honest-mode interpolation core: fixed 100 ms delay buffer with clamped
// lerp and zero extrapolation. Pure math, no DOM/clock/socket imports —
// safe to import in-process from vitest or any node probe. Everything on
// screen comes from snapshots (Prediction OFF v5): sample() always renders
// between (or exactly on) stored snapshots, never projects forward.

/** Fixed render delay behind the newest snapshot in ms (inside 80-120). */
export const INTERP_DELAY_MS = 100;
/** Cap on buffered snapshots per client (oldest dropped first). */
export const INTERP_BUFFER_MS = 1000;

/** One interpolated remote/local row rendered from the buffer. */
export interface InterpPlayer {
  /** Player id (matches the snapshot rows). */
  id: number;
  /** Position x in pixels. */
  x: number;
  /** Position y in pixels. */
  y: number;
  /** Aim angle in radians (shortest-arc lerp). */
  aim: number;
  /** Health points. */
  hp: number;
  /** Equipped weapon id. */
  weapon: string;
}

/** Snapshot rows accepted by the buffer (codec SnapshotPlayer compatible). */
export interface BufferPlayer {
  id: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  weapon: string;
}

/** Two-pi wrap shared with the core quantizeAim convention. */
const TWO_PI = Math.PI * 2;

/** Finite number or a fallback (never NaN into the lerp). */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Linear interpolation between two finite endpoints. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Shortest-arc aim lerp between two angles. The delta wraps into
 * [-PI, PI) so 350deg -> 10deg passes through 0deg, never 180deg
 * (same wrap convention as aimStepFor in packages/server/src/codec.ts).
 */
export function lerpAim(a: number, b: number, t: number): number {
  const delta = ((((b - a) % TWO_PI) + Math.PI * 3) % TWO_PI) - Math.PI;
  return a + delta * t;
}

/** One stored snapshot: server tick, arrival clock, and player rows. */
interface BufferedSnapshot {
  tick: number;
  atMs: number;
  players: BufferPlayer[];
}

/**
 * Fixed delay buffer of snapshots. push() stores rows keyed by arrival
 * clock; sample() renders at nowMs - INTERP_DELAY_MS by lerping the two
 * bracketing snapshots, clamping to the nearest edge outside the buffer
 * instead of extrapolating.
 */
export class SnapshotBuffer {
  private readonly snapshots: BufferedSnapshot[] = [];

  /** Stored snapshot count (oldest dropped past the INTERP_BUFFER_MS cap). */
  get size(): number {
    return this.snapshots.length;
  }

  /** Newest stored server tick (-1 when the buffer is empty). */
  get latestTick(): number {
    const last = this.snapshots[this.snapshots.length - 1];
    return last === undefined ? -1 : last.tick;
  }

  /**
   * Store one snapshot. Rows are copied (later caller mutation never
   * leaks into the buffer); non-finite clocks fall back to the newest
   * stored clock (or 0 when empty) so ordering never breaks.
   */
  push(tick: number, atMs: number, players: readonly BufferPlayer[]): void {
    const prev = this.snapshots[this.snapshots.length - 1];
    const clock = Number.isFinite(atMs)
      ? atMs
      : (prev?.atMs ?? 0);
    const rows: BufferPlayer[] = [];
    for (const p of players) {
      if (p === null || typeof p !== "object") {
        continue;
      }
      const id = finiteOr(p.id, -1);
      if (!Number.isInteger(id) || id < 0) {
        continue;
      }
      rows.push({
        id,
        x: finiteOr(p.x, 0),
        y: finiteOr(p.y, 0),
        aim: finiteOr(p.aim, 0),
        hp: finiteOr(p.hp, 100),
        weapon: typeof p.weapon === "string" ? p.weapon : "pistol",
      });
    }
    this.snapshots.push({
      tick: Number.isInteger(tick) ? tick : Math.floor(finiteOr(tick, 0)),
      atMs: clock,
      players: rows,
    });
    while (this.snapshots.length > 0) {
      const first = this.snapshots[0] as BufferedSnapshot;
      const last = this.snapshots[this.snapshots.length - 1] as BufferedSnapshot;
      if (this.snapshots.length > 64 || last.atMs - first.atMs > INTERP_BUFFER_MS) {
        this.snapshots.shift();
      } else {
        break;
      }
    }
  }

  /** Drop every stored snapshot (reconnect/resync entry point). */
  clear(): void {
    this.snapshots.length = 0;
  }

  /**
   * Render rows at nowMs - INTERP_DELAY_MS. The bracketing pair lerps
   * x/y linearly and aim along the shortest arc; players present in
   * only one side hold their known row (no invented motion). A render
   * time at or outside the buffer clamps to the nearest edge, so the
   * output coordinates always sit inside the convex hull of the stored
   * snapshots — extrapolation is impossible by construction.
   */
  sample(nowMs: number): InterpPlayer[] {
    if (this.snapshots.length === 0) {
      return [];
    }
    const now = finiteOr(nowMs, 0);
    const renderAt = now - INTERP_DELAY_MS;
    const first = this.snapshots[0] as BufferedSnapshot;
    if (renderAt <= first.atMs || this.snapshots.length === 1) {
      return first.players.map((p) => ({ ...p }));
    }
    const last = this.snapshots[this.snapshots.length - 1] as BufferedSnapshot;
    if (renderAt >= last.atMs) {
      return last.players.map((p) => ({ ...p }));
    }
    let older = first;
    let newer = last;
    for (let i = 1; i < this.snapshots.length; i += 1) {
      const candidate = this.snapshots[i] as BufferedSnapshot;
      if (candidate.atMs >= renderAt) {
        older = this.snapshots[i - 1] as BufferedSnapshot;
        newer = candidate;
        break;
      }
    }
    const span = newer.atMs - older.atMs;
    const t = span <= 0 ? 0 : (renderAt - older.atMs) / span;
    const clamped = Math.min(1, Math.max(0, t));
    const newerById = new Map<number, BufferPlayer>();
    for (const p of newer.players) {
      newerById.set(p.id, p);
    }
    const olderById = new Map<number, BufferPlayer>();
    for (const p of older.players) {
      olderById.set(p.id, p);
    }
    const ids = new Set<number>([...olderById.keys(), ...newerById.keys()]);
    const out: InterpPlayer[] = [];
    for (const id of ids) {
      const a = olderById.get(id);
      const b = newerById.get(id);
      if (a !== undefined && b !== undefined) {
        out.push({
          id,
          x: lerp(a.x, b.x, clamped),
          y: lerp(a.y, b.y, clamped),
          aim: lerpAim(a.aim, b.aim, clamped),
          hp: clamped < 0.5 ? a.hp : b.hp,
          weapon: clamped < 0.5 ? a.weapon : b.weapon,
        });
      } else {
        const known = (a ?? b) as BufferPlayer;
        out.push({ ...known });
      }
    }
    out.sort((p, q) => p.id - q.id);
    return out;
  }
}
