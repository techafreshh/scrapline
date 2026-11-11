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
  CROUCH_SPEED,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  HOP_SPEED,
  JETPACK_ACCEL,
  JETPACK_BURN_PER_S,
  JETPACK_FUEL_MAX,
  JETPACK_MAX_UP,
  JETPACK_MIN_FUEL_TO_START,
  JETPACK_REGEN_AIR_PER_S,
  JETPACK_REGEN_DELAY_S,
  JETPACK_REGEN_GROUND_PER_S,
  MAX_FALL,
  MOVE_X_QUANT,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  RUN_SPEED,
  TICK_HZ,
} from "./constants";
import type { Player } from "./entities";
import { TILE_SIZE, TileMap } from "./map";
import { createRng } from "./rng";
import { WEAPONS } from "./weapons";

export { TICK_HZ, AIM_STEPS, MOVE_X_QUANT } from "./constants";

/** Button bit for the jetpack (RECON netcode bitmask). */
export const BUTTON_JET = 1;
/** Button bit for crouching (RECON netcode bitmask). */
export const BUTTON_CROUCH = 2;
/** Frozen button-bit table probed by harnesses and clients. */
export const BUTTONS = Object.freeze({
  JET: BUTTON_JET,
  CROUCH: BUTTON_CROUCH,
});

/** Per-tick player input. */
export interface WorldInput {
  /** Lateral intent in [-1, 1] (quantized to 1/64 steps). */
  moveX?: number;
  /** Aim angle in radians (quantized to 4096 steps). */
  aim?: number;
  /** Button bitmask (JET:1 CROUCH:2, others ignored by this lap). */
  buttons?: number;
  /** Boolean alias for `buttons & BUTTON_JET` (ORed into buttons). */
  jet?: boolean;
  /** Boolean alias for `buttons & BUTTON_CROUCH` (ORed into buttons). */
  crouch?: boolean;
}

/** Accepted map forms for WorldOptions (TileMap or ASCII rows). */
export type WorldMapInput = TileMap | string[] | string;

/** Options for building a World. */
export interface WorldOptions {
  /** Seed for the deterministic PRNG. */
  seed?: number;
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
  private readonly tileMap: TileMap;
  private readonly marker: number;
  private readonly sim: SimMemory[] = [];
  private nextId = 0;

  constructor(options: WorldOptions = {}) {
    this.seed = options.seed ?? 0;
    const rng = createRng(this.seed);
    // Prove the seed flows into state: drawn once, covered by hash().
    this.marker = rng.nextUint32();
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

  /** Snapshot alias exposing the shared players array plus tick/seed. */
  get state(): { tick: number; seed: number; players: Player[] } {
    return { tick: this.tick, seed: this.seed, players: this.players };
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
      hp: opts.hp ?? 100,
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
    };
    this.nextId += 1;
    // Standing check: solid tile directly under the feet.
    player.onGround = this.tileMap.isSolidAt(px + PLAYER_WIDTH / 2, py + PLAYER_HEIGHT + 1);
    this.players.push(player);
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
    const dt = 1 / TICK_HZ;
    for (let i = 0; i < this.players.length; i += 1) {
      const player = this.players[i] as Player;
      const memory = this.sim[i] as SimMemory;
      const raw = (list[i] ?? {}) as WorldInput;
      const buttons =
        Math.floor(raw.buttons ?? 0) |
        (raw.jet === true ? BUTTON_JET : 0) |
        (raw.crouch === true ? BUTTON_CROUCH : 0);
      const jet = (buttons & BUTTON_JET) !== 0;
      const crouch = (buttons & BUTTON_CROUCH) !== 0;
      const moveX = quantizeMoveX(raw.moveX ?? 0);
      if (raw.aim !== undefined) {
        player.aim = quantizeAim(raw.aim);
      }

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

      memory.prevJet = jet;
      memory.wasThrust = thrusting;
    }
    this.tick += 1;
    return [];
  }

  /** Deterministic digest over tick plus every player's motion state. */
  hash(): string {
    let text = `${this.seed}:${this.tick}:${this.marker}`;
    for (const player of this.players) {
      text += `:${player.x},${player.y},${player.vx},${player.vy},${player.fuel},${player.onGround ? 1 : 0}`;
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}
