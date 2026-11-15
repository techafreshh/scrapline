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
  /** Server roster display name (drives the remote nametag). */
  name?: string;
  /** Horizontal velocity in world px/s (derived per sample; drives run). */
  vx?: number;
  /** Vertical velocity in world px/s (derived per sample; drives air). */
  vy?: number;
  /** Jetpack fuel (drives the exhaust flicker band). */
  fuel?: number;
  /** True while the snapshot row reads alive (drives soldier frames). */
  alive?: boolean;
  /** True while the snapshot row reads on ground. */
  onGround?: boolean;
  /** True while the snapshot row reads crouching. */
  crouching?: boolean;
  /** True while the snapshot row reads jetting. */
  jetting?: boolean;
  /** True while the snapshot row reads spawn-protected. */
  protected?: boolean;
}

/** Snapshot rows accepted by the buffer (codec SnapshotPlayer compatible). */
export interface BufferPlayer {
  id: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  weapon: string;
  /** Server roster display name (optional; older snapshots omit it). */
  name?: string;
  /** Snapshot pose flags (optional; absent rows read neutral-alive). */
  fuel?: number;
  alive?: boolean;
  onGround?: boolean;
  crouching?: boolean;
  jetting?: boolean;
  protected?: boolean;
}

/** Snapshot flag bit for alive (mirrors server codec FLAG_ALIVE). */
export const SNAP_FLAG_ALIVE = 1;
/** Snapshot flag bit for on-ground (mirrors server codec FLAG_ON_GROUND). */
export const SNAP_FLAG_ON_GROUND = 2;
/** Snapshot flag bit for crouching (mirrors server codec FLAG_CROUCHING). */
export const SNAP_FLAG_CROUCHING = 4;
/** Snapshot flag bit for jetting (mirrors server codec FLAG_JETTING). */
export const SNAP_FLAG_JETTING = 16;
/** Snapshot flag bit for spawn protection (mirrors codec FLAG_PROTECTED). */
export const SNAP_FLAG_PROTECTED = 32;

/** Pose + identity fields lerped (discrete: nearest side wins) per row. */
export interface BufferPose {
  name?: string;
  alive?: boolean;
  onGround?: boolean;
  crouching?: boolean;
  jetting?: boolean;
  protected?: boolean;
}

/** True for a finite boolean-ish flag (non-booleans read as absent). */
function optBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Discrete pose for a row: defined side wins, else the other side. */
function pickPose(a: BufferPose | undefined, b: BufferPose | undefined, useA: boolean): BufferPose {
  const first = useA ? a : b;
  const second = useA ? b : a;
  const pick = <T>(get: (p: BufferPose) => T | undefined): T | undefined =>
    get(first ?? {}) ?? get(second ?? {});
  return {
    name: pick((p) => (typeof p.name === "string" && p.name.length > 0 ? p.name : undefined)),
    alive: pick((p) => optBool(p.alive)),
    onGround: pick((p) => optBool(p.onGround)),
    crouching: pick((p) => optBool(p.crouching)),
    jetting: pick((p) => optBool(p.jetting)),
    protected: pick((p) => optBool(p.protected)),
  };
}

/**
 * Decode snapshot flag bits into row pose fields. Unknown/non-numeric
 * flags read neutral-alive so flag-less snapshots keep rendering.
 */
export function poseFromFlags(flags: unknown): {
  alive: boolean;
  onGround: boolean;
  crouching: boolean;
  jetting: boolean;
  protected: boolean;
} {
  if (typeof flags !== "number" || !Number.isFinite(flags)) {
    return { alive: true, onGround: true, crouching: false, jetting: false, protected: false };
  }
  const bits = Math.floor(flags);
  return {
    alive: (bits & SNAP_FLAG_ALIVE) !== 0,
    onGround: (bits & SNAP_FLAG_ON_GROUND) !== 0,
    crouching: (bits & SNAP_FLAG_CROUCHING) !== 0,
    jetting: (bits & SNAP_FLAG_JETTING) !== 0,
    protected: (bits & SNAP_FLAG_PROTECTED) !== 0,
  };
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
      const pose = poseFromFlags((p as { flags?: unknown }).flags);
      rows.push({
        id,
        x: finiteOr(p.x, 0),
        y: finiteOr(p.y, 0),
        aim: finiteOr(p.aim, 0),
        hp: finiteOr(p.hp, 100),
        fuel: finiteOr((p as { fuel?: unknown }).fuel, 100),
        weapon: typeof p.weapon === "string" ? p.weapon : "pistol",
        name: typeof p.name === "string" && p.name.length > 0 ? p.name : undefined,
        alive: optBool(p.alive) ?? pose.alive,
        onGround: optBool(p.onGround) ?? pose.onGround,
        crouching: optBool(p.crouching) ?? pose.crouching,
        jetting: optBool(p.jetting) ?? pose.jetting,
        protected: optBool(p.protected) ?? pose.protected,
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
        const pose = pickPose(a, b, clamped < 0.5);
        // Per-row velocity from the bracketing pair (world px/s): the
        // soldier run-cycle and air blend key off these, so remotes
        // stride and tuck exactly like the offline sim. Edges hold 0.
        const dt = newer.atMs - older.atMs;
        const vx = dt > 0 ? ((b.x - a.x) / dt) * 1000 : 0;
        const vy = dt > 0 ? ((b.y - a.y) / dt) * 1000 : 0;
        out.push({
          id,
          x: lerp(a.x, b.x, clamped),
          y: lerp(a.y, b.y, clamped),
          aim: lerpAim(a.aim, b.aim, clamped),
          hp: clamped < 0.5 ? a.hp : b.hp,
          fuel: clamped < 0.5 ? (a.fuel ?? 100) : (b.fuel ?? 100),
          vx,
          vy,
          weapon: clamped < 0.5 ? a.weapon : b.weapon,
          ...pose,
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
