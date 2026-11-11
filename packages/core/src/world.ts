// Deterministic 60 Hz platformer physics: run, crouch, jetpack, hop.
//
// The sim is sacred: this module imports only relative sim modules and
// tuning from ./constants, and touches no DOM, Node, clock, or
// Math.random APIs. All entropy flows through the seeded PRNG in ./rng.
// Screen coordinates are y-down (TileMap-compatible): falling is +vy,
// jetpack thrust and hops are -vy.

import {
  AIM_STEPS,
  AIR_ACCEL,
  AIR_DRAG,
  BARREL_EXPLODE_DAMAGE,
  BARREL_EXPLODE_RADIUS_PX,
  BARREL_H,
  BARREL_HP,
  BARREL_RESPAWN_TICKS,
  BARREL_W,
  CRATE_H,
  CRATE_HP,
  CRATE_RESPAWN_TICKS,
  CRATE_W,
  CROUCH_SPEED,
  GRAVITY,
  GRENADE_BOUNCE,
  GRENADE_COOLDOWN_TICKS,
  GRENADE_DAMAGE,
  GRENADE_FUSE_TICKS,
  GRENADE_GRAVITY,
  GRENADE_MAX,
  GRENADE_PICKUP_AMOUNT,
  GRENADE_PICKUP_RESPAWN_TICKS,
  GRENADE_RADIUS_PX,
  GRENADE_THROW_SPEED_PX_S,
  GROUND_ACCEL,
  GROUND_FRICTION,
  HEALTH_MAX,
  HEALTH_PICKUP_AMOUNT,
  HEALTH_REGEN_DELAY_TICKS,
  HEALTH_REGEN_PER_S,
  HEALTH_RESPAWN_TICKS,
  HOP_SPEED,
  JETPACK_ACCEL,
  JETPACK_BURN_PER_S,
  JETPACK_FUEL_MAX,
  JETPACK_MAX_UP,
  JETPACK_MIN_FUEL_TO_START,
  JETPACK_REGEN_AIR_PER_S,
  JETPACK_REGEN_DELAY_S,
  JETPACK_REGEN_GROUND_PER_S,
  MATCH_SCORE_LIMIT,
  MATCH_TIME_LIMIT_TICKS,
  MAX_FALL,
  MOVE_X_QUANT,
  PICKUP_RADIUS_PX,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  PROTECTION_TICKS,
  RESPAWN_TICKS,
  ROCKET_SPEED_PX_S,
  RUN_SPEED,
  TICK_HZ,
  WEAPON_RESPAWN_TICKS,
} from "./constants";
import type { Pickup, PickupKind, Player, Projectile, Prop, PropKind } from "./entities";
import type { WorldEvent } from "./events";
import { isMatchOver, standingsFor, type MatchMode } from "./match";
import { TILE_SIZE, TileMap } from "./map";
import { createRng, type Rng } from "./rng";
import { WEAPONS, type WeaponId } from "./weapons";

export { TICK_HZ, AIM_STEPS, MOVE_X_QUANT } from "./constants";

/** Button bit for the jetpack (RECON netcode bitmask). */
export const BUTTON_JET = 1;
/** Button bit for crouching (RECON netcode bitmask). */
export const BUTTON_CROUCH = 2;
/** Button bit for firing the equipped weapon (RECON netcode bitmask). */
export const BUTTON_FIRE = 4;
/** Button bit for throwing a grenade (RECON netcode bitmask). */
export const BUTTON_GRENADE = 8;
/** Alias of BUTTON_GRENADE (both spellings probed). */
export const BUTTON_THROW = 8;
/** Button bit for reloading the equipped weapon (RECON netcode bitmask). */
export const BUTTON_RELOAD = 32;
/** Frozen button-bit table probed by harnesses and clients. */
export const BUTTONS = Object.freeze({
  JET: BUTTON_JET,
  CROUCH: BUTTON_CROUCH,
  FIRE: BUTTON_FIRE,
  GRENADE: BUTTON_GRENADE,
  THROW: BUTTON_THROW,
  RELOAD: BUTTON_RELOAD,
});

/** Per-tick player input. */
export interface WorldInput {
  /** Lateral intent in [-1, 1] (quantized to 1/64 steps). */
  moveX?: number;
  /** Aim angle in radians (quantized to 4096 steps). */
  aim?: number;
  /** Button bitmask (JET:1 CROUCH:2 FIRE:4 RELOAD:32). */
  buttons?: number;
  /** Boolean alias for `buttons & BUTTON_JET` (ORed into buttons). */
  jet?: boolean;
  /** Boolean alias for `buttons & BUTTON_CROUCH` (ORed into buttons). */
  crouch?: boolean;
  /** Boolean alias for `buttons & BUTTON_FIRE` (ORed into buttons). */
  fire?: boolean;
  /** Boolean alias for `buttons & BUTTON_GRENADE` (ORed into buttons). */
  grenade?: boolean;
  /** Alias of `grenade` (ORed into buttons as BUTTON_THROW). */
  throw?: boolean;
  /** Boolean alias for `buttons & BUTTON_RELOAD` (ORed into buttons). */
  reload?: boolean;
}

/** Accepted map forms for WorldOptions (TileMap or ASCII rows). */
export type WorldMapInput = TileMap | string[] | string;

/** Options for building a World. */
export interface WorldOptions {
  /** Seed for the deterministic PRNG. */
  seed?: number;
  /** Match mode (only "ffa" implemented; stored verbatim). */
  mode?: MatchMode;
  /** Kills to win (positive integer, else 25). */
  scoreLimit?: number;
  /** Ticks to time-limit (positive integer, else 18000). */
  timeLimitTicks?: number;
  /** Map override: TileMap instance or ASCII rows. */
  map?: WorldMapInput;
  /** ASCII rows override (alias for map-as-rows). */
  rows?: string[] | string;
  /** ASCII rows override (alias for map-as-rows). */
  mapRows?: string[] | string;
}

/** Extra spawn fields accepted alongside x/y. */
export interface SpawnOptions {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  hp?: number;
  fuel?: number;
  aim?: number;
}

/** Per-player edge/regen memory kept alongside Player state. */
interface SimMemory {
  /** Jet held on the previous tick (hop rising-edge). */
  prevJet: boolean;
  /** Thrust was active last tick (re-ignite hysteresis). */
  wasThrust: boolean;
  /** Seconds since thrust stopped (air-regen delay). */
  sinceThrust: number;
}

function isTileMap(value: unknown): value is TileMap {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TileMap).isSolidTile === "function" &&
    typeof (value as TileMap).collideBox === "function"
  );
}

