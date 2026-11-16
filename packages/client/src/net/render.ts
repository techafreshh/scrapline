// Remote rendering path (issue #217): full soldier system + server roster
// nametags, identical killfeed/events, and leave banners for honest-mode
// snapshots. Pure helpers plus one thin DOM binder: onlineStateFor shapes
// interpolated rows into a renderer StateLike with real pose fields (so
// describeFrame selects run/jet/crouch/dead soldier frames, never a flat
// fallback), renderOnlineSnapshot paints through the live renderer, and
// reconciles nametags/killfeed/toast from the server roster. DOM-free
// except for the handle types it receives; unit-testable under node.

import { TILE_SIZE } from "../../../core/src/map";
import {
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "../../../core/src/constants";
import {
  cameraTarget,
  createCamera,
  updateCamera,
  type Camera,
} from "../renderer/camera";
import { renderOnlineScoreboard, type OnlineScores } from "../hud/hud";
import { buildFeedEntry, pushFeed, type FeedHandles } from "../ui/feed";
import {
  updateNametags,
  type NametagsFrame,
  type NametagsHandles,
} from "../ui/nametags";
import { leaveBannerFor, type RosterEntry } from "./roster";
import { showToast, type ToastHandles } from "../ui/toast";
import type { InterpPlayer } from "./interpolation";

/** Default arena tiles (mirrors the renderer's fallback arena). */
const DEFAULT_ARENA_TILES_W = 40;
/** Default arena tiles (mirrors the renderer's fallback arena). */
const DEFAULT_ARENA_TILES_H = 20;

/** One kill drained from a snapshot event row (server shape). */
export interface OnlineKillEvent {
  /** Killer player id (null for unattributed deaths). */
  killer: number | null;
  /** Victim player id. */
  victim: number;
  /** Killer display name (null for unattributed deaths). */
  killerName: string | null;
  /** Victim display name. */
  victimName: string;
  /** Killing weapon id (null when unattributed). */
  weapon: string | null;
}

/** One departed remote (immediate leave frame or roster shrink). */
export interface OnlineLeaveEvent {
  /** Departed player id. */
  id: number;
  /** Departed display name (may be empty when unknown). */
  name: string;
}

/** Minimal renderer surface the online loop paints through. */
export interface OnlineRenderer {
  draw(state: unknown, map?: unknown, camera?: unknown, ...rest: unknown[]): void;
}

/**
 * Shape interpolated rows as a renderer StateLike with full soldier
 * pose fields: alive/onGround/crouching/jetting/protection plus fuel
 * and derived velocities, so the renderer picks the same run/jet/
 * crouch/dead frames it picks offline. Entity streams stay empty (the
 * honest path renders remotes only; the offline sim owns the rest).
 */
export function onlineStateFor(rows: readonly InterpPlayer[], tick: number): {
  tick: number;
  players: Record<string, unknown>[];
  projectiles: never[];
  pickups: never[];
  props: never[];
} {
  return {
    tick,
    players: rows.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      aim: p.aim,
      hp: p.hp,
      weapon: p.weapon,
      alive: p.alive ?? true,
      onGround: p.onGround ?? true,
      crouching: p.crouching ?? false,
      jetting: p.jetting ?? false,
      protectionTicks: p.protected === true ? 90 : 0,
      fuel: p.fuel ?? 100,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      hurtAt: null,
      magAmmo: 12,
      reloading: false,
      respawnTicks: 0,
      grenades: 3,
      grenadeCooldownTicks: 0,
      cooldownTicks: 0,
      reloadTicks: 0,
      ticksSinceDamage: 9999,
      spawnX: p.x,
      spawnY: p.y,
    })),
    projectiles: [],
    pickups: [],
    props: [],
  };
}

/** Fresh follow camera for an online session (default-arena clamped). */
export function createOnlineCamera(): Camera {
  return createCamera(
    DEFAULT_ARENA_TILES_W * TILE_SIZE,
    DEFAULT_ARENA_TILES_H * TILE_SIZE,
  );
}

