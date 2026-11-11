// Bot director — match-level coordination: roam points, attack tokens, and
// grenade permission windows.
//
// The sim is sacred: this module is pure (no DOM, Node, clock, or
// Math.random). All entropy flows through the seeded PRNG in ../rng.

import { TILE_SIZE, type TileMap } from "../map";
import { createRng, type Rng } from "../rng";

/** Maximum bots allowed to hold an attack token for the same victim. */
export const MAX_ATTACKERS_PER_VICTIM = 2;
/** Ticks each grenade permission window stays open. */
export const GRENADE_WINDOW_TICKS = 30;
/** Grenade permission cycle length in ticks. */
export const GRENADE_PERIOD_TICKS = 120;
/** Tick stagger between consecutive bots' grenade windows. */
export const GRENADE_STAGGER_TICKS = 37;
/** Ticks after which an unreached roam point is resampled. */
export const ROAM_REFRESH_TICKS = 30;
/** Default arena width in pixels (40 tiles, matching World's default rows). */
export const DIRECTOR_DEFAULT_WIDTH_PX = 1280;
/** Default arena height in pixels (20 tiles, matching World's default rows). */
export const DIRECTOR_DEFAULT_HEIGHT_PX = 640;

/** Frozen tuning table for harnesses that read config as one object. */
export const DIRECTOR_TUNING = Object.freeze({
  MAX_ATTACKERS_PER_VICTIM,
  GRENADE_WINDOW_TICKS,
  GRENADE_PERIOD_TICKS,
  GRENADE_STAGGER_TICKS,
  ROAM_REFRESH_TICKS,
  DEFAULT_WIDTH_PX: DIRECTOR_DEFAULT_WIDTH_PX,
  DEFAULT_HEIGHT_PX: DIRECTOR_DEFAULT_HEIGHT_PX,
});

/** Pixel roam target assigned to a bot. */
export interface RoamPoint {
  /** Pixel x, at least 4px inside the arena. */
  x: number;
  /** Pixel y, at least 4px inside the arena. */
  y: number;
}

/** Bot fields the director reads and writes (all optional for tolerance). */
export interface BotView {
  /** Stable bot identity (falls back to array index when absent). */
  id?: number | string;
  /** Pixel x (used for victim distance and roam arrival). */
  x?: number;
  /** Pixel y (used for victim distance and roam arrival). */
  y?: number;
  /** Bots with `alive === false` never receive attack tokens. */
  alive?: boolean;
  /** Victim id this bot may attack, or null when unassigned. */
  attackToken?: number | string | null;
  /** Current roam target (never null after `assignTargets`). */
  roamPoint?: RoamPoint | null;
  /** True while this bot's grenade permission window is open. */
  grenadeAllowed?: boolean;
  /** Alias of `grenadeAllowed` (both spellings are kept in sync). */
  canGrenade?: boolean;
}

/** Victim fields the director reads (all optional for tolerance). */
export interface VictimView {
  /** Stable victim identity (falls back to array index when absent). */
  id?: number | string;
  /** Pixel x (used for victim distance when present). */
  x?: number;
  /** Pixel y (used for victim distance when present). */
  y?: number;
  /** Victims with `alive === false` are skipped while any live victim exists. */
  alive?: boolean;
}

/** Options accepted by the Director constructor's object form. */
export interface DirectorOptions {
  /** Seed for the deterministic stream (default 0). */
  seed?: number;
  /** Tile map for bounds and free-tile sampling (beats pixel options). */
  map?: TileMap | null;
  /** Arena width in pixels (used when no map is known). */
  widthPixels?: number;
  /** Arena height in pixels (used when no map is known). */
  heightPixels?: number;
}

/** Stable bot/victim identity used for tokens and window staggering. */
export type BotKey = number | string;