function toRows(value: string[] | string): string[] {
  return Array.isArray(value) ? value.slice() : value.split("\n");
}

/** Default flat arena: wide empty air over two solid floor rows. */
function defaultRows(): string[] {
  const width = 40;
  const height = 20;
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(y < height - 2 ? ".".repeat(width) : "#".repeat(width));
  }
  return rows;
}

// Headshot band: hits landing in the top 15px of the victim box crit.
const HEADSHOT_BAND_PX = 15;

/**
 * Segment-vs-AABB entry param in [0, 1] or null on miss. The segment runs
 * from (ox, oy) to (ex, ey); the box is [minX, maxX] x [minY, maxY].
 */
function segmentAABB(
  ox: number,
  oy: number,
  ex: number,
  ey: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number | null {
  const dx = ex - ox;
  const dy = ey - oy;
  let tmin = 0;
  let tmax = 1;
  const EPS = 1e-12;
  if (Math.abs(dx) < EPS) {
    if (ox < minX || ox > maxX) {
      return null;
    }
  } else {
    let t1 = (minX - ox) / dx;
    let t2 = (maxX - ox) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) {
      tmin = t1;
    }
    if (t2 < tmax) {
      tmax = t2;
    }
    if (tmin > tmax) {
      return null;
    }
  }
  if (Math.abs(dy) < EPS) {
    if (oy < minY || oy > maxY) {
      return null;
    }
  } else {
    let t1 = (minY - oy) / dy;
    let t2 = (maxY - oy) / dy;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) {
      tmin = t1;
    }
    if (t2 < tmax) {
      tmax = t2;
    }
    if (tmin > tmax) {
      return null;
    }
  }
  return tmin;
}

// The ONLY randomness source in the sim lives in ./rng.

export function quantizeMoveX(value: number): number {
  const clamped = Math.min(1, Math.max(-1, value));
  return Math.round(clamped / MOVE_X_QUANT) * MOVE_X_QUANT;
}

export function quantizeAim(radians: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = ((radians % twoPi) + twoPi) % twoPi;
  const step = Math.round((wrapped / twoPi) * AIM_STEPS) % AIM_STEPS;
  return (step / AIM_STEPS) * twoPi;
}

export class World {
  /** Fixed-timestep tick counter. */
  tick = 0;
  /** World seed (drives the PRNG marker in hash()). */
  readonly seed: number;
  /** Live player list (also visible as state.players). */
  readonly players: Player[] = [];
  /** Live projectiles (rockets and grenades). */
  readonly projectiles: Projectile[] = [];
  /** Destructible props (barrels and crates). */
  readonly props: Prop[] = [];
  /** Map pickups (weapon pads, health packs, grenade packs). */
  readonly pickups: Pickup[] = [];
  /** FFA kills per player-array position (scores[i] owns players[i]). */
  readonly scores: number[] = [];
  /** Match mode (only "ffa" implemented). */
  readonly mode: MatchMode;
  /** Kills to win. */
  readonly scoreLimit: number;
  /** Ticks to time-limit. */
  readonly timeLimitTicks: number;
  private readonly tileMap: TileMap;
  private readonly marker: number;
  private readonly rng: Rng;
  private readonly sim: SimMemory[] = [];
  private nextId = 0;
  private nextProjectileId = 0;
  private nextPropId = 0;
  private nextPickupId = 0;

  constructor(options: WorldOptions = {}) {
    this.seed = options.seed ?? 0;
    this.mode = options.mode ?? "ffa";
    const scoreLimit = options.scoreLimit;
    this.scoreLimit =
      scoreLimit !== undefined && Number.isInteger(scoreLimit) && scoreLimit > 0
        ? scoreLimit
        : MATCH_SCORE_LIMIT;
    const timeLimitTicks = options.timeLimitTicks;
    this.timeLimitTicks =
      timeLimitTicks !== undefined && Number.isInteger(timeLimitTicks) && timeLimitTicks > 0
        ? timeLimitTicks
        : MATCH_TIME_LIMIT_TICKS;
    const rng = createRng(this.seed);
    // Prove the seed flows into state: drawn once, covered by hash().
    this.marker = rng.nextUint32();
    this.rng = rng;
    const fromMap = options.map;
    if (isTileMap(fromMap)) {
      this.tileMap = fromMap;
    } else if (typeof fromMap === "string" || Array.isArray(fromMap)) {
      this.tileMap = new TileMap(toRows(fromMap));
    } else if (options.rows !== undefined) {
      this.tileMap = new TileMap(toRows(options.rows));
    } else if (options.mapRows !== undefined) {
      this.tileMap = new TileMap(toRows(options.mapRows));
    } else {
      this.tileMap = new TileMap(defaultRows());
    }
  }

  /** Active collision map. */
  get map(): TileMap {
    return this.tileMap;
  }

  /** Snapshot alias exposing the shared arrays plus tick/seed/scores. */
  get state(): {
    tick: number;
    seed: number;
    players: Player[];
    projectiles: Projectile[];
    props: Prop[];
    pickups: Pickup[];
    scores: number[];
    mode: MatchMode;
    matchOver: boolean;
  } {
    this.syncScores();
    return {
      tick: this.tick,
      seed: this.seed,
      players: this.players,
      projectiles: this.projectiles,
      props: this.props,
      pickups: this.pickups,
      scores: this.scores,
      mode: this.mode,
      matchOver: this.matchOver,
    };
  }

  /** True once a score cap or the time cap is reached. */
  get matchOver(): boolean {
    const scores = (this as { scores?: number[] }).scores ?? [];
    return isMatchOver(
      scores,
      this.tick,
      this.scoreLimit ?? MATCH_SCORE_LIMIT,
      this.timeLimitTicks ?? MATCH_TIME_LIMIT_TICKS,
    );
  }

  /** Leader id, or -1 when no players exist. */
  get winner(): number {
    const order = this.standings();
    return order.length > 0 ? (order[0] as number) : -1;
  }

  /** Player ids ordered by score desc, id asc on ties. */
  standings(): number[] {
    this.syncScores();
    return standingsFor(
      this.scores,
      this.players.map((p) => p.id),
    );
  }