/**
 * Ease the online camera toward the local row plus aim look-ahead (the
 * offline updateCameraFromLocal idiom, arena-clamped, dt defaulting to
 * one 60 Hz step). No-ops without a local row or camera.
 */
export function followOnlineLocal(
  camera: Camera | null | undefined,
  local: InterpPlayer | null | undefined,
): void {
  if (camera === null || camera === undefined || local === undefined || local === null) {
    return;
  }
  try {
    const height = local.crouching === true ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
    const target = cameraTarget(
      local.x + PLAYER_WIDTH / 2,
      local.y + height / 2,
      Number.isFinite(local.aim) ? local.aim : 0,
    );
    updateCamera(
      camera,
      target.x,
      target.y,
      DEFAULT_ARENA_TILES_W * TILE_SIZE,
      DEFAULT_ARENA_TILES_H * TILE_SIZE,
    );
  } catch {
    // Camera follow best-effort: the draw below still paints.
  }
}

/** Read a trimmed string value off a fake-doc input element. */
function inputValue(doc: unknown, id: string): string {
  try {
    const target = doc as { getElementById?: unknown };
    if (typeof target.getElementById !== "function") {
      return "";
    }
    const el = (target.getElementById as (id: string) => unknown).call(doc, id) as {
      value?: unknown;
    } | null;
    if (el !== null && typeof el === "object" && typeof el.value === "string") {
      return el.value.trim();
    }
  } catch {
    // Missing/unreadable input: the next source stands.
  }
  return "";
}

/**
 * Resolve the display name to hello with: explicit getter, explicit
 * value, the profile input, then `?name=` in the URL. Probes use
 * whichever surface they drive; all readings trim (16-char cap applied
 * by the roster normalizer downstream).
 */
export function resolveOnlineName(
  doc: unknown,
  deps: { getName?: () => string; name?: string } = {},
): string {
  try {
    if (typeof deps.getName === "function") {
      const live = deps.getName();
      if (typeof live === "string" && live.trim().length > 0) {
        return live.trim();
      }
    }
  } catch {
    // Live name unreadable: the static value stands.
  }
  if (typeof deps.name === "string" && deps.name.trim().length > 0) {
    return deps.name.trim();
  }
  const fromInput = inputValue(doc, "profile-name");
  if (fromInput.length > 0) {
    return fromInput;
  }
  try {
    const loc = (globalThis as unknown as { location?: unknown }).location as
      | { search?: unknown }
      | undefined;
    if (typeof loc?.search === "string" && loc.search.length > 1) {
      const raw = new URLSearchParams(loc.search).get("name");
      if (raw !== null && raw.trim().length > 0) {
        return raw.trim();
      }
    }
  } catch {
    // No location surface: the empty fallback stands.
  }
  return "";
}

/** Everything renderOnlineSnapshot needs for one painted frame. */
export interface OnlineRenderFrame {
  /** Live renderer (null paints nothing). */
  renderer: OnlineRenderer | null;
  /** Interpolated rows at the delayed render time. */
  rows: readonly InterpPlayer[];
  /** Server tick for the shaped state. */
  tick: number;
  /** Server roster (drives every remote nametag). */
  roster: readonly RosterEntry[];
  /** Kill rows drained since the last frame (identical offline shape). */
  kills: readonly OnlineKillEvent[];
  /** Departures drained since the last frame (banner each). */
  leaves: readonly OnlineLeaveEvent[];
  /** Nametag overlay handles (null skips nametags). */
  nametags: NametagsHandles | null;
  /** Killfeed handles (null skips killfeed). */
  feed: FeedHandles | null;
  /** Toast handles (null skips leave banners). */
  toast: ToastHandles | null;
  /** Session follow camera (null skips camera + nametag projection). */
  camera: Camera | null;
  /** Canvas backing-store width in px (nametag projection). */
  canvasW: number;
  /** Canvas backing-store height in px (nametag projection). */
  canvasH: number;
  /** Local player id (camera follows it; defaults to the first row). */
  localId?: number | null;
  /** Nametag visibility (mirrors the offline show-name-tags setting). */
  showNametags?: boolean;
  /** HUD score node (null skips the online scoreboard). */
  scoreEl?: { textContent: string | null } | null;
  /** Kills by pid (drives the pid-ordered online scoreboard). */
  scores?: OnlineScores;
  /** Local-name fallback for the scoreboard when the roster is silent. */
  localName?: string | null;
}