/** Minimal tile-map surface the director samples (duck-typed). */
interface MapLike {
  readonly widthPixels?: unknown;
  readonly widthTiles?: unknown;
  readonly width?: unknown;
  readonly heightPixels?: unknown;
  readonly heightTiles?: unknown;
  readonly height?: unknown;
  isSolidTile(tx: number, ty: number): boolean;
  isSolidAt?(px: number, py: number): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMapLike(value: unknown): value is MapLike {
  return (
    isRecord(value) &&
    typeof (value as { isSolidTile?: unknown }).isSolidTile === "function"
  );
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveOrNull(value: unknown): number | null {
  const n = finiteOrNull(value);
  return n !== null && n > 0 ? n : null;
}

function botKeyOf(bot: BotView, index: number): BotKey {
  if (typeof bot.id === "number" && Number.isFinite(bot.id)) {
    return bot.id;
  }
  if (typeof bot.id === "string") {
    return bot.id;
  }
  return index;
}

function victimKeyOf(victim: VictimView, index: number): BotKey {
  if (typeof victim.id === "number" && Number.isFinite(victim.id)) {
    return victim.id;
  }
  if (typeof victim.id === "string") {
    return victim.id;
  }
  return index;
}

function compareKeys(a: BotKey, b: BotKey): number {
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) {
    return -1;
  }
  return sa > sb ? 1 : 0;
}

function coordsOf(view: { x?: unknown; y?: unknown }): RoamPoint | null {
  if (
    typeof view.x === "number" &&
    typeof view.y === "number" &&
    Number.isFinite(view.x) &&
    Number.isFinite(view.y)
  ) {
    return { x: view.x, y: view.y };
  }
  return null;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function mapPixelSize(map: MapLike): { w: number; h: number } | null {
  const wTiles = positiveOrNull(map.widthTiles);
  const hTiles = positiveOrNull(map.heightTiles);
  const w =
    positiveOrNull(map.widthPixels) ??
    (wTiles !== null ? wTiles * TILE_SIZE : positiveOrNull(map.width));
  const h =
    positiveOrNull(map.heightPixels) ??
    (hTiles !== null ? hTiles * TILE_SIZE : positiveOrNull(map.height));
  if (w === null || h === null) {
    return null;
  }
  return { w, h };
}

/**
 * Match-level bot coordinator: assigns roam targets, caps simultaneous
 * attackers per victim via attack tokens, and gates grenades behind
 * rotating permission windows.
 *
 * The director owns no players: every `assignTargets` call mutates the
 * passed bots in place, advances one internal tick, and stays fully
 * deterministic for a given seed and input sequence.
 */
export class Director {
  /** Seed driving the deterministic stream. */
  readonly seed: number;
  private readonly rng: Rng;
  private readonly arenaMap: MapLike | null;
  private readonly optionWidth: number | null;
  private readonly optionHeight: number | null;
  private currentTick = 0;
  private lastTick = 0;
  private orderKeys: BotKey[] = [];
  private readonly refKeys = new Map<object, BotKey>();
  private readonly roamAssignedAt = new Map<BotKey, number>();

  constructor(options?: DirectorOptions | TileMap | number) {
    let seed = 0;
    let map: MapLike | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (typeof options === "number" && Number.isFinite(options)) {
      seed = options;
    } else if (isMapLike(options)) {
      map = options;
    } else if (isRecord(options)) {
      const rec = options as Record<string, unknown>;
      if (typeof rec["seed"] === "number" && Number.isFinite(rec["seed"])) {
        seed = rec["seed"] as number;
      }
      if (isMapLike(rec["map"])) {
        map = rec["map"] as MapLike;
      }
      width = positiveOrNull(rec["widthPixels"]) ?? positiveOrNull(rec["width"]);
      height =
        positiveOrNull(rec["heightPixels"]) ?? positiveOrNull(rec["height"]);
    }
    this.seed = seed >>> 0;
    this.rng = createRng(this.seed);
    this.arenaMap = map;
    this.optionWidth = width;
    this.optionHeight = height;
  }

  /** Ticks elapsed (exactly one per `assignTargets`/`update` call). */
  get tick(): number {
    return this.currentTick;
  }

  /**
   * Coordinate one tick: cap attackers per victim (nearest-first over
   * id-sorted bots), refresh roam points, and set grenade windows.
   * Mutates `bots` in place. `mapOrTick` optionally overrides the map
   * for this call (TileMap-like) or pins the window clock (tick number).
   */
  assignTargets(
    bots: BotView[],
    players: VictimView[],
    mapOrTick?: TileMap | number,
  ): void {
    this.currentTick += 1;
    let callMap: MapLike | null = null;
    let tick = this.currentTick;
    if (isMapLike(mapOrTick)) {
      callMap = mapOrTick;
    } else if (
      isRecord(mapOrTick) &&
      isMapLike((mapOrTick as Record<string, unknown>)["map"])
    ) {
      callMap = (mapOrTick as Record<string, unknown>)["map"] as MapLike;
    } else if (typeof mapOrTick === "number" && Number.isFinite(mapOrTick)) {
      tick = Math.floor(mapOrTick);
    }
    this.lastTick = tick;
    const map = callMap ?? this.arenaMap;
    const bounds = this.resolveBounds(map);
    const botList = Array.isArray(bots) ? bots : [];
    const playerList = Array.isArray(players) ? players : [];

    const all = playerList
      .map((view, i) => ({ view, key: victimKeyOf(view, i), pos: coordsOf(view) }))
      .filter((entry) => isRecord(entry.view));
    const live = all.filter((entry) => entry.view.alive !== false);
    const victims = live.length > 0 ? live : all;

    const entries = botList
      .map((bot, i) => ({ bot, key: botKeyOf(bot, i), pos: coordsOf(bot) }))
      .filter((entry) => isRecord(entry.bot));
    entries.sort((a, b) => compareKeys(a.key, b.key));

    // Attack tokens: id-sorted bots greedily take their nearest victim
    // with a free slot; dead bots and short pools leave nulls behind.
    const attackers = new Map<BotKey, number>();
    for (const entry of entries) {
      this.refKeys.set(entry.bot, entry.key);
      if (entry.bot.alive === false) {
        entry.bot.attackToken = null;
        continue;
      }
      const ranked = victims
        .filter((v) => v.key !== entry.key)
        .map((v) => ({
          key: v.key,
          dist:
            entry.pos !== null && v.pos !== null
              ? (entry.pos.x - v.pos.x) ** 2 + (entry.pos.y - v.pos.y) ** 2
              : Infinity,
        }))
        .sort((a, b) => a.dist - b.dist || compareKeys(a.key, b.key));
      let token: BotKey | null = null;
      for (const candidate of ranked) {
        if ((attackers.get(candidate.key) ?? 0) < MAX_ATTACKERS_PER_VICTIM) {
          token = candidate.key;
          break;
        }
      }
      entry.bot.attackToken = token;
      if (token !== null) {
        attackers.set(token, (attackers.get(token) ?? 0) + 1);
      }
    }

    // Roam points: keep valid ones, resample null/out-of-bounds/solid/
    // reached/stale points so no bot ever leaves without a target.
    for (const entry of entries) {
      const current = entry.bot.roamPoint;
      let keep =
        current !== null &&
        current !== undefined &&
        typeof current.x === "number" &&
        Number.isFinite(current.x) &&
        typeof current.y === "number" &&
        Number.isFinite(current.y) &&
        current.x >= 0 &&
        current.x < bounds.w &&
        current.y >= 0 &&
        current.y < bounds.h &&
        !this.isSolidPoint(map, current) &&
        !this.hasReached(entry.pos, current);
      if (keep) {
        const assignedAt = this.roamAssignedAt.get(entry.key);
        if (assignedAt === undefined) {
          this.roamAssignedAt.set(entry.key, tick);
        } else if (tick - assignedAt >= ROAM_REFRESH_TICKS) {
          keep = false;
        }
      }
      if (!keep) {
        entry.bot.roamPoint = this.sampleRoam(map, bounds.w, bounds.h);
        this.roamAssignedAt.set(entry.key, tick);
      }
    }

    // Grenade windows: staggered time-division over the sorted squad.
    this.orderKeys = entries.map((entry) => entry.key);
    entries.forEach((entry, index) => {
      const open = Director.windowOpen(index, tick);
      entry.bot.grenadeAllowed = open;
      entry.bot.canGrenade = open;
    });
  }

  /** Alias of `assignTargets` (both spellings advance exactly one tick). */
  update(
    bots: BotView[],
    players: VictimView[],
    mapOrTick?: TileMap | number,
  ): void {
    this.assignTargets(bots, players, mapOrTick);
  }

  /**
   * True while the bot's grenade window is open at `tick` (defaults to
   * the most recent assignment tick). Accepts a bot object or a raw id.
   */
  canThrowGrenade(botOrId: BotView | BotKey, tick?: number): boolean {
    const at =
      typeof tick === "number" && Number.isFinite(tick)
        ? Math.floor(tick)
        : this.lastTick;
    return Director.windowOpen(this.staggerIndexFor(this.queryKeyOf(botOrId)), at);
  }

  /** Alias of `canThrowGrenade` (both spellings read the same window). */
  isGrenadeAllowed(botOrId: BotView | BotKey, tick?: number): boolean {
    return this.canThrowGrenade(botOrId, tick);
  }

  private static windowOpen(staggerIndex: number, tick: number): boolean {
    return (
      mod(tick + staggerIndex * GRENADE_STAGGER_TICKS, GRENADE_PERIOD_TICKS) <
      GRENADE_WINDOW_TICKS
    );
  }

  private resolveBounds(map: MapLike | null): { w: number; h: number } {
    const fromMap = map !== null ? mapPixelSize(map) : null;
    const w = Math.max(
      16,
      Math.floor(fromMap?.w ?? this.optionWidth ?? DIRECTOR_DEFAULT_WIDTH_PX),
    );
    const h = Math.max(
      16,
      Math.floor(fromMap?.h ?? this.optionHeight ?? DIRECTOR_DEFAULT_HEIGHT_PX),
    );
    return { w, h };
  }

  private isSolidPoint(map: MapLike | null, point: RoamPoint): boolean {
    if (map === null) {
      return false;
    }
    if (typeof map.isSolidAt === "function") {
      return map.isSolidAt(point.x, point.y);
    }
    return map.isSolidTile(
      Math.floor(point.x / TILE_SIZE),
      Math.floor(point.y / TILE_SIZE),
    );
  }

  private hasReached(botPos: RoamPoint | null, roam: RoamPoint): boolean {
    if (botPos === null) {
      return false;
    }
    const dx = botPos.x - roam.x;
    const dy = botPos.y - roam.y;
    return dx * dx + dy * dy <= 64;
  }

  private sampleRoam(map: MapLike | null, w: number, h: number): RoamPoint {
    const inset = 4;
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
      if (map !== null && this.isSolidPoint(map, { x, y })) {
        continue;
      }
      return { x, y };
    }
    return {
      x: inset + this.rng.next() * (w - inset * 2),
      y: inset + this.rng.next() * (h - inset * 2),
    };
  }

  private queryKeyOf(botOrId: BotView | BotKey): BotKey {
    if (typeof botOrId === "number" && Number.isFinite(botOrId)) {
      return botOrId;
    }
    if (typeof botOrId === "string") {
      return botOrId;
    }
    if (isRecord(botOrId)) {
      const view = botOrId as BotView;
      if (typeof view.id === "number" && Number.isFinite(view.id)) {
        return view.id;
      }
      if (typeof view.id === "string") {
        return view.id;
      }
      const known = this.refKeys.get(botOrId);
      if (known !== undefined) {
        return known;
      }
    }
    return 0;
  }

  private staggerIndexFor(key: BotKey): number {
    const index = this.orderKeys.indexOf(key);
    if (index >= 0) {
      return index;
    }
    if (typeof key === "number") {
      return Math.abs(Math.floor(key));
    }
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }
}