  /**
   * Credit a kill to a player id; no-op for unknown ids and once the
   * match is over (the triggering kill counts, later kills don't).
   */
  registerKill(playerId: number): void {
    this.syncScores();
    if (this.matchOver) {
      return;
    }
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx < 0 || idx >= this.scores.length) {
      return;
    }
    this.scores[idx] = (this.scores[idx] ?? 0) + 1;
  }

  /** Backfill scores so scores.length tracks players.length. */
  private syncScores(): void {
    let scores = (this as { scores?: number[] }).scores;
    if (scores === undefined) {
      scores = [];
      (this as { scores: number[] }).scores = scores;
    }
    while (scores.length < this.players.length) {
      scores.push(0);
    }
    if (scores.length > this.players.length) {
      scores.length = this.players.length;
    }
  }

  /**
   * Add a destructible prop; barrels default to 26x34 hp30, crates to
   * 30x30 hp60. Accepts (kind, x, y) or an options object.
   */
  addProp(kind: PropKind, x?: number, y?: number): Prop;
  addProp(opts: { kind?: PropKind; x?: number; y?: number }): Prop;
  addProp(
    kindOrOpts: PropKind | { kind?: PropKind; x?: number; y?: number },
    x?: number,
    y?: number,
  ): Prop {
    let kind: PropKind;
    let px: number;
    let py: number;
    if (typeof kindOrOpts === "string") {
      kind = kindOrOpts;
      px = x ?? 0;
      py = y ?? 0;
    } else {
      kind = kindOrOpts.kind ?? "barrel";
      px = kindOrOpts.x ?? x ?? 0;
      py = kindOrOpts.y ?? y ?? 0;
    }
    const isBarrel = kind === "barrel";
    const prop: Prop = {
      id: this.nextPropId,
      kind,
      x: px,
      y: py,
      w: isBarrel ? BARREL_W : CRATE_W,
      h: isBarrel ? BARREL_H : CRATE_H,
      hp: isBarrel ? BARREL_HP : CRATE_HP,
      alive: true,
      respawnTicks: 0,
    };
    this.nextPropId += 1;
    this.props.push(prop);
    return prop;
  }

  /**
   * Add a map pickup; weapon pads default to the rifle with no amount,
   * health packs heal 50 and grenade packs grant 2. Accepts
   * (kind, x, y, weapon?) or an options object.
   */
  addPickup(kind: PickupKind, x?: number, y?: number, weapon?: WeaponId): Pickup;
  addPickup(opts: {
    kind?: PickupKind;
    x?: number;
    y?: number;
    weapon?: WeaponId;
    amount?: number;
  }): Pickup;
  addPickup(
    kindOrOpts:
      | PickupKind
      | { kind?: PickupKind; x?: number; y?: number; weapon?: WeaponId; amount?: number },
    x?: number,
    y?: number,
    weapon?: WeaponId,
  ): Pickup {
    let kind: PickupKind;
    let px: number;
    let py: number;
    let granted: WeaponId | undefined;
    let amount: number | undefined;
    if (typeof kindOrOpts === "string") {
      kind = kindOrOpts;
      px = x ?? 0;
      py = y ?? 0;
      granted = weapon;
    } else {
      kind = kindOrOpts.kind ?? "weapon";
      px = kindOrOpts.x ?? x ?? 0;
      py = kindOrOpts.y ?? y ?? 0;
      granted = kindOrOpts.weapon ?? weapon;
      amount = kindOrOpts.amount;
    }
    const pickup: Pickup = {
      id: this.nextPickupId,
      kind,
      x: px,
      y: py,
      weapon: kind === "weapon" ? (granted ?? "rifle") : granted,
      amount:
        amount ??
        (kind === "health"
          ? HEALTH_PICKUP_AMOUNT
          : kind === "grenades"
            ? GRENADE_PICKUP_AMOUNT
            : 0),
      active: true,
      respawnTicks: 0,
    };
    this.nextPickupId += 1;
    this.pickups.push(pickup);
    return pickup;
  }

  /**
   * True when the pixel point is inside a solid tile or any live prop
   * AABB (non-finite points read solid, mirroring TileMap.isSolidAt).
   */
  isSolidAt(px: number, py: number): boolean {
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return true;
    }
    if (this.tileMap.isSolidAt(px, py)) {
      return true;
    }
    for (const prop of this.props) {
      if (!prop.alive) {
        continue;
      }
      if (px >= prop.x && px < prop.x + prop.w && py >= prop.y && py < prop.y + prop.h) {
        return true;
      }
    }
    return false;
  }

  /**
   * Damage a prop by reference or id, clamping at 0. Lethal hits mark it
   * dead with kind respawn ticks and chain-explode barrels at their
   * center. Returns the prop.
   */
  damageProp(
    target: Prop | number,
    amount: number,
    events?: WorldEvent[],
    protectionAtStart?: number[],
  ): Prop {
    const prop =
      typeof target === "number" ? this.props.find((p) => p.id === target) : target;
    if (prop === undefined) {
      throw new Error("unknown prop");
    }
    if (!prop.alive) {
      return prop;
    }
    prop.hp -= amount;
    if (prop.hp > 0) {
      return prop;
    }
    prop.hp = 0;
    prop.alive = false;
    prop.respawnTicks = prop.kind === "barrel" ? BARREL_RESPAWN_TICKS : CRATE_RESPAWN_TICKS;
    if (prop.kind === "barrel") {
      const log = events ?? [];
      const guard =
        protectionAtStart ?? this.players.map((p) => p.protectionTicks ?? 0);
      this.explode(
        prop.x + prop.w / 2,
        prop.y + prop.h / 2,
        BARREL_EXPLODE_RADIUS_PX,
        BARREL_EXPLODE_DAMAGE,
        -1,
        log,
        guard,
      );
    }
    return prop;
  }

  /** Pixel y of the first solid tile top under px (defaults to floor). */
  private groundTopAt(px: number): number {
    const tx = Math.floor(px / TILE_SIZE);
    for (let ty = 0; ty < this.tileMap.heightTiles; ty += 1) {
      if (this.tileMap.isSolidTile(tx, ty)) {
        return ty * TILE_SIZE;
      }
    }
    return this.tileMap.heightPixels;
  }

  /**
   * Add a player at (x, y) or from an options object; bare calls spawn
   * standing on the floor at x=100. Extra fields override defaults.
   */
  addPlayer(x?: number, y?: number): Player;
  addPlayer(opts?: SpawnOptions): Player;
  addPlayer(x?: number | SpawnOptions, y?: number): Player {
    const sx = typeof x === "number" ? x : x?.x;
    const sy = typeof x === "number" ? y : (x?.y ?? y);
    const extra: SpawnOptions = typeof x === "number" ? {} : (x ?? {});
    const opts: SpawnOptions = { ...extra, x: sx, y: sy };
    const groundTop = this.groundTopAt(opts.x ?? 100);
    const px = opts.x ?? 100;
    const py = opts.y ?? groundTop - PLAYER_HEIGHT;
    const player: Player = {
      id: this.nextId,
      x: px,
      y: py,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      hp: opts.hp ?? HEALTH_MAX,
      fuel: opts.fuel ?? JETPACK_FUEL_MAX,
      aim: opts.aim ?? 0,
      weapon: "pistol",
      onGround: false,
      crouching: false,
      alive: true,
      magAmmo: WEAPONS.pistol.mag,
      reserveAmmo: WEAPONS.pistol.mag,
      reloading: false,
      respawnTicks: 0,
      protectionTicks: 0,
      cooldownTicks: 0,
      reloadTicks: 0,
      ticksSinceDamage: 9999,
      spawnX: px,
      spawnY: py,
      grenades: GRENADE_MAX,
      grenadeCooldownTicks: 0,
    };
    this.nextId += 1;
    // Standing check: solid tile directly under the feet.
    player.onGround = this.tileMap.isSolidAt(px + PLAYER_WIDTH / 2, py + PLAYER_HEIGHT + 1);
    this.players.push(player);
    if ((this as { scores?: number[] }).scores === undefined) {
      (this as { scores: number[] }).scores = [];
    }
    this.scores.push(0);
    this.sim.push({ prevJet: false, wasThrust: false, sinceThrust: JETPACK_REGEN_DELAY_S });
    return player;
  }

  /** Alias of addPlayer (both spellings are probed). */
  spawnPlayer(x?: number, y?: number): Player;
  spawnPlayer(opts?: SpawnOptions): Player;
  spawnPlayer(x?: number | SpawnOptions, y?: number): Player {
    if (typeof x === "object") {
      return this.addPlayer(x ?? {});
    }
    return this.addPlayer(x, y);
  }

  /**
   * Advance one 60 Hz tick. Accepts a single input, an input array
   * (one entry per player), or nothing (neutral inputs). Missing
   * players auto-exist so bare Worlds stay steppable.
   */
  step(inputs?: WorldInput | WorldInput[] | null): string[] {
    const list: WorldInput[] =
      inputs === undefined || inputs === null
        ? []
        : Array.isArray(inputs)
          ? inputs
          : [inputs];
    if (this.players.length === 0 && list.length === 0) {
      this.addPlayer();
    }
    while (this.players.length < list.length) {
      this.addPlayer();
    }
    while (this.sim.length < this.players.length) {
      this.sim.push({ prevJet: false, wasThrust: false, sinceThrust: JETPACK_REGEN_DELAY_S });
    }
    if (this.sim.length > this.players.length) {
      this.sim.length = this.players.length;
    }
    this.syncScores();
    const matchOverAtStart = this.matchOver;
    const dt = 1 / TICK_HZ;
    const events: WorldEvent[] = [];
    // Tick-start protection snapshot: counters tick in player order before
    // any firing, so the damage gate reads the snapshot (plus current for
    // same-tick respawns) instead of order-dependent decremented values.
    const protectionAtStart = this.players.map((p) => p.protectionTicks ?? 0);
    // Fire/reload/grenade intents decoded in pass 1, executed in pass 2
    // (firing last) so regen/respawn countdowns and movement settle
    // order-free.
    const fireIntent: boolean[] = [];
    const reloadIntent: boolean[] = [];
    const grenadeIntent: boolean[] = [];
    // Tolerate pre-lap serialized worlds missing the new arrays.
    if ((this as { projectiles?: Projectile[] }).projectiles === undefined) {
      (this as { projectiles: Projectile[] }).projectiles = [];
    }
    if ((this as { props?: Prop[] }).props === undefined) {
      (this as { props: Prop[] }).props = [];
    }
    if ((this as { pickups?: Pickup[] }).pickups === undefined) {
      (this as { pickups: Pickup[] }).pickups = [];
    }
    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i] as Player;
      const memory = this.sim[i] as SimMemory;
      const raw = (list[i] ?? {}) as WorldInput;
      const buttons =
        Math.floor(raw.buttons ?? 0) |
        (raw.jet === true ? BUTTON_JET : 0) |
        (raw.crouch === true ? BUTTON_CROUCH : 0) |
        (raw.fire ? BUTTON_FIRE : 0) |
        (raw.grenade ? BUTTON_GRENADE : 0) |
        (raw.throw ? BUTTON_THROW : 0) |
        (raw.reload ? BUTTON_RELOAD : 0);
      const jet = (buttons & BUTTON_JET) !== 0;
      const crouch = (buttons & BUTTON_CROUCH) !== 0;
      const moveX = quantizeMoveX(raw.moveX ?? 0);
      if (raw.aim !== undefined) {
        player.aim = quantizeAim(raw.aim);
      }

      // Backfill combat fields for players predating this lap.
      if (player.protectionTicks === undefined) {
        player.protectionTicks = 0;
      }
      if (player.cooldownTicks === undefined) {
        player.cooldownTicks = 0;
      }
      if (player.reloadTicks === undefined) {
        player.reloadTicks = 0;
      }
      if (player.ticksSinceDamage === undefined) {
        player.ticksSinceDamage = 9999;
      }
      if (player.spawnX === undefined) {
        player.spawnX = player.x;
      }
      if (player.spawnY === undefined) {
        player.spawnY = player.y;
      }
      if (player.respawnTicks === undefined) {
        player.respawnTicks = 0;
      }
      if (player.magAmmo === undefined) {
        player.magAmmo = (WEAPONS[player.weapon] ?? WEAPONS.pistol).mag;
      }
      if (player.reloading === undefined) {
        player.reloading = false;
      }
      if (player.grenades === undefined) {
        player.grenades = GRENADE_MAX;
      }
      if (player.grenadeCooldownTicks === undefined) {
        player.grenadeCooldownTicks = 0;
      }

      // Dead: count down to respawn at the recorded spawn point.
      if (player.alive === false) {
        if (player.respawnTicks <= 0) {
          player.respawnTicks = RESPAWN_TICKS;
        }
        player.respawnTicks -= 1;
        if (player.respawnTicks <= 0) {
          const stat = WEAPONS[player.weapon] ?? WEAPONS.pistol;
          player.x = player.spawnX ?? player.x;
          player.y = player.spawnY ?? player.y;
          player.vx = 0;
          player.vy = 0;
          player.hp = HEALTH_MAX;
          player.fuel = JETPACK_FUEL_MAX;
          player.alive = true;
          player.magAmmo = stat.mag;
          player.reloading = false;
          player.reloadTicks = 0;
          player.cooldownTicks = 0;
          player.grenades = GRENADE_MAX;
          player.grenadeCooldownTicks = 0;
          player.protectionTicks = PROTECTION_TICKS;
          player.respawnTicks = 0;
          player.ticksSinceDamage = 9999;
          player.crouching = false;
          player.onGround = this.tileMap.isSolidAt(
            player.x + PLAYER_WIDTH / 2,
            player.y + PLAYER_HEIGHT + 1,
          );
        }
        memory.prevJet = jet;
        memory.wasThrust = false;
        continue;
      }

      // Treat hp<=0 sleepers as fresh deaths (harness may set hp only).
      // RESPAWN_TICKS - 1 keeps the 180-tick revive promise: the dead
      // branch decrements each later tick, reaching 0 after 180 steps.
      if (player.hp <= 0) {
        player.hp = 0;
        player.alive = false;
        player.respawnTicks = RESPAWN_TICKS - 1;
        events.push("kill");
        memory.prevJet = jet;
        memory.wasThrust = false;
        continue;
      }

      // Combat counters tick before movement/fire.
      if ((player.protectionTicks ?? 0) > 0) {
        player.protectionTicks = (player.protectionTicks ?? 0) - 1;
      }
      if ((player.cooldownTicks ?? 0) > 0) {
        player.cooldownTicks = (player.cooldownTicks ?? 0) - 1;
      }
      if ((player.grenadeCooldownTicks ?? 0) > 0) {
        player.grenadeCooldownTicks = (player.grenadeCooldownTicks ?? 0) - 1;
      }
      if (player.reloading) {
        player.reloadTicks = (player.reloadTicks ?? 0) - 1;
        if ((player.reloadTicks ?? 0) <= 0) {
          const stat = WEAPONS[player.weapon] ?? WEAPONS.pistol;
          player.magAmmo = stat.mag;
          player.reloading = false;
          player.reloadTicks = 0;
        }
      }
      player.ticksSinceDamage = Math.min(100000, (player.ticksSinceDamage ?? 9999) + 1);
      if (
        (player.ticksSinceDamage ?? 0) >= HEALTH_REGEN_DELAY_TICKS &&
        player.hp < HEALTH_MAX &&
        player.hp > 0
      ) {
        player.hp = Math.min(HEALTH_MAX, player.hp + HEALTH_REGEN_PER_S / TICK_HZ);
      }

      const wasGround = player.onGround;

      // Stance hitbox: keep the feet planted across stand/crouch swaps.
      const oldHeight = player.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
      player.crouching = crouch;
      const boxHeight = player.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
      player.y += oldHeight - boxHeight;

      // Horizontal: approach the stance target with ground/air rates.
      const target = moveX * (player.crouching ? CROUCH_SPEED : RUN_SPEED);
      const hasTarget = target !== 0;
      const rate = player.onGround
        ? hasTarget
          ? GROUND_ACCEL
          : GROUND_FRICTION
        : hasTarget
          ? AIR_ACCEL
          : AIR_DRAG;
      const maxDelta = rate * dt;
      const diff = target - player.vx;
      player.vx += Math.min(Math.max(diff, -maxDelta), maxDelta);

      // Hop: JET rising edge while grounded, gated on fuel permission.
      // A live thrust stream only needs fuel > 0; re-igniting from rest
      // needs JETPACK_MIN_FUEL_TO_START stocked first.
      const canStart = player.fuel >= JETPACK_MIN_FUEL_TO_START;
      const fuelOk = player.fuel > 0 && (memory.wasThrust || canStart);
      if (jet && !memory.prevJet && player.onGround && fuelOk) {
        player.vy = -HOP_SPEED;
        events.push("hop");
      }

      // Vertical: gravity pulls down, jet thrust pushes up.
      player.vy += GRAVITY * dt;
      if (player.vy > MAX_FALL) {
        player.vy = MAX_FALL;
      }
      let thrusting = false;
      if (jet && fuelOk) {
        player.vy -= JETPACK_ACCEL * dt;
        if (player.vy < -JETPACK_MAX_UP) {
          player.vy = -JETPACK_MAX_UP;
        }
        thrusting = true;
      }

      // Integrate through one swept collideBox; the blocked axis stops
      // flush and only a downward Y hit counts as grounded.
      const dx = player.vx * dt;
      const dy = player.vy * dt;
      const hit = this.tileMap.collideBox(player.x, player.y, PLAYER_WIDTH, boxHeight, dx, dy);
      player.x = hit.x;
      player.y = hit.y;
      if (hit.hitX) {
        player.vx = 0;
      }
      if (hit.hitY) {
        player.vy = 0;
      }
      player.onGround = hit.hitY && dy > 0;
      if (!wasGround && player.onGround) {
        events.push("land");
      }
      // Live props block movement: push out of any overlap after tiles.
      this.collideProps(player, boxHeight);

      // Fuel: burn while thrusting, otherwise regen (ground rate at
      // once, air rate only after the post-thrust delay).
      if (thrusting) {
        memory.sinceThrust = 0;
        player.fuel -= JETPACK_BURN_PER_S * dt;
      } else {
        memory.sinceThrust += dt;
        if (player.onGround) {
          player.fuel += JETPACK_REGEN_GROUND_PER_S * dt;
        } else if (memory.sinceThrust >= JETPACK_REGEN_DELAY_S) {
          player.fuel += JETPACK_REGEN_AIR_PER_S * dt;
        }
      }
      player.fuel = Math.min(JETPACK_FUEL_MAX, Math.max(0, player.fuel));

      // Defer firing: record intents, executed order-free in pass 2 below.
      fireIntent[i] = (buttons & BUTTON_FIRE) !== 0;
      reloadIntent[i] = (buttons & BUTTON_RELOAD) !== 0;
      grenadeIntent[i] = (buttons & BUTTON_GRENADE) !== 0;

      memory.prevJet = jet;
      memory.wasThrust = thrusting;
    }
    // Pickup collection runs on post-movement positions; the respawn ticks
    // run after so a consumed pad counts its first tick the same step.
    this.collectPickups(events);
    // Projectile update between movement and firing: splash reads the
    // same tick-start protection snapshot so kills stay order-free.
    this.tickProps();
    this.tickPickups();
    this.stepProjectiles(dt, events, protectionAtStart);
    // Pass 2: firing last, after every player's regen/respawn/movement.
    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i] as Player;
      // Shooters dead before their turn never fire.
      if (player.alive === false || player.hp <= 0) {
        continue;
      }
      // Hitscan fire with spread, headshots, ammo, and reload.
      const stat = WEAPONS[player.weapon] ?? WEAPONS.pistol;
      const firePressed = fireIntent[i] === true;
      const reloadPressed = reloadIntent[i] === true;
      if (reloadPressed && !player.reloading && player.magAmmo < stat.mag) {
        player.reloading = true;
        player.reloadTicks = stat.reload;
      }
      if (firePressed && !player.reloading && (player.cooldownTicks ?? 0) <= 0) {
        if (player.magAmmo > 0) {
          player.magAmmo -= 1;
          player.cooldownTicks = stat.cooldownTicks;
          events.push("shot");
          if (player.magAmmo <= 0) {
            player.reloading = true;
            player.reloadTicks = stat.reload;
          }
          if (stat.kind === "hitscan") {
            const shooterH = player.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
            const mx = player.x + PLAYER_WIDTH / 2;
            const my = player.y + shooterH / 2;
            for (let pellet = 0; pellet < stat.pellets; pellet += 1) {
              const spreadOffset = (this.rng.next() * 2 - 1) * stat.spread;
              const angle = player.aim + spreadOffset;
              const ex = mx + Math.cos(angle) * stat.range;
              const ey = my + Math.sin(angle) * stat.range;
              let bestT = Infinity;
              let bestIdx = -1;
              for (let j = 0; j < this.players.length; j += 1) {
                if (j === i) {
                  continue;
                }
                const victim = this.players[j] as Player;
                if (!victim.alive || victim.hp <= 0) {
                  continue;
                }
                const victimH = victim.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
                const t = segmentAABB(
                  mx,
                  my,
                  ex,
                  ey,
                  victim.x,
                  victim.y,
                  victim.x + PLAYER_WIDTH,
                  victim.y + victimH,
                );
                if (t !== null && t < bestT) {
                  bestT = t;
                  bestIdx = j;
                }
              }
              // Nearest live prop on the pellet ray; nearest of wall,
              // prop, and player wins so props block shots as cover.
              let propT = Infinity;
              let propIdx = -1;
              for (let k = 0; k < this.props.length; k += 1) {
                const prop = this.props[k] as Prop;
                if (!prop.alive) {
                  continue;
                }
                const t = segmentAABB(
                  mx,
                  my,
                  ex,
                  ey,
                  prop.x,
                  prop.y,
                  prop.x + prop.w,
                  prop.y + prop.h,
                );
                if (t !== null && t < propT) {
                  propT = t;
                  propIdx = k;
                }
              }
              const wall = this.tileMap.raycast(mx, my, ex, ey);
              if (wall.hit && wall.t < bestT && wall.t < propT) {
                continue;
              }
              if (propIdx >= 0 && propT < bestT) {
                const prop = this.props[propIdx] as Prop;
                this.damageProp(prop, stat.damage, events, protectionAtStart);
                events.push("damage");
                continue;
              }
              if (bestIdx < 0) {
                continue;
              }
              const target = this.players[bestIdx] as Player;
              if (
                (protectionAtStart[bestIdx] ?? 0) > 0 ||
                (target.protectionTicks ?? 0) > 0
              ) {
                continue;
              }
              const hitY = my + (ey - my) * bestT;
              const isHead = hitY - target.y < HEADSHOT_BAND_PX;
              const damage = isHead ? Math.round(stat.damage * stat.headshotMult) : stat.damage;
              target.hp -= damage;
              target.ticksSinceDamage = 0;
              events.push("damage");
              if (target.hp <= 0) {
                target.hp = 0;
                target.alive = false;
                target.respawnTicks = RESPAWN_TICKS;
                events.push("kill");
                this.registerKill(player.id);
              }
            }
          } else if (stat.kind === "projectile") {
            const shooterH = player.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
            const mx = player.x + PLAYER_WIDTH / 2;
            const my = player.y + shooterH / 2;
            const spreadOffset = (this.rng.next() * 2 - 1) * stat.spread;
            const angle = player.aim + spreadOffset;
            const vx = Math.cos(angle) * ROCKET_SPEED_PX_S;
            const vy = Math.sin(angle) * ROCKET_SPEED_PX_S;
            const lifeTicks = Math.max(
              1,
              Math.ceil((stat.range / ROCKET_SPEED_PX_S) * TICK_HZ),
            );
            this.projectiles.push({
              id: this.nextProjectileId,
              kind: "rocket",
              x: mx,
              y: my,
              vx,
              vy,
              damage: stat.damage,
              ownerId: player.id,
              lifeTicks,
            });
            this.nextProjectileId += 1;
          }
        } else if (!player.reloading) {
          player.reloading = true;
          player.reloadTicks = stat.reload;
        }
      }
      const grenadePressed = grenadeIntent[i] === true;
      if (
        grenadePressed &&
        !player.reloading &&
        (player.grenadeCooldownTicks ?? 0) <= 0 &&
        (player.grenades ?? GRENADE_MAX) > 0
      ) {
        player.grenades = (player.grenades ?? GRENADE_MAX) - 1;
        player.grenadeCooldownTicks = GRENADE_COOLDOWN_TICKS;
        const h = player.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
        const gx = player.x + PLAYER_WIDTH / 2;
        const gy = player.y + h / 2;
        const dirX = Math.cos(player.aim);
        const dirY = Math.sin(player.aim);
        this.projectiles.push({
          id: this.nextProjectileId,
          kind: "grenade",
          x: gx,
          y: gy,
          vx: dirX * GRENADE_THROW_SPEED_PX_S + player.vx * 0.5,
          vy: dirY * GRENADE_THROW_SPEED_PX_S + player.vy * 0.5,
          damage: GRENADE_DAMAGE,
          ownerId: player.id,
          lifeTicks: GRENADE_FUSE_TICKS,
        });
        this.nextProjectileId += 1;
      }
    }
    this.tick += 1;
    if (!matchOverAtStart && this.matchOver) {
      events.push("matchEnd");
    }
    return events as string[];
  }

  /** Splash damage with falloff round(max*(1-0.5*d/radius)), min 1. */
  private explode(
    x: number,
    y: number,
    radius: number,
    maxDamage: number,
    ownerId: number,
    events: WorldEvent[],
    protectionAtStart: number[],
  ): void {
    const ownerIdx =
      ownerId >= 0 ? this.players.findIndex((p) => p.id === ownerId) : -1;
    events.push("explode");
    for (let j = 0; j < this.players.length; j += 1) {
      const victim = this.players[j] as Player;
      if (!victim.alive || victim.hp <= 0) {
        continue;
      }
      if ((protectionAtStart[j] ?? 0) > 0 || (victim.protectionTicks ?? 0) > 0) {
        continue;
      }
      const h = victim.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
      const cx = victim.x + PLAYER_WIDTH / 2;
      const cy = victim.y + h / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d > radius) {
        continue;
      }
      const damage = Math.max(1, Math.round(maxDamage * (1 - (0.5 * d) / radius)));
      victim.hp -= damage;
      victim.ticksSinceDamage = 0;
      events.push("damage");
      if (victim.hp <= 0) {
        victim.hp = 0;
        victim.alive = false;
        victim.respawnTicks = RESPAWN_TICKS;
        events.push("kill");
        if (ownerIdx >= 0 && victim.id !== ownerId) {
          this.registerKill(ownerId);
        }
      }
    }
    for (const prop of this.props) {
      if (!prop.alive) {
        continue;
      }
      const cx = prop.x + prop.w / 2;
      const cy = prop.y + prop.h / 2;
      const d = Math.hypot(cx - x, cy - y);
      if (d > radius) {
        continue;
      }
      const damage = Math.max(1, Math.round(maxDamage * (1 - (0.5 * d) / radius)));
      prop.hp -= damage;
      if (prop.hp <= 0) {
        prop.hp = 0;
        prop.alive = false;
        prop.respawnTicks =
          prop.kind === "barrel" ? BARREL_RESPAWN_TICKS : CRATE_RESPAWN_TICKS;
        if (prop.kind === "barrel") {
          this.explode(
            cx,
            cy,
            BARREL_EXPLODE_RADIUS_PX,
            BARREL_EXPLODE_DAMAGE,
            ownerId,
            events,
            protectionAtStart,
          );
        }
      }
    }
  }

  /**
   * Tick dead-prop respawn countdowns. Props at hp<=0 while alive are
   * sleepers (direct damage bypassed damageProp): mark them dead with
   * kind respawn ticks, mirroring the player hp<=0 sleeper idiom.
   */
  private tickProps(): void {
    for (const prop of this.props) {
      if (prop.alive && prop.hp <= 0) {
        prop.hp = 0;
        prop.alive = false;
        prop.respawnTicks =
          prop.kind === "barrel" ? BARREL_RESPAWN_TICKS : CRATE_RESPAWN_TICKS;
      }
      if (prop.alive) {
        continue;
      }
      if (prop.respawnTicks === undefined) {
        prop.respawnTicks = prop.kind === "barrel" ? BARREL_RESPAWN_TICKS : CRATE_RESPAWN_TICKS;
      }
      if (prop.respawnTicks > 0) {
        prop.respawnTicks -= 1;
      }
      if (prop.respawnTicks <= 0) {
        prop.alive = true;
        prop.hp = prop.kind === "barrel" ? BARREL_HP : CRATE_HP;
        prop.respawnTicks = 0;
      }
    }
  }

  /** Tick consumed-pickup respawn countdowns, reactivating at zero. */
  private tickPickups(): void {
    for (const pickup of this.pickups) {
      if (pickup.active) {
        continue;
      }
      if (pickup.respawnTicks > 0) {
        pickup.respawnTicks -= 1;
      }
      if (pickup.respawnTicks <= 0) {
        pickup.active = true;
        pickup.respawnTicks = 0;
      }
    }
  }

  /**
   * Collect overlapping pads in player order: center distance from the
   * player to the pad within PICKUP_RADIUS_PX. Weapon pads grant the
   * pad weapon with a full mag, health heals only below max, grenades
   * grant only below max; first player in order wins contested pads.
   */
  private collectPickups(events: WorldEvent[]): void {
    for (const player of this.players) {
      if (!player.alive || player.hp <= 0) {
        continue;
      }
      const stanceH = player.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
      const cx = player.x + PLAYER_WIDTH / 2;
      const cy = player.y + stanceH / 2;
      for (const pickup of this.pickups) {
        if (!pickup.active) {
          continue;
        }
        if (Math.hypot(cx - pickup.x, cy - pickup.y) > PICKUP_RADIUS_PX) {
          continue;
        }
        if (pickup.kind === "weapon") {
          const weapon = pickup.weapon ?? "rifle";
          player.weapon = weapon;
          player.magAmmo = (WEAPONS[weapon] ?? WEAPONS.rifle).mag;
          player.reloading = false;
          player.reloadTicks = 0;
          pickup.active = false;
          pickup.respawnTicks = WEAPON_RESPAWN_TICKS;
          events.push("pickup");
        } else if (pickup.kind === "health") {
          if (player.hp >= HEALTH_MAX) {
            continue;
          }
          player.hp = Math.min(HEALTH_MAX, player.hp + pickup.amount);
          pickup.active = false;
          pickup.respawnTicks = HEALTH_RESPAWN_TICKS;
          events.push("pickup");
        } else {
          const stocked = player.grenades ?? GRENADE_MAX;
          if (stocked >= GRENADE_MAX) {
            continue;
          }
          player.grenades = Math.min(GRENADE_MAX, stocked + pickup.amount);
          pickup.active = false;
          pickup.respawnTicks = GRENADE_PICKUP_RESPAWN_TICKS;
          events.push("pickup");
        }
      }
    }
  }

  /**
   * Push the player out of every overlapping live prop AABB along the
   * minimal-penetration axis, zeroing that velocity component and
   * grounding upward pushes. Array order keeps it deterministic.
   */
  private collideProps(player: Player, boxHeight: number): void {
    for (const prop of this.props) {
      if (!prop.alive) {
        continue;
      }
      const overlapX =
        Math.min(player.x + PLAYER_WIDTH, prop.x + prop.w) -
        Math.max(player.x, prop.x);
      const overlapY =
        Math.min(player.y + boxHeight, prop.y + prop.h) - Math.max(player.y, prop.y);
      if (overlapX <= 0 || overlapY <= 0) {
        continue;
      }
      if (overlapX < overlapY) {
        if (player.x + PLAYER_WIDTH / 2 < prop.x + prop.w / 2) {
          player.x -= overlapX;
        } else {
          player.x += overlapX;
        }
        player.vx = 0;
      } else if (player.y + boxHeight / 2 < prop.y + prop.h / 2) {
        player.y -= overlapY;
        if (player.vy > 0) {
          player.vy = 0;
        }
        player.onGround = true;
      } else {
        player.y += overlapY;
        if (player.vy < 0) {
          player.vy = 0;
        }
      }
    }
  }

  /** Integrate rockets linearly and grenades with gravity/bounce/fuse. */
  private stepProjectiles(
    dt: number,
    events: WorldEvent[],
    protectionAtStart: number[],
  ): void {
    for (let idx = this.projectiles.length - 1; idx >= 0; idx -= 1) {
      const p = this.projectiles[idx] as Projectile;
      if (p.kind === "rocket") {
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        let bestT = Infinity;
        for (let j = 0; j < this.players.length; j += 1) {
          const victim = this.players[j] as Player;
          if (victim.id === p.ownerId) {
            continue;
          }
          if (!victim.alive || victim.hp <= 0) {
            continue;
          }
          const h = victim.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
          const t = segmentAABB(
            p.x,
            p.y,
            nx,
            ny,
            victim.x,
            victim.y,
            victim.x + PLAYER_WIDTH,
            victim.y + h,
          );
          if (t !== null && t < bestT) {
            bestT = t;
          }
        }
        // Nearest live prop on the rocket segment; a prop hit explodes
        // the rocket at contact like a wall hit.
        let propT = Infinity;
        for (const prop of this.props) {
          if (!prop.alive) {
            continue;
          }
          const t = segmentAABB(
            p.x,
            p.y,
            nx,
            ny,
            prop.x,
            prop.y,
            prop.x + prop.w,
            prop.y + prop.h,
          );
          if (t !== null && t < propT) {
            propT = t;
          }
        }
        const wall = this.tileMap.raycast(p.x, p.y, nx, ny);
        if (bestT !== Infinity && (!wall.hit || bestT <= wall.t) && bestT <= propT) {
          const hx = p.x + (nx - p.x) * bestT;
          const hy = p.y + (ny - p.y) * bestT;
          this.projectiles.splice(idx, 1);
          const stat = WEAPONS.rocket;
          this.explode(
            hx,
            hy,
            stat.splashRadius ?? 150,
            stat.splashDamage ?? stat.damage,
            p.ownerId,
            events,
            protectionAtStart,
          );
          continue;
        }
        if (propT !== Infinity && (!wall.hit || propT <= wall.t)) {
          const hx = p.x + (nx - p.x) * propT;
          const hy = p.y + (ny - p.y) * propT;
          this.projectiles.splice(idx, 1);
          const stat = WEAPONS.rocket;
          this.explode(
            hx,
            hy,
            stat.splashRadius ?? 150,
            stat.splashDamage ?? stat.damage,
            p.ownerId,
            events,
            protectionAtStart,
          );
          continue;
        }
        if (wall.hit) {
          this.projectiles.splice(idx, 1);
          const stat = WEAPONS.rocket;
          this.explode(
            wall.x,
            wall.y,
            stat.splashRadius ?? 150,
            stat.splashDamage ?? stat.damage,
            p.ownerId,
            events,
            protectionAtStart,
          );
          continue;
        }
        p.x = nx;
        p.y = ny;
        p.lifeTicks -= 1;
        if (p.lifeTicks <= 0) {
          this.projectiles.splice(idx, 1);
          const stat = WEAPONS.rocket;
          this.explode(
            p.x,
            p.y,
            stat.splashRadius ?? 150,
            stat.splashDamage ?? stat.damage,
            p.ownerId,
            events,
            protectionAtStart,
          );
        }
      } else if (p.kind === "grenade") {
        const preVx = p.vx;
        const preVy = p.vy;
        p.vy += GRENADE_GRAVITY * dt;
        if (p.vy > MAX_FALL) {
          p.vy = MAX_FALL;
        }
        const dx = p.vx * dt;
        const dy = p.vy * dt;
        const hit = this.tileMap.collideBox(p.x - 2, p.y - 2, 4, 4, dx, dy);
        p.x = hit.x + 2;
        p.y = hit.y + 2;
        if (hit.hitX) {
          p.vx = -preVx * GRENADE_BOUNCE;
        }
        if (hit.hitY) {
          p.vy = -p.vy * GRENADE_BOUNCE;
          p.vx *= 0.8;
        }
        if (hit.collided) {
          const impact =
            (hit.hitX ? Math.abs(preVx) : 0) + (hit.hitY ? Math.abs(preVy) : 0);
          if (impact > 40) {
            events.push("bounce");
          }
        }
        p.lifeTicks -= 1;
        if (p.lifeTicks <= 0) {
          this.projectiles.splice(idx, 1);
          this.explode(
            p.x,
            p.y,
            GRENADE_RADIUS_PX,
            GRENADE_DAMAGE,
            p.ownerId,
            events,
            protectionAtStart,
          );
        }
      } else {
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        const wall = this.tileMap.raycast(p.x, p.y, nx, ny);
        if (wall.hit) {
          this.projectiles.splice(idx, 1);
          this.explode(p.x, p.y, 100, p.damage, p.ownerId, events, protectionAtStart);
          continue;
        }
        p.x = nx;
        p.y = ny;
        p.lifeTicks -= 1;
        if (p.lifeTicks <= 0) {
          this.projectiles.splice(idx, 1);
        }
      }
    }
  }

  /** Deterministic digest over tick plus every player's motion and combat state. */
  hash(): string {
    let text = `${this.seed}:${this.tick}:${this.marker}`;
    const hashScores = (this as { scores?: number[] }).scores ?? [];
    text += `:${this.mode ?? "ffa"},${this.scoreLimit ?? MATCH_SCORE_LIMIT},${this.timeLimitTicks ?? MATCH_TIME_LIMIT_TICKS}:${hashScores.join(",")}`;
    for (const player of this.players) {
      text += `:${player.x},${player.y},${player.vx},${player.vy},${player.fuel},${player.onGround ? 1 : 0},${player.hp},${player.alive ? 1 : 0},${player.magAmmo},${player.protectionTicks ?? 0},${player.respawnTicks},${player.grenades ?? GRENADE_MAX},${player.grenadeCooldownTicks ?? 0}`;
    }
    for (const p of this.projectiles) {
      text += `:${p.kind},${p.x},${p.y},${p.vx},${p.vy},${p.lifeTicks},${p.ownerId}`;
    }
    for (const prop of this.props) {
      text += `:${prop.kind},${prop.x},${prop.y},${prop.hp},${prop.alive ? 1 : 0},${prop.respawnTicks}`;
    }
    for (const pickup of this.pickups) {
      text += `:${pickup.kind},${pickup.x},${pickup.y},${pickup.weapon ?? ""},${pickup.amount},${pickup.active ? 1 : 0},${pickup.respawnTicks}`;
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}