/**
 * Paint one online frame through the full soldier renderer and
 * reconcile the overlays: the same camera follows the local row for
 * both the draw and the nametag projection (so tags sit above their
 * soldiers), kills push through the shared feed entry shape (online
 * text equals offline `Killer ▸ Victim` by construction), and each
 * leave shows the `Player left` banner. Missing handles are no-ops;
 * renderer faults never throw into the session loop.
 */
export function renderOnlineSnapshot(frame: OnlineRenderFrame): {
  state: ReturnType<typeof onlineStateFor>;
} {
  const rows = Array.isArray(frame.rows) ? frame.rows : [];
  const roster = Array.isArray(frame.roster) ? frame.roster : [];
  const state = onlineStateFor(rows, frame.tick);
  const local =
    (typeof frame.localId === "number"
      ? rows.find((p) => p.id === frame.localId)
      : undefined) ?? rows[0];
  followOnlineLocal(frame.camera ?? null, local ?? null);
  try {
    frame.renderer?.draw(state, undefined, frame.camera ?? undefined);
  } catch {
    // Renderer faults never kill the session; the next frame retries.
  }
  const camera = frame.camera ?? null;
  if (
    frame.nametags !== null &&
    frame.nametags !== undefined &&
    camera !== null
  ) {
    try {
      const overlay: NametagsFrame = {
        players: rows.map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          alive: p.alive ?? true,
          crouching: p.crouching ?? false,
        })),
        camera,
        canvasW: frame.canvasW,
        canvasH: frame.canvasH,
        show: frame.showNametags ?? true,
        names: roster.map((row) => ({ id: row.id, name: row.name })),
      };
      updateNametags(frame.nametags, overlay);
    } catch {
      // Overlay faults never kill the session.
    }
  }
  if (frame.feed !== null && frame.feed !== undefined) {
    for (const kill of frame.kills ?? []) {
      try {
        if (
          kill === null ||
          typeof kill !== "object" ||
          typeof kill.victim !== "number"
        ) {
          continue;
        }
        const foundKillerIdx =
          kill.killer === null || kill.killer === undefined
            ? -1
            : rows.findIndex((p) => p.id === kill.killer);
        const killerIdx = foundKillerIdx >= 0 ? foundKillerIdx : null;
        const victimIdx = rows.findIndex((p) => p.id === kill.victim);
        const killerName =
          typeof kill.killerName === "string" && kill.killerName.length > 0
            ? kill.killerName
            : kill.killer === null || kill.killer === undefined
              ? null
              : `Player${kill.killer}`;
        const victimName =
          typeof kill.victimName === "string" && kill.victimName.length > 0
            ? kill.victimName
            : `Player${kill.victim}`;
        pushFeed(
          frame.feed,
          buildFeedEntry(
            killerName,
            victimName,
            kill.weapon ?? null,
            killerIdx,
            victimIdx >= 0 ? victimIdx : null,
          ),
        );
      } catch {
        // Feed faults never kill the session.
      }
    }
  }
  if (frame.scoreEl !== null && frame.scoreEl !== undefined) {
    try {
      renderOnlineScoreboard(frame.scoreEl, roster, frame.scores, frame.localName);
    } catch {
      // Scoreboard faults never kill the session.
    }
  }
  if (frame.toast !== null && frame.toast !== undefined) {
    for (const leave of frame.leaves ?? []) {
      try {
        if (leave === null || typeof leave !== "object") {
          continue;
        }
        showToast(frame.toast, leaveBannerFor(leave.name ?? ""));
      } catch {
        // Toast faults never kill the session.
      }
    }
  }
  return { state };
}
