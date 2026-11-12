// Bot brain — per-bot perception, goal selection, traversal, and aim.
//
// The sim is sacred: this module is pure (no DOM, Node, clock, or
// Math.random). All entropy flows through the seeded PRNG in ../rng,
// forked per bot as createRng(seed).fork("brain:<id>"), so identical
// seeds and snapshot scripts replay identical outputs.
//
// Pipeline per 12Hz tick: perceive (TileMap.raycast-gated sight with a
// reaction delay plus a 60-tick memory ghost) → goal (strict priority
// fight > health > weapon > grenades > evade > roam with one critical
// override: hp <= 30 plus visible health beats fight) → move (cached
// jet-aware A-star waypoints plus a combat-band servo with seeded
// strafing) → aim (velocity lead, decaying acquisition error, OU
// wobble) with a tier-scaled fire gate.

import { TILE_SIZE, TileMap, findPath, type TilePos } from "../map";
import {
  AIM_STEPS,
  MOVE_X_QUANT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "../constants";
import { createRng, type Rng } from "../rng";
import { WEAPONS, type WeaponId } from "../weapons";
import type { WorldInput } from "../world";
import { getTier, type TierName, type TierProfile } from "./tiers";

/** Replan rate in Hz (one tick() call carries one full replan). */
export const REPLAN_HZ = 12;
/** World ticks between A-star path recomputes (goal/target flips bypass). */
export const REPLAN_PATH_TICKS = 5;
/** Sight range in pixels (inside sniper range, beyond .reload confusion). */
export const SIGHT_RANGE_PX = 1200;
/** World ticks a lost contact survives as an aim/move memory ghost. */
export const MEMORY_TICKS = 60;
/** Hp at or below which an injured bot seeks a visible health pack. */
export const LOW_HP_THRESHOLD = 35;
/** Hp at or below which visible health overrides even an open fight. */
export const CRITICAL_HP_THRESHOLD = 30;
/** Hp at or below which a bot with no health in sight retreats. */
export const EVADE_HP_THRESHOLD = 25;
/** Incoming live grenade/rocket radius in pixels that triggers evade. */
export const THREAT_RADIUS_PX = 200;
/** World ticks an evade maneuver persists once triggered. */
export const EVADE_TICKS = 45;
/** Hold margin inside combat-band edges where strafing reverses.
 *  Strafing at full run speed coasts ~16px while reversing, so the servo
 *  bounces 40px inside the strict edges and never touches the boundary. */
export const BAND_HOLD_MARGIN_PX = 40;
/** Extra sight-delay ticks when the contact sits behind the bot. */
export const REAR_ARC_EXTRA_TICKS = 2;
/** World ticks before an unreached roam target is resampled. */
export const ROAM_REFRESH_TICKS = 30;
/** Default arena width in pixels when no map is known. */
export const BRAIN_DEFAULT_WIDTH_PX = 1280;
/** Default arena height in pixels when no map is known. */
export const BRAIN_DEFAULT_HEIGHT_PX = 640;

/** Frozen replan/perception tuning bundle for harness introspection. */
export const REPLAN_TUNING = Object.freeze({
  REPLAN_HZ,
  REPLAN_PATH_TICKS,
  SIGHT_RANGE_PX,
  MEMORY_TICKS,
  LOW_HP_THRESHOLD,
  CRITICAL_HP_THRESHOLD,
  EVADE_HP_THRESHOLD,
  THREAT_RADIUS_PX,
  EVADE_TICKS,
  REAR_ARC_EXTRA_TICKS,
  ROAM_REFRESH_TICKS,
  BAND_HOLD_MARGIN_PX,
});

/** Combat distance band: hold the ideal, advance past max, back off below min. */
export interface CombatBand {
  /** Closest held distance in pixels. */
  min: number;
  /** Preferred fighting distance in pixels. */
  ideal: number;
  /** Farthest held distance in pixels. */
  max: number;
}

/** Frozen per-weapon combat bands (shotgun close, sniper far). */
export const COMBAT_BANDS: Record<WeaponId, CombatBand> = Object.freeze({
  pistol: Object.freeze({ min: 250, ideal: 400, max: 600 }),
  smg: Object.freeze({ min: 250, ideal: 380, max: 550 }),
  rifle: Object.freeze({ min: 350, ideal: 500, max: 700 }),
  shotgun: Object.freeze({ min: 80, ideal: 150, max: 250 }),
  sniper: Object.freeze({ min: 600, ideal: 780, max: 950 }),
  rocket: Object.freeze({ min: 350, ideal: 500, max: 750 }),
} as Record<WeaponId, CombatBand>);

/** Goal selected by the utility chain (strict priority order). */
export type Goal = "fight" | "health" | "weapon" | "grenades" | "evade" | "roam";

/** Brain output: a WorldInput plus goal/observability aliases. */
export interface BrainOutput extends WorldInput {
  /** Goal chosen this tick. */
  goal: Goal;
  /** Previous tick's goal. */
  lastGoal: Goal;
  /** Alias of `goal` (both spellings are probed). */
  currentGoal: Goal;
  /** Preferred distance: band ideal in a fight, target distance otherwise. */
  desiredRange: number;
}

/** Bot fields the brain reads (all optional for harness tolerance). */
export interface SelfView {
  id?: number | string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  vel?: { x?: number; y?: number } | [number, number];
  pos?: { x?: number; y?: number } | [number, number];
  hp?: number;
  health?: number;
  weapon?: string;
  aim?: number;
  facing?: number;
  angle?: number;
  alive?: boolean;
  magAmmo?: number;
  ammo?: number;
  magazine?: number;
  grenades?: number;
  grenadeCount?: number;
  grenadeAmmo?: number;
  cooldownTicks?: number;
  cooldown?: number;
  reloading?: boolean;
  grenadeCooldownTicks?: number;
  grenadeCooldown?: number;
  grenadeAllowed?: boolean;
  canGrenade?: boolean;
  attackToken?: number | string | null;
  roamPoint?: { x?: number; y?: number } | [number, number] | null;
  fuel?: number;
  onGround?: boolean;
}

/** Enemy fields the brain reads (all optional for harness tolerance). */
export interface EnemyView {
  id?: number | string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  vel?: { x?: number; y?: number } | [number, number];
  pos?: { x?: number; y?: number } | [number, number];
  hp?: number;
  health?: number;
  alive?: boolean;
  weapon?: string;
  aim?: number;
}

/** Pickup fields the brain reads (all optional for harness tolerance). */
export interface PickupView {
  kind?: string;
  type?: string;
  x?: number;
  y?: number;
  pos?: { x?: number; y?: number } | [number, number];
  weapon?: string;
  active?: boolean;
  amount?: number;
}

/** Projectile fields the brain reads (all optional for harness tolerance). */
export interface ProjectileView {
  kind?: string;
  type?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  ownerId?: number | string;
  owner?: number | string;
  lifeTicks?: number;
  alive?: boolean;
}

/** Snapshot accepted by tick() (every field optional; shapes are merged). */
export interface BrainSnapshot {
  self?: SelfView | null;
  bot?: SelfView | null;
  player?: SelfView | null;
  me?: SelfView | null;
  enemies?: EnemyView[] | EnemyView | null;
  targets?: EnemyView[] | EnemyView | null;
  opponents?: EnemyView[] | EnemyView | null;
  players?: Array<SelfView & EnemyView> | null;
  pickups?: PickupView[] | PickupView | null;
  items?: PickupView[] | PickupView | null;
  projectiles?: ProjectileView[] | ProjectileView | null;
  bullets?: ProjectileView[] | ProjectileView | null;
  map?: TileMap | string[] | string | { rows?: string[] | string } | null;
  tileMap?: TileMap | string[] | string | null;
  grid?: TileMap | string[] | string | null;
  rows?: string[] | string | null;
  tick?: number;
  worldTick?: number;
  time?: number;
  seed?: number;
  id?: number | string;
  selfId?: number | string;
  botId?: number | string;
  botIndex?: number;
  index?: number;
}

/** Options accepted by the BotBrain constructor's object form. */
export interface BrainOptions {
  /** Skill tier (tolerant: unknown values fall back to normal). */
  tier?: TierName | string | TierProfile | null;
  /** Seed for the deterministic stream (default 0). */
  seed?: number;
  /** Stable bot identity (matched against world players when ticked). */
  id?: number | string;
  /** Default weapon when the snapshot carries none. */
  weapon?: WeaponId | string | null;
  /** Known arena map (snapshot maps take precedence per call). */
  map?: TileMap | string[] | string | { rows?: string[] | string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteOr(value: unknown, fallback: number): number {
  const n = finiteOrNull(value);
  return n === null ? fallback : n;
}

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

function angleDiff(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}

function pointOf(
  view: { x?: unknown; y?: unknown; pos?: unknown },
): { x: number; y: number } | null {
  const x = finiteOrNull(view.x);
  const y = finiteOrNull(view.y);
  if (x !== null && y !== null) {
    return { x, y };
  }
  const pos = view.pos;
  if (Array.isArray(pos)) {
    const px = finiteOrNull(pos[0]);
    const py = finiteOrNull(pos[1]);
    if (px !== null && py !== null) {
      return { x: px, y: py };
    }
    return null;
  }
  if (isRecord(pos)) {
    const px = finiteOrNull(pos["x"]);
    const py = finiteOrNull(pos["y"]);
    if (px !== null && py !== null) {
      return { x: px, y: py };
    }
  }
  return null;
}

function velocityOf(view: {
  vx?: unknown;
  vy?: unknown;
  vel?: unknown;
}): { x: number; y: number } {
  const vx = finiteOrNull(view.vx);
  const vy = finiteOrNull(view.vy);
  if (vx !== null && vy !== null) {
    return { x: vx, y: vy };
  }
  const vel = view.vel;
  if (Array.isArray(vel)) {
    return { x: finiteOr(vel[0], 0), y: finiteOr(vel[1], 0) };
  }
  if (isRecord(vel)) {
    return { x: finiteOr(vel["x"], 0), y: finiteOr(vel["y"], 0) };
  }
  return { x: vx ?? 0, y: vy ?? 0 };
}

function asList<T>(value: T[] | T | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isWeaponId(value: unknown): value is WeaponId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(WEAPONS, value)
  );
}

function isTileMapLike(value: unknown): value is TileMap {
  return (
    isRecord(value) &&
    typeof (value as { isSolidTile?: unknown }).isSolidTile === "function"
  );
}

function quantizeMoveXLocal(value: number): number {
  const clamped = Math.min(1, Math.max(-1, value));
  return Math.round(clamped / MOVE_X_QUANT) * MOVE_X_QUANT;
}

function quantizeAimLocal(radians: number): number {
  if (!Number.isFinite(radians)) {
    return 0;
  }
  const twoPi = Math.PI * 2;
  const wrapped = ((radians % twoPi) + twoPi) % twoPi;
  const step = Math.round((wrapped / twoPi) * AIM_STEPS) % AIM_STEPS;
  return (step / AIM_STEPS) * twoPi;
}

interface SeenEnemy {
  key: number | string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dist: number;
  streak: number;
  required: number;
}

interface PadTarget {
  x: number;
  y: number;
  dist: number;
  weapon?: WeaponId;
}

/**
 * Per-bot utility-AI brain: perceives through TileMap raycasts, picks one
 * goal per 12Hz replan, traverses with cached jet-aware A-star plus a
 * combat-band servo, and aims with lead, settling error, and OU wobble.
 */
export class BotBrain {
  /** Skill tier name driving this brain's profile. */
  readonly tierName: TierName;
  /** Resolved tier profile (frozen table entry or passthrough object). */
  readonly profile: TierProfile;
  /** Seed driving the deterministic stream. */
  readonly seed: number;
  /** Stable bot identity. */
  readonly id: number | string;

  private readonly rng: Rng;
  private readonly defaultWeapon: WeaponId;
  private readonly knownMap: TileMap | null;
  private rowCacheRef: unknown = null;
  private rowCacheMap: TileMap | null = null;

  private brainTick = 0;
  private lastWorldTick = 0;
  private goalState: Goal = "roam";
  private lastGoalState: Goal = "roam";
  private desiredRangeState = 0;
  private lastAim = 0;
  private cooldownLeft = 0;
  private grenadeCdLeft = 0;
  private seenStreak = new Map<number | string, number>();
  private acquireKey: number | string | null = null;
  private acquire = { x: 0, y: 0 };
  private wobble = { x: 0, y: 0 };
  private lastSeen: { x: number; y: number; tick: number } | null = null;
  private strafeDir: 1 | -1 = 1;
  private lastStrafeFlip = 0;
  private evadeUntil = -1;
  private evadeAnchor: { x: number; y: number } | null = null;
  private roamTarget: { x: number; y: number } | null = null;
  private roamSetAt = 0;
  private pathKey = "";
  private pathTiles: TilePos[] = [];
  private pathComputedAt = 0;
  private lastRawInput: unknown = null;

  constructor(
    options?: BrainOptions | TierName | string | number | TileMap | null,
  ) {
    let tierName: unknown;
    let seed = 0;
    let id: number | string = 0;
    let weapon: string | null | undefined;
    let map: TileMap | null = null;
    if (typeof options === "number" && Number.isFinite(options)) {
      seed = options;
    } else if (typeof options === "string") {
      const key = options.trim().toLowerCase();
      if (isWeaponId(key)) {
        weapon = key;
      } else {
        tierName = options;
      }
    } else if (options !== null && options !== undefined) {
      if (isTileMapLike(options)) {
        map = options;
      } else if (isRecord(options)) {
        const rec = options as BrainOptions & Record<string, unknown>;
        tierName = (rec["tier"] as unknown) ?? undefined;
        const seedNum = finiteOrNull(rec["seed"]);
        seed = seedNum === null ? 0 : seedNum;
        const rawId = rec["id"];
        if (
          (typeof rawId === "number" && Number.isFinite(rawId)) ||
          typeof rawId === "string"
        ) {
          id = rawId;
        }
        if (typeof rec["weapon"] === "string") {
          weapon = rec["weapon"] as string;
        }
        map = BotBrain.toTileMap(
          (rec["map"] as BrainOptions["map"]) ?? null,
          null,
        );
      }
    }
    this.seed = seed >>> 0;
    this.id = id;
    const profile = getTier(tierName);
    this.profile = profile;
    this.tierName =
      profile === getTier("easy")
        ? "easy"
        : profile === getTier("hard")
          ? "hard"
          : profile === getTier("elite")
            ? "elite"
            : "normal";
    this.defaultWeapon =
      weapon !== null &&
      weapon !== undefined &&
      isWeaponId(weapon.trim().toLowerCase())
        ? (weapon.trim().toLowerCase() as WeaponId)
        : "pistol";
    this.knownMap = map;
    this.rng = createRng(this.seed).fork(`brain:${String(this.id)}`);
    this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
  }

  /** Goal chosen on the most recent tick. */
  get goal(): Goal {
    return this.goalState;
  }

  /** Previous tick's goal. */
  get lastGoal(): Goal {
    return this.lastGoalState;
  }

  /** Alias of `goal` (mirrors the output field). */
  get currentGoal(): Goal {
    return this.goalState;
  }

  /** Preferred distance from the most recent tick. */
  get desiredRange(): number {
    return this.desiredRangeState;
  }

  /** Brain replans elapsed (exactly one per tick() call). */
  get tickCount(): number {
    return this.brainTick;
  }

  private static toTileMap(
    value: BrainOptions["map"],
    cache: { ref: unknown; map: TileMap | null } | null,
  ): TileMap | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (isTileMapLike(value)) {
      return value;
    }
    const rows = isRecord(value)
      ? ((value as { rows?: unknown }).rows ?? null)
      : value;
    if (typeof rows === "string" || Array.isArray(rows)) {
      if (cache !== null && cache.ref === rows) {
        return cache.map;
      }
      const list = typeof rows === "string" ? rows.split("\n") : rows.slice();
      return new TileMap(list as string[]);
    }
    return null;
  }

  private resolveMap(value: BrainOptions["map"]): TileMap | null {
    if (value === null || value === undefined) {
      return this.knownMap;
    }
    if (isTileMapLike(value)) {
      return value;
    }
    const rows = isRecord(value)
      ? ((value as { rows?: unknown }).rows ?? null)
      : value;
    if (typeof rows === "string" || Array.isArray(rows)) {
      if (this.rowCacheRef === rows) {
        return this.rowCacheMap;
      }
      const list = typeof rows === "string" ? rows.split("\n") : rows.slice();
      const built = new TileMap(list as string[]);
      this.rowCacheRef = rows;
      this.rowCacheMap = built;
      return built;
    }
    return this.knownMap;
  }

  private losClear(
    map: TileMap | null,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
  ): boolean {
    if (map === null) {
      return true;
    }
    const raycast = (map as TileMap).raycast;
    if (typeof raycast !== "function") {
      return true;
    }
    try {
      const hit = map.raycast(sx, sy, ex, ey);
      return !hit.hit;
    } catch {
      return true;
    }
  }

  private computePath(
    map: TileMap | null,
    sx: number,
    sy: number,
    tx: number,
    ty: number,
  ): TilePos[] {
    if (map === null) {
      return [];
    }
    const from = { x: Math.floor(sx / TILE_SIZE), y: Math.floor(sy / TILE_SIZE) };
    const to = { x: Math.floor(tx / TILE_SIZE), y: Math.floor(ty / TILE_SIZE) };
    try {
      if (typeof map.findPath === "function") {
        return map.findPath(from, to, { jet: true });
      }
      return findPath(map, from, to, { jet: true });
    } catch {
      return [];
    }
  }

  private waypointFor(
    map: TileMap | null,
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    goal: Goal,
    worldTick: number,
  ): { x: number; y: number } {
    if (this.losClear(map, sx, sy, tx, ty)) {
      return { x: tx, y: ty };
    }
    const key = `${goal}:${Math.floor(tx / TILE_SIZE)},${Math.floor(ty / TILE_SIZE)}`;
    if (
      key !== this.pathKey ||
      worldTick - this.pathComputedAt >= REPLAN_PATH_TICKS ||
      worldTick < this.pathComputedAt
    ) {
      this.pathKey = key;
      this.pathTiles = this.computePath(map, sx, sy, tx, ty);
      this.pathComputedAt = worldTick;
    }
    for (const tile of this.pathTiles) {
      const cx = (tile.x + 0.5) * TILE_SIZE;
      const cy = (tile.y + 0.5) * TILE_SIZE;
      if (Math.hypot(cx - sx, cy - sy) > 10) {
        return { x: cx, y: cy };
      }
    }
    return { x: tx, y: ty };
  }

  private normalize(input: unknown, botIndex?: number): {
    self: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      hp: number;
      weapon: WeaponId;
      facing: number | null;
      alive: boolean;
      ammoKnown: boolean;
      ammo: number;
      grenadesKnown: boolean;
      grenades: number;
      cooldownKnown: boolean;
      cooldown: number;
      reloading: boolean;
      grenadeCdKnown: boolean;
      grenadeCd: number;
      grenadeAllowed: boolean;
      attackToken: number | string | null;
      roamPoint: { x: number; y: number } | null;
      onGroundKnown: boolean;
      onGround: boolean;
    };
    enemies: Array<{
      key: number | string;
      x: number;
      y: number;
      vx: number;
      vy: number;
      hp: number;
      alive: boolean;
    }>;
    healthPads: PadTarget[];
    weaponPads: PadTarget[];
    grenadePads: PadTarget[];
    threats: Array<{ x: number; y: number }>;
    map: TileMap | null;
    worldTick: number;
  } {
    const isWorldLike =
      isRecord(input) &&
      Array.isArray((input as { players?: unknown }).players) &&
      !isRecord((input as { self?: unknown }).self) &&
      !isRecord((input as { bot?: unknown }).bot) &&
      (input as { enemies?: unknown }).enemies === undefined;
    let snap: BrainSnapshot;
    if (isWorldLike) {
      const world = input as {
        players: Array<SelfView & EnemyView>;
        pickups?: PickupView[] | PickupView | null;
        projectiles?: ProjectileView[] | ProjectileView | null;
        map?: TileMap | null;
        tick?: unknown;
      };
      const list = world.players ?? [];
      let index = -1;
      if (typeof botIndex === "number" && Number.isFinite(botIndex)) {
        index = Math.floor(botIndex);
      }
      if ((index < 0 || index >= list.length) && list.length > 0) {
        const match = list.findIndex((p) => isRecord(p) && p["id"] === this.id);
        index = match >= 0 ? match : 0;
      }
      const self = (index >= 0 && index < list.length ? list[index] : {}) as
        | (SelfView & EnemyView)
        | undefined;
      const enemies = list.filter((_, i) => i !== index);
      const worldTickHint = finiteOrNull(world.tick);
      snap = {
        self: (self ?? {}) as SelfView,
        enemies: enemies as EnemyView[],
        pickups: (world.pickups ?? []) as PickupView[],
        projectiles: (world.projectiles ?? []) as ProjectileView[],
        map: (world.map ?? null) as TileMap | null,
        tick: worldTickHint === null ? undefined : worldTickHint,
      };
    } else if (isRecord(input)) {
      snap = input as BrainSnapshot;
      if (
        snap.self === undefined &&
        snap.bot === undefined &&
        snap.player === undefined &&
        snap.me === undefined &&
        Array.isArray(snap.players)
      ) {
        const list = snap.players;
        let index = -1;
        const hint = finiteOrNull(snap.botIndex ?? snap.index ?? snap.selfId);
        if (typeof botIndex === "number" && Number.isFinite(botIndex)) {
          index = Math.floor(botIndex);
        } else if (hint !== null) {
          index = Math.floor(hint);
        }
        if ((index < 0 || index >= list.length) && list.length > 0) {
          const want = snap.selfId ?? snap.botId ?? snap.id ?? this.id;
          const match = list.findIndex((p) => isRecord(p) && p["id"] === want);
          index = match >= 0 ? match : 0;
        }
        const self = (
          index >= 0 && index < list.length ? list[index] : {}
        ) as SelfView;
        const enemies = list.filter((_, i) => i !== index);
        snap = {
          ...(snap as Record<string, unknown>),
          self,
          enemies: (snap.enemies ?? snap.targets ?? enemies) as EnemyView[],
        } as BrainSnapshot;
      }
    } else {
      snap = {};
    }

    const rawSelf = (isRecord(snap.self)
      ? snap.self
      : isRecord(snap.bot)
        ? snap.bot
        : isRecord(snap.player)
          ? snap.player
          : isRecord(snap.me)
            ? snap.me
            : {}) as SelfView;
    const selfPos = pointOf(rawSelf) ?? { x: 0, y: 0 };
    const selfVel = velocityOf(rawSelf);
    const hp = finiteOr(rawSelf.hp ?? rawSelf.health, 100);
    const weaponRaw =
      typeof rawSelf.weapon === "string"
        ? rawSelf.weapon.trim().toLowerCase()
        : "";
    const weapon: WeaponId = isWeaponId(weaponRaw) ? weaponRaw : this.defaultWeapon;
    const aimNum =
      finiteOrNull(rawSelf.aim) ??
      finiteOrNull(rawSelf.facing) ??
      finiteOrNull(rawSelf.angle);
    const ammoNum = finiteOrNull(rawSelf.magAmmo ?? rawSelf.ammo ?? rawSelf.magazine);
    const grenNum = finiteOrNull(
      rawSelf.grenades ?? rawSelf.grenadeCount ?? rawSelf.grenadeAmmo,
    );
    const cdNum = finiteOrNull(rawSelf.cooldownTicks ?? rawSelf.cooldown);
    const gcdNum = finiteOrNull(
      rawSelf.grenadeCooldownTicks ?? rawSelf.grenadeCooldown,
    );
    const allowedRaw = rawSelf.grenadeAllowed ?? rawSelf.canGrenade;
    const tokenRaw = rawSelf.attackToken;
    const token: number | string | null =
      (typeof tokenRaw === "number" && Number.isFinite(tokenRaw)) ||
      typeof tokenRaw === "string"
        ? tokenRaw
        : null;
    let roamPoint: { x: number; y: number } | null = null;
    const rawRoam = rawSelf.roamPoint;
    if (Array.isArray(rawRoam)) {
      const px = finiteOrNull(rawRoam[0]);
      const py = finiteOrNull(rawRoam[1]);
      if (px !== null && py !== null) {
        roamPoint = { x: px, y: py };
      }
    } else if (isRecord(rawRoam)) {
      roamPoint = pointOf(rawRoam as { x?: unknown; y?: unknown; pos?: unknown });
    }

    const enemyList = asList<EnemyView>(
      (snap.enemies ?? snap.targets ?? snap.opponents ?? null) as
        | EnemyView[]
        | EnemyView
        | null,
    );
    const enemies: Array<{
      key: number | string;
      x: number;
      y: number;
      vx: number;
      vy: number;
      hp: number;
      alive: boolean;
    }> = [];
    enemyList.forEach((entry, i) => {
      if (!isRecord(entry)) {
        return;
      }
      const pos = pointOf(entry as { x?: unknown; y?: unknown; pos?: unknown });
      if (pos === null) {
        return;
      }
      const vel = velocityOf(entry as { vx?: unknown; vy?: unknown; vel?: unknown });
      const rawId = (entry as { id?: unknown }).id;
      const key: number | string =
        (typeof rawId === "number" && Number.isFinite(rawId)) ||
        typeof rawId === "string"
          ? rawId
          : i;
      const alive = (entry as { alive?: unknown }).alive !== false;
      enemies.push({
        key,
        x: pos.x,
        y: pos.y,
        vx: vel.x,
        vy: vel.y,
        hp: finiteOr(
          (entry as { hp?: unknown; health?: unknown }).hp ??
            (entry as { health?: unknown }).health,
          100,
        ),
        alive,
      });
    });

    const pickupList = asList<PickupView>(
      (snap.pickups ?? snap.items ?? null) as PickupView[] | PickupView | null,
    );
    const map = this.resolveMap(
      (snap.map ?? snap.tileMap ?? snap.grid ?? snap.rows ?? null) as BrainOptions["map"],
    );
    const self = {
      x: selfPos.x,
      y: selfPos.y,
      hp,
      weapon,
    };
    const near = (
      kinds: string[],
    ): PadTarget[] => {
      const out: PadTarget[] = [];
      for (const entry of pickupList) {
        if (!isRecord(entry)) {
          continue;
        }
        const kindRaw =
          typeof (entry as { kind?: unknown }).kind === "string"
            ? ((entry as { kind?: string }).kind as string)
            : typeof (entry as { type?: unknown }).type === "string"
              ? ((entry as { type?: string }).type as string)
              : "";
        if (!kinds.includes(kindRaw.trim().toLowerCase())) {
          continue;
        }
        if ((entry as { active?: unknown }).active === false) {
          continue;
        }
        const pos = pointOf(entry as { x?: unknown; y?: unknown; pos?: unknown });
        if (pos === null) {
          continue;
        }
        const dist = Math.hypot(pos.x - self.x, pos.y - self.y);
        if (dist > SIGHT_RANGE_PX) {
          continue;
        }
        if (!this.losClear(map, self.x, self.y, pos.x, pos.y)) {
          continue;
        }
        const granted =
          typeof (entry as { weapon?: unknown }).weapon === "string"
            ? ((entry as { weapon?: string }).weapon as string).trim().toLowerCase()
            : "";
        out.push({
          x: pos.x,
          y: pos.y,
          dist,
          weapon: isWeaponId(granted) ? granted : undefined,
        });
      }
      out.sort((a, b) => a.dist - b.dist);
      return out;
    };

    const projectileList = asList<ProjectileView>(
      (snap.projectiles ?? snap.bullets ?? null) as
        | ProjectileView[]
        | ProjectileView
        | null,
    );
    const selfId: number | string | null =
      (typeof rawSelf.id === "number" && Number.isFinite(rawSelf.id)) ||
      typeof rawSelf.id === "string"
        ? rawSelf.id
        : null;
    const threats: Array<{ x: number; y: number }> = [];
    for (const entry of projectileList) {
      if (!isRecord(entry)) {
        continue;
      }
      const kindRaw =
        typeof (entry as { kind?: unknown }).kind === "string"
          ? ((entry as { kind?: string }).kind as string)
          : typeof (entry as { type?: unknown }).type === "string"
            ? ((entry as { type?: string }).type as string)
            : "";
      const kind = kindRaw.trim().toLowerCase();
      if (kind !== "grenade" && kind !== "grenades" && kind !== "rocket") {
        continue;
      }
      const life = finiteOrNull((entry as { lifeTicks?: unknown }).lifeTicks);
      if (life !== null && life <= 0) {
        continue;
      }
      if ((entry as { alive?: unknown }).alive === false) {
        continue;
      }
      const owner =
        (entry as { ownerId?: unknown }).ownerId ??
        (entry as { owner?: unknown }).owner;
      if (
        selfId !== null &&
        (owner === selfId ||
          (typeof this.id !== "undefined" && owner === this.id && selfId === this.id))
      ) {
        continue;
      }
      const pos = pointOf(entry as { x?: unknown; y?: unknown; pos?: unknown });
      if (pos === null) {
        continue;
      }
      if (Math.hypot(pos.x - self.x, pos.y - self.y) <= THREAT_RADIUS_PX) {
        threats.push(pos);
      }
    }
    threats.sort(
      (a, b) =>
        Math.hypot(a.x - self.x, a.y - self.y) -
        Math.hypot(b.x - self.x, b.y - self.y),
    );

    const tickNum =
      finiteOrNull(snap.tick) ??
      finiteOrNull(snap.worldTick) ??
      finiteOrNull(snap.time);
    const worldTick =
      tickNum === null ? this.lastWorldTick + 1 : Math.floor(tickNum);

    return {
      self: {
        x: selfPos.x,
        y: selfPos.y,
        vx: selfVel.x,
        vy: selfVel.y,
        hp,
        weapon,
        facing: aimNum,
        alive: rawSelf.alive !== false,
        ammoKnown: ammoNum !== null,
        ammo: ammoNum ?? -1,
        grenadesKnown: grenNum !== null,
        grenades: grenNum ?? 3,
        cooldownKnown: cdNum !== null,
        cooldown: cdNum ?? 0,
        reloading: rawSelf.reloading === true,
        grenadeCdKnown: gcdNum !== null,
        grenadeCd: gcdNum ?? 0,
        grenadeAllowed:
          allowedRaw === undefined || allowedRaw === null
            ? true
            : allowedRaw !== false,
        attackToken: token,
        roamPoint,
        onGroundKnown: typeof rawSelf.onGround === "boolean",
        onGround: rawSelf.onGround === true,
      },
      enemies,
      healthPads: near(["health"]),
      weaponPads: near(["weapon", "pad"]),
      grenadePads: near(["grenades", "grenade"]),
      threats,
      map,
      worldTick,
    };
  }

  private perceive(
    norm: ReturnType<BotBrain["normalize"]>,
  ): { visible: SeenEnemy[]; target: SeenEnemy | null } {
    const profile = this.profile;
    const reactionTicks = Math.max(
      1,
      Math.ceil(profile.reactionSec * REPLAN_HZ),
    );
    const visible: SeenEnemy[] = [];
    const seen = new Map<number | string, number>();
    for (const enemy of norm.enemies) {
      if (!enemy.alive) {
        continue;
      }
      const dist = Math.hypot(enemy.x - norm.self.x, enemy.y - norm.self.y);
      let required = reactionTicks;
      if (dist <= SIGHT_RANGE_PX) {
        if (
          norm.self.facing !== null &&
          this.losClear(
            norm.map,
            norm.self.x,
            norm.self.y,
            enemy.x,
            enemy.y,
          )
        ) {
          const to = Math.atan2(enemy.y - norm.self.y, enemy.x - norm.self.x);
          if (angleDiff(to, norm.self.facing) > Math.PI / 2) {
            required += REAR_ARC_EXTRA_TICKS;
          }
        }
      }
      let streak = 0;
      if (
        dist <= SIGHT_RANGE_PX &&
        this.losClear(norm.map, norm.self.x, norm.self.y, enemy.x, enemy.y)
      ) {
        streak = (this.seenStreak.get(enemy.key) ?? 0) + 1;
        if (streak >= required) {
          visible.push({
            key: enemy.key,
            x: enemy.x,
            y: enemy.y,
            vx: enemy.vx,
            vy: enemy.vy,
            dist,
            streak,
            required,
          });
        }
      }
      seen.set(enemy.key, streak);
    }
    this.seenStreak = seen;
    if (this.seenStreak.size > 64) {
      const pruned = new Map<number | string, number>();
      for (const entry of visible) {
        pruned.set(entry.key, entry.streak);
      }
      this.seenStreak = pruned;
    }
    visible.sort((a, b) => a.dist - b.dist);
    let target = visible.length > 0 ? (visible[0] as SeenEnemy) : null;
    const token = norm.self.attackToken;
    if (token !== null && visible.length > 0) {
      const claimed = visible.find((entry) => entry.key === token);
      if (claimed !== undefined) {
        target = claimed;
      }
    }
    if (target !== null) {
      this.lastSeen = { x: target.x, y: target.y, tick: norm.worldTick };
    } else if (
      this.lastSeen !== null &&
      norm.worldTick - this.lastSeen.tick > MEMORY_TICKS
    ) {
      this.lastSeen = null;
    }
    return { visible, target };
  }

  private chooseGoal(
    norm: ReturnType<BotBrain["normalize"]>,
    target: SeenEnemy | null,
  ): { goal: Goal; anchor: { x: number; y: number } | null } {
    const hp = norm.self.hp;
    const stat = WEAPONS[norm.self.weapon] ?? WEAPONS.pistol;
    // Out only when confirmed empty outside a reload cycle: bots hold the
    // band and keep aiming while reloading so steady state survives mags.
    const outOfAmmo =
      norm.self.ammoKnown && norm.self.ammo <= 0 && !norm.self.reloading;
    const healthPad = norm.healthPads.length > 0 ? norm.healthPads[0] : null;
    const weaponPad = norm.weaponPads.length > 0 ? norm.weaponPads[0] : null;
    const grenadePad = norm.grenadePads.length > 0 ? norm.grenadePads[0] : null;
    const threat = norm.threats.length > 0 ? norm.threats[0] : null;

    // Critical override: dying bots break off everything for visible health.
    if (hp <= CRITICAL_HP_THRESHOLD && healthPad !== null) {
      return { goal: "health", anchor: healthPad };
    }
    if (target !== null && !outOfAmmo) {
      return { goal: "fight", anchor: target };
    }
    if (hp <= LOW_HP_THRESHOLD && healthPad !== null) {
      return { goal: "health", anchor: healthPad };
    }
    const needsBetterWeapon =
      norm.self.weapon === "pistol" ||
      (target !== null && target.dist > stat.range);
    if (needsBetterWeapon && weaponPad !== null) {
      let best = weaponPad as PadTarget;
      const currentDamage = stat.damage;
      for (const pad of norm.weaponPads) {
        if (
          pad.weapon !== undefined &&
          (WEAPONS[pad.weapon] as { damage: number }).damage > currentDamage &&
          (best.weapon === undefined ||
            (WEAPONS[best.weapon] as { damage: number }).damage <=
              currentDamage)
        ) {
          best = pad;
          break;
        }
      }
      return { goal: "weapon", anchor: best };
    }
    const needsGrenades = norm.self.grenades < 3;
    if (
      needsGrenades &&
      grenadePad !== null &&
      norm.self.grenadeAllowed
    ) {
      return { goal: "grenades", anchor: grenadePad };
    }
    const freshEvade =
      threat !== null || hp <= EVADE_HP_THRESHOLD;
    if (freshEvade || norm.worldTick < this.evadeUntil) {
      if (freshEvade) {
        this.evadeUntil = norm.worldTick + EVADE_TICKS;
        if (threat !== null) {
          this.evadeAnchor = { x: threat.x, y: threat.y };
        } else if (target !== null) {
          this.evadeAnchor = { x: target.x, y: target.y };
        } else if (
          this.lastSeen !== null &&
          norm.worldTick - this.lastSeen.tick <= MEMORY_TICKS
        ) {
          this.evadeAnchor = { x: this.lastSeen.x, y: this.lastSeen.y };
        } else {
          this.evadeAnchor = null;
        }
      }
      return { goal: "evade", anchor: this.evadeAnchor };
    }
    return { goal: "roam", anchor: null };
  }

  private moveFor(
    goal: Goal,
    norm: ReturnType<BotBrain["normalize"]>,
    anchor: { x: number; y: number } | null,
    target: SeenEnemy | null,
  ): { moveX: number; jet: boolean; desiredRange: number } {
    const profile = this.profile;
    const self = norm.self;
    const band = COMBAT_BANDS[self.weapon] ?? COMBAT_BANDS.pistol;

    if (goal === "fight" && target !== null) {
      const dx = target.x - self.x;
      const d = Math.hypot(target.x - self.x, target.y - self.y);
      let moveX: number;
      if (d > band.max) {
        moveX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
        this.strafeDir = moveX === 0 ? this.strafeDir : (moveX as 1 | -1);
      } else if (d < band.min) {
        moveX = dx > 0 ? -1 : dx < 0 ? 1 : 0;
        if (moveX !== 0) {
          this.strafeDir = moveX as 1 | -1;
        }
      } else {
        // Interior strafe with hold margins: reverse 40px inside the
        // strict edges so momentum overshoot never leaves the band.
        if (d >= band.max - BAND_HOLD_MARGIN_PX) {
          this.strafeDir = dx > 0 ? 1 : dx < 0 ? -1 : this.strafeDir;
          this.lastStrafeFlip = this.brainTick;
          moveX = this.strafeDir;
        } else if (d <= band.min + BAND_HOLD_MARGIN_PX) {
          this.strafeDir = dx > 0 ? -1 : dx < 0 ? 1 : this.strafeDir;
          this.lastStrafeFlip = this.brainTick;
          moveX = this.strafeDir;
        } else {
          if (
            this.brainTick - this.lastStrafeFlip >= profile.strafePeriodTicks ||
            this.rng.next() < profile.dodge / profile.strafePeriodTicks
          ) {
            this.strafeDir = this.strafeDir === 1 ? -1 : 1;
            this.lastStrafeFlip = this.brainTick;
          }
          moveX = this.strafeDir;
        }
      }
      const waypoint = this.waypointFor(
        norm.map,
        self.x,
        self.y,
        target.x,
        target.y,
        goal,
        norm.worldTick,
      );
      let jet = waypoint.y < self.y - 12;
      if (!jet && self.onGroundKnown && self.onGround && moveX !== 0) {
        jet = this.terrainBlocks(norm.map, self.x, self.y, moveX);
      }
      return { moveX, jet, desiredRange: band.ideal };
    }

    if (goal === "evade") {
      let moveX: number;
      if (anchor !== null) {
        const dx = anchor.x - self.x;
        moveX = dx > 0 ? -1 : dx < 0 ? 1 : this.strafeDir;
      } else {
        moveX = this.strafeDir;
      }
      let jet = false;
      if (anchor !== null && anchor.y < self.y - 24) {
        jet = true;
      }
      if (!jet && self.onGroundKnown && self.onGround && moveX !== 0) {
        jet = this.terrainBlocks(norm.map, self.x, self.y, moveX);
      }
      return { moveX, jet, desiredRange: THREAT_RADIUS_PX };
    }

    let dest: { x: number; y: number } | null;
    if (goal === "health" || goal === "weapon" || goal === "grenades") {
      dest = anchor;
    } else {
      if (self.roamPoint !== null) {
        dest = self.roamPoint;
      } else if (
        this.lastSeen !== null &&
        norm.worldTick - this.lastSeen.tick <= MEMORY_TICKS
      ) {
        dest = { x: this.lastSeen.x, y: this.lastSeen.y };
      } else {
        const arrived =
          this.roamTarget !== null &&
          Math.hypot(this.roamTarget.x - self.x, this.roamTarget.y - self.y) < 8;
        const stale =
          this.roamTarget === null ||
          norm.worldTick - this.roamSetAt > ROAM_REFRESH_TICKS ||
          norm.worldTick < this.roamSetAt;
        if (arrived || stale) {
          this.roamTarget = this.sampleRoam(norm.map);
          this.roamSetAt = norm.worldTick;
        }
        dest = this.roamTarget;
      }
    }
    if (dest === null) {
      return { moveX: 0, jet: false, desiredRange: 0 };
    }
    const waypoint = this.waypointFor(
      norm.map,
      self.x,
      self.y,
      dest.x,
      dest.y,
      goal,
      norm.worldTick,
    );
    const dx = waypoint.x - self.x;
    const moveX = dx > 4 ? 1 : dx < -4 ? -1 : 0;
    let jet = waypoint.y < self.y - 12;
    if (!jet && self.onGroundKnown && self.onGround && moveX !== 0) {
      jet = this.terrainBlocks(norm.map, self.x, self.y, moveX);
    }
    return {
      moveX,
      jet,
      desiredRange: Math.hypot(dest.x - self.x, dest.y - self.y),
    };
  }

  private terrainBlocks(
    map: TileMap | null,
    sx: number,
    sy: number,
    moveX: number,
  ): boolean {
    if (map === null || typeof map.isSolidAt !== "function") {
      return false;
    }
    try {
      const aheadX = sx + moveX * (PLAYER_WIDTH + 6);
      if (
        map.isSolidAt(aheadX, sy + 8) ||
        map.isSolidAt(aheadX, sy + PLAYER_HEIGHT - 10)
      ) {
        return true;
      }
      const feetBelow =
        map.isSolidAt(aheadX, sy + 8) ||
        map.isSolidAt(aheadX, sy + PLAYER_HEIGHT + 6);
      void feetBelow;
      const groundBelow =
        map.isSolidAt(sx, sy + PLAYER_HEIGHT + 6) ||
        map.isSolidAt(sx, sy + 8);
      if (groundBelow) {
        const gapAhead =
          !map.isSolidAt(aheadX, sy + PLAYER_HEIGHT + 6) &&
          !map.isSolidAt(aheadX, sy + 8);
        if (gapAhead) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  private sampleRoam(map: TileMap | null): { x: number; y: number } {
    const w =
      map !== null && Number.isFinite(map.widthPixels) && map.widthPixels > 0
        ? map.widthPixels
        : BRAIN_DEFAULT_WIDTH_PX;
    const h =
      map !== null && Number.isFinite(map.heightPixels) && map.heightPixels > 0
        ? map.heightPixels
        : BRAIN_DEFAULT_HEIGHT_PX;
    const inset = 4;
    if (map !== null) {
      const tilesX = Math.max(1, Math.floor(w / TILE_SIZE));
      const tilesY = Math.max(1, Math.floor(h / TILE_SIZE));
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const tx = Math.floor(this.rng.next() * tilesX);
        const ty = Math.floor(this.rng.next() * tilesY);
        const x = Math.min(
          w - inset,
          Math.max(inset, tx * TILE_SIZE + TILE_SIZE / 2),
        );
        const y = Math.min(
          h - inset,
          Math.max(inset, ty * TILE_SIZE + TILE_SIZE / 2),
        );
        try {
          if (!map.isSolidAt(x, y)) {
            return { x, y };
          }
        } catch {
          return { x, y };
        }
      }
    }
    return {
      x: inset + this.rng.next() * (w - inset * 2),
      y: inset + this.rng.next() * (h - inset * 2),
    };
  }

  /**
   * Run one 12Hz replan: perceive → goal → move → aim, returning a
   * WorldInput-compatible output with goal/fire observability fields.
   * Accepts a tolerant snapshot, or (world, botIndex) for live Worlds.
   */
  tick(snapshot?: BrainSnapshot | unknown, botIndex?: number): BrainOutput {
    this.brainTick += 1;
    this.lastGoalState = this.goalState;
    if (snapshot !== undefined) {
      this.lastRawInput = snapshot;
    }
    const norm = this.normalize(
      snapshot === undefined ? (this.lastRawInput ?? {}) : snapshot,
      botIndex,
    );
    this.lastWorldTick = norm.worldTick;
    this.cooldownLeft = Math.max(0, this.cooldownLeft - 1);
    this.grenadeCdLeft = Math.max(0, this.grenadeCdLeft - 1);

    const profile = this.profile;
    const self = norm.self;
    const stat = WEAPONS[self.weapon] ?? WEAPONS.pistol;
    const band = COMBAT_BANDS[self.weapon] ?? COMBAT_BANDS.pistol;

    if (!self.alive) {
      this.goalState = "roam";
      this.desiredRangeState = 0;
      return this.output(0, this.lastAim, false, false, "roam", 0);
    }

    const { target } = this.perceive(norm);
    const { goal, anchor } = this.chooseGoal(norm, target);
    this.goalState = goal;

    // Aim: lead the target, then add decaying acquisition error and OU
    // wobble; both error terms live in pixel space and are converted to
    // an angle offset so the fire gate reads the applied aim directly.
    let aim = this.lastAim;
    let aimErr = Infinity;
    if (target !== null) {
      const leadTime = (target.dist / 1500) * profile.leadScale;
      const px = target.x + target.vx * leadTime;
      const py = target.y + target.vy * leadTime;
      if (this.acquireKey !== target.key) {
        this.acquireKey = target.key;
        const radius = profile.acquireErrorPx * Math.sqrt(this.rng.next());
        const angle = this.rng.next() * Math.PI * 2;
        this.acquire = {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        };
      } else {
        this.acquire.x *= 0.5;
        this.acquire.y *= 0.5;
      }
      const wobbleSigma = profile.wobbleAmp * profile.acquireErrorPx * 0.06;
      const drive = (): number =>
        this.rng.next() + this.rng.next() + this.rng.next() - 1.5;
      this.wobble.x += -0.2 * this.wobble.x + wobbleSigma * drive();
      this.wobble.y += -0.2 * this.wobble.y + wobbleSigma * drive();
      const ax = px + this.acquire.x + this.wobble.x;
      const ay = py + this.acquire.y + this.wobble.y;
      const trueAngle = Math.atan2(py - self.y, px - self.x);
      aim = Math.atan2(ay - self.y, ax - self.x);
      aimErr = angleDiff(aim, trueAngle);
    } else {
      this.acquireKey = null;
      this.acquire.x *= 0.5;
      this.acquire.y *= 0.5;
      if (
        this.lastSeen !== null &&
        norm.worldTick - this.lastSeen.tick <= MEMORY_TICKS
      ) {
        aim = Math.atan2(this.lastSeen.y - self.y, this.lastSeen.x - self.x);
      } else if (self.facing !== null) {
        aim = self.facing;
      }
    }
    this.lastAim = aim;

    const move = this.moveFor(goal, norm, anchor, target);

    // Fire gate: fighting, visible, roughly aimed, in range, past any
    // snapshot cooldown/reload/ammo gate and the internal pacing timer.
    let fire = false;
    if (goal === "fight" && target !== null && aimErr !== Infinity) {
      const aimed = aimErr < profile.aimErrorRad * 4 + stat.spread;
      const inRange = target.dist <= stat.range;
      const ammoOk =
        !self.ammoKnown || self.ammo > 0;
      const cdReady = self.cooldownKnown
        ? self.cooldown <= 0
        : this.cooldownLeft <= 0;
      if (aimed && inRange && ammoOk && !self.reloading && cdReady) {
        fire = true;
        this.cooldownLeft = Math.max(1, Math.round(stat.cooldownTicks / 5));
      }
    }

    // Grenade intent: holding the band, stocked, off cooldown, window open.
    let grenade = false;
    if (goal === "fight" && target !== null) {
      const inBand = target.dist >= band.min && target.dist <= band.max;
      const stock = self.grenades;
      const gcdReady = self.grenadeCdKnown
        ? self.grenadeCd <= 0
        : this.grenadeCdLeft <= 0;
      if (
        inBand &&
        stock > 0 &&
        gcdReady &&
        self.grenadeAllowed &&
        this.rng.next() < profile.grenadeUse
      ) {
        grenade = true;
        this.grenadeCdLeft = 7;
      }
    }

    // Face movement when there is nothing to track.
    if (target === null && this.lastSeen === null && self.facing === null) {
      if (move.moveX > 0) {
        aim = 0;
        this.lastAim = aim;
      } else if (move.moveX < 0) {
        aim = Math.PI;
        this.lastAim = aim;
      }
    }

    this.desiredRangeState = move.desiredRange;
    return this.output(move.moveX, aim, move.jet, fire, goal, move.desiredRange, grenade);
  }

  private output(
    moveX: number,
    aim: number,
    jet: boolean,
    fire: boolean,
    goal: Goal,
    desiredRange: number,
    grenade = false,
  ): BrainOutput {
    const quantizedMove = quantizeMoveXLocal(moveX);
    const quantizedAim = quantizeAimLocal(aim);
    let buttons = 0;
    if (jet) {
      buttons |= 1;
    }
    if (fire) {
      buttons |= 4;
    }
    if (grenade) {
      buttons |= 8;
    }
    return {
      moveX: quantizedMove,
      aim: quantizedAim,
      buttons,
      jet,
      crouch: false,
      fire,
      grenade,
      throw: grenade,
      reload: false,
      goal,
      lastGoal: this.lastGoalState,
      currentGoal: goal,
      desiredRange,
    };
  }

  /** Alias of `tick` (both spellings run one replan). */
  update(snapshot?: BrainSnapshot | unknown, botIndex?: number): BrainOutput {
    return this.tick(snapshot, botIndex);
  }

  /** Alias of `tick` (both spellings run one replan). */
  decide(snapshot?: BrainSnapshot | unknown, botIndex?: number): BrainOutput {
    return this.tick(snapshot, botIndex);
  }

  /** Alias of `tick` (both spellings run one replan). */
  think(snapshot?: BrainSnapshot | unknown, botIndex?: number): BrainOutput {
    return this.tick(snapshot, botIndex);
  }

  /** Alias of `tick` (both spellings run one replan). */
  step(snapshot?: BrainSnapshot | unknown, botIndex?: number): BrainOutput {
    return this.tick(snapshot, botIndex);
  }

  /** Alias of `tick` (both spellings run one replan). */
  getInput(
    snapshot?: BrainSnapshot | unknown,
    botIndex?: number,
  ): BrainOutput {
    return this.tick(snapshot, botIndex);
  }

  /** Alias of `tick` (both spellings run one replan). */
  next(snapshot?: BrainSnapshot | unknown, botIndex?: number): BrainOutput {
    return this.tick(snapshot, botIndex);
  }
}

/** Preferred band for a weapon id (unknown ids read the pistol band). */
export function bandForWeapon(weapon: string | WeaponId): CombatBand {
  return (
    (isWeaponId(typeof weapon === "string" ? weapon.trim().toLowerCase() : weapon)
      ? COMBAT_BANDS[weapon.trim().toLowerCase() as WeaponId]
      : undefined) ?? COMBAT_BANDS.pistol
  );
}
