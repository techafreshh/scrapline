// HUD view-model and DOM binder: pure helpers (player names, ordinals,
// timer text, standings rows, kill attribution) plus a thin DOM binder
// mirroring the live World into #hud/#killfeed/#respawn/#end-screen.
// The sim stays untouched: kill attribution diffs scores/alive flags
// around stepOnce instead of extending the frozen WorldEvent contract.

import { HEALTH_MAX, JETPACK_FUEL_MAX, TICK_HZ } from "../../../core/src/constants";
import { standingsFor } from "../../../core/src/match";
import {
  grenadePipStates,
  normalizeWeaponId,
  pipClass,
  syncPipClasses,
  updateAmmo,
} from "../ui/ammo";
import { buildFeedEntry, pushFeed } from "../ui/feed";
import { applyHudChrome } from "../ui/chrome";
import { teamCss } from "../view/character";
import { setBitmapText } from "../ui/fonts";

/** Generated bot-name pool: every bot id maps here (local id 0 is You). */
export const BOT_NAMES: readonly string[] = [
  "Viper",
  "Ghost",
  "Raptor",
  "Blitz",
  "Nova",
  "Onyx",
  "Pixel",
  "Rogue",
  "Sable",
  "Talon",
  "Umbra",
  "Volt",
];

/** True for a non-empty local-name override (empty names read You). */
function hasLocalName(localName: unknown): localName is string {
  return typeof localName === "string" && localName.trim() !== "";
}

/** Display name for a player id: local id 0 is You, bots read the pool. */
export function playerName(id: number, localName?: string | null): string {
  if (id === 0) {
    if (hasLocalName(localName)) {
      return localName.trim();
    }
    return "You";
  }
  const pool = BOT_NAMES.length;
  const slot = ((id - 1) % pool + pool) % pool;
  return BOT_NAMES[slot] as string;
}

/**
 * Display color for a player-array index: the single teamCss source
 * (local cyan, odd orange-red, even amber), null when unknown.
 */
export function playerColor(index: number | null): string | null {
  if (typeof index !== "number" || !Number.isFinite(index)) {
    return null;
  }
  return teamCss(index);
}

/** Ordinal rank label: 1st, 2nd, 3rd, 4th (11th/12th/13th stay "th"). */
export function ordinal(n: number): string {
  const mod100 = ((n % 100) + 100) % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${n}th`;
  }
  const mod10 = ((n % 10) + 10) % 10;
  if (mod10 === 1) {
    return `${n}st`;
  }
  if (mod10 === 2) {
    return `${n}nd`;
  }
  if (mod10 === 3) {
    return `${n}rd`;
  }
  return `${n}th`;
}

/** Remaining match time as m:ss, clamped at 0:00 once the cap is hit. */
export function formatTimer(tick: number, timeLimitTicks: number): string {
  const remainingTicks = Math.max(0, timeLimitTicks - tick);
  const totalSeconds = Math.ceil(remainingTicks / TICK_HZ);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** One scoreboard line: player id, display name, kills, ordinal rank. */
export interface StandingsRow {
  id: number;
  name: string;
  score: number;
  rank: string;
}

/**
 * Scoreboard rows ordered by score desc, id asc on ties (via the core
 * standingsFor helper, never re-sorted by hand).
 */
export function standingsRows(
  scores: readonly number[],
  ids: readonly number[],
  localName?: string | null,
): StandingsRow[] {
  const byId = new Map<number, number>();
  for (let k = 0; k < ids.length; k += 1) {
    byId.set(ids[k] as number, scores[k] ?? 0);
  }
  return standingsFor(scores, ids).map((id, index) => ({
    id,
    name: playerName(id, localName),
    score: byId.get(id) ?? 0,
    rank: ordinal(index + 1),
  }));
}

/** One online scoreboard line: player id, roster display name, kills. */
export interface OnlineScoreRow {
  id: number;
  name: string;
  score: number;
}

/** Score input for the online board: id/score pairs or an id-keyed map. */
export type OnlineScores =
  | ReadonlyMap<number, number>
  | Readonly<Record<number, number>>
  | readonly { id: number; score: number }[]
  | null
  | undefined;

/** Score for one pid from any OnlineScores shape (missing reads 0). */
function onlineScoreFor(scores: OnlineScores, id: number): number {
  try {
    if (scores === null || scores === undefined) {
      return 0;
    }
    if (Array.isArray(scores)) {
      for (const row of scores) {
        if (row !== null && typeof row === "object" && row.id === id) {
          const value = (row as { score?: unknown }).score;
          return typeof value === "number" && Number.isFinite(value)
            ? Math.max(0, Math.floor(value))
            : 0;
        }
      }
      return 0;
    }
    if (typeof (scores as ReadonlyMap<number, number>).get === "function") {
      const hit = (scores as ReadonlyMap<number, number>).get(id);
      return typeof hit === "number" && Number.isFinite(hit)
        ? Math.max(0, Math.floor(hit))
        : 0;
    }
    if (typeof scores === "object") {
      const hit = (scores as Readonly<Record<number, number>>)[id];
      return typeof hit === "number" && Number.isFinite(hit)
        ? Math.max(0, Math.floor(hit))
        : 0;
    }
  } catch {
    // Hostile scores: the 0 fallback stands.
  }
  return 0;
}

/**
 * Online scoreboard rows in pid order (issue #253): the union of roster
 * and score ids sorted ascending, roster names winning with a
 * `Player<id>` fallback. Never sorted by score so the third row in a
 * 3+ player room is never dropped by a top-2 truncation.
 */
export function onlineScoreRows(
  roster: readonly { id: number; name?: unknown }[] | null | undefined,
  scores: OnlineScores,
  localName?: string | null,
): OnlineScoreRow[] {
  const names = new Map<number, string>();
  try {
    if (Array.isArray(roster)) {
      for (const row of roster) {
        if (row !== null && typeof row === "object" && Number.isInteger(row.id) && row.id >= 0) {
          const raw = (row as { name?: unknown }).name;
          names.set(
            row.id,
            typeof raw === "string" && raw.length > 0 ? raw : `Player${row.id}`,
          );
        }
      }
    }
  } catch {
    // Hostile roster: the score ids below still list every player.
  }
  const ids = new Set<number>(names.keys());
  try {
    if (Array.isArray(scores)) {
      for (const row of scores) {
        if (row !== null && typeof row === "object" && Number.isInteger((row as { id?: unknown }).id)) {
          const id = (row as { id: number }).id;
          if (id >= 0) {
            ids.add(id);
          }
        }
      }
    } else if (scores !== null && typeof scores === "object" && typeof (scores as ReadonlyMap<number, number>).get === "function") {
      for (const id of (scores as ReadonlyMap<number, number>).keys()) {
        if (Number.isInteger(id) && (id as number) >= 0) {
          ids.add(id as number);
        }
      }
    } else if (scores !== null && typeof scores === "object") {
      for (const key of Object.keys(scores as Readonly<Record<number, number>>)) {
        const id = Math.floor(Number(key));
        if (Number.isInteger(id) && id >= 0) {
          ids.add(id);
        }
      }
    }
  } catch {
    // Hostile scores: the roster ids above still list every player.
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      name:
        names.get(id) ??
        (id === 0 && hasLocalName(localName) ? (localName as string).trim() : `Player${id}`),
      score: onlineScoreFor(scores, id),
    }));
}

/**
 * Mirror online scoreboard rows into the HUD score node: pid-ordered
 * `Name: score` entries joined compactly (the container scrolls past
 * two rows via the #hud-score max-height rule). Null-safe: missing
 * elements are skipped so fake-doc probes stay green.
 */
export function renderOnlineScoreboard(
  scoreEl: { textContent: string | null } | null | undefined,
  roster: readonly { id: number; name?: unknown }[] | null | undefined,
  scores: OnlineScores,
  localName?: string | null,
): void {
  if (scoreEl === null || scoreEl === undefined) {
    return;
  }
  try {
    scoreEl.textContent = onlineScoreRows(roster, scores, localName)
      .map((row) => `${row.name}: ${row.score}`)
      .join(" \u00b7 ");
  } catch {
    // Hostile shims: the previous scoreboard text stands.
  }
}

/** One end-screen line: player id, display name, kills, deaths, winner flag. */
export interface EndStandingsRow {
  id: number;
  name: string;
  kills: number;
  deaths: number;
  winner: boolean;
}

/**
 * End-screen rows ordered by kills desc, id asc on ties (via the core
 * standingsFor helper, never re-sorted by hand). Only the first row
 * reads winner true; missing deaths entries default to 0.
 */
export function endStandingsRows(
  scores: readonly number[],
  deaths: readonly number[],
  ids: readonly number[],
  localName?: string | null,
): EndStandingsRow[] {
  const killsById = new Map<number, number>();
  const deathsById = new Map<number, number>();
  for (let k = 0; k < ids.length; k += 1) {
    killsById.set(ids[k] as number, scores[k] ?? 0);
    deathsById.set(ids[k] as number, deaths[k] ?? 0);
  }
  return standingsFor(scores, ids).map((id, index) => ({
    id,
    name: playerName(id, localName),
    kills: killsById.get(id) ?? 0,
    deaths: deathsById.get(id) ?? deaths[id] ?? 0,
    winner: index === 0,
  }));
}

/** One attributed kill: killer null when nobody scored (suicide/barrel). */
export interface KillPair {
  killerId: number | null;
  victimId: number;
}

/**
 * Pair each alive true->false transition with a score-incremented killer.
 * Killer slots expand by gained points and zip with victims in index
 * order; leftover victims (unattributed deaths) read killer null.
 */
export function killsFromDiff(
  prevScores: readonly number[],
  nextScores: readonly number[],
  prevAlive: readonly boolean[],
  nextAlive: readonly boolean[],
): KillPair[] {
  const killers: number[] = [];
  const scoreCount = Math.max(prevScores.length, nextScores.length);
  for (let i = 0; i < scoreCount; i += 1) {
    const gained = (nextScores[i] ?? 0) - (prevScores[i] ?? 0);
    for (let k = 0; k < gained; k += 1) {
      killers.push(i);
    }
  }
  const kills: KillPair[] = [];
  const playerCount = Math.max(prevAlive.length, nextAlive.length);
  for (let i = 0; i < playerCount; i += 1) {
    if (prevAlive[i] === true && nextAlive[i] === false) {
      const killer = killers.length > 0 ? (killers.shift() as number) : null;
      kills.push({ killerId: killer, victimId: i });
    }
  }
  return kills;
}

/** Live per-frame values the binder mirrors into the DOM overlay. */
export interface HudSnapshot {
  hp: number;
  fuel: number;
  magAmmo: number;
  weaponName: string;
  grenades: number;
  killedBy: string | null;
  scores: readonly number[];
  ids: readonly number[];
  tick: number;
  timeLimitTicks: number;
  localAlive: boolean;
  respawnTicks: number;
}

/** HP bar discrete state (HU-03): three bands driven by the live value. */
export type HpState = "high" | "mid" | "low";

/**
 * HP state for a live reading: thirds of HEALTH_MAX, so full reads
 * high, half reads mid, and a sliver reads low. Non-finite readings
 * read low so half-built snapshots never fake a healthy bar. Pure.
 */
export function hpStateFor(hp: unknown): HpState {
  const value = Number(hp);
  const pct = Number.isFinite(value) ? value / HEALTH_MAX : 0;
  if (pct >= 2 / 3) {
    return "high";
  }
  if (pct >= 1 / 3) {
    return "mid";
  }
  return "low";
}

/**
 * True while jetpack fuel reads low (HU-04): under one quarter of
 * JETPACK_FUEL_MAX, so the fuel bar blinks before it runs dry.
 * Non-finite readings never flag. Pure.
 */
export function fuelLowFor(fuel: unknown): boolean {
  const value = Number(fuel);
  if (!Number.isFinite(value)) {
    return false;
  }
  return value < JETPACK_FUEL_MAX / 4;
}

/**
 * True while the sniper aims down its scope (HU-11): the sniper held
 * from a crouched (steadied) pose. The overlay shows and the reticle
 * hides in this state; every other weapon (or a standing sniper) keeps
 * the per-weapon crosshair. Pure.
 */
export function isSniperScoped(weapon: unknown, crouching: unknown): boolean {
  return normalizeWeaponId(weapon) === "sniper" && crouching === true;
}

/**
 * Pickup toast text for a pad kind (HU-15): health and grenade pads
 * read their short gains, weapon pads announce the pickup. Unknown
 * kinds read null so no toast fires. The singular "grenade" spelling
 * is intentionally tolerated because showToast stamps kinds verbatim.
 * Pure.
 */
export function pickupToastFor(kind: unknown): string | null {
  if (typeof kind !== "string") {
    return null;
  }
  const key = kind.trim().toLowerCase();
  if (key === "health") {
    return "+HP";
  }
  if (key === "grenades" || key === "grenade") {
    return "+GREN";
  }
  if (key === "weapon") {
    return "Weapon +";
  }
  return null;
}

/** Element handles owned by the overlay; nulls make updates no-op. */
export interface HudHandles {
  hud: HTMLElement | null;
  /** Top-left status cluster plate (HU-01); null skips its chrome. */
  status?: HTMLElement | null;
  health: HTMLElement | null;
  hpFill: HTMLElement | null;
  fuel: HTMLElement | null;
  grenades: HTMLElement | null;
  weapon: HTMLElement | null;
  ammo: HTMLElement | null;
  score: HTMLElement | null;
  timer: HTMLElement | null;
  killfeed: HTMLElement | null;
  respawn: HTMLElement | null;
  endScreen: HTMLElement | null;
  endStandings: HTMLElement | null;
  ammoModule: HTMLElement | null;
  ammoIcon: HTMLElement | null;
  ammoName: HTMLElement | null;
  ammoCounts: HTMLElement | null;
  ammoPips: HTMLElement | null;
  /** Five magazine pips (HU-05); absent on older handle shapes. */
  ammoMags?: HTMLElement | null;
  /** Three grenade pips in the status cluster (HU-06). */
  grenadePips?: HTMLElement | null;
  /** Respawn card body (HU-10); text falls back to #respawn. */
  respawnCard?: HTMLElement | null;
  /** Top-centre score/timer chip (HU-07); toggled with the HUD. */
  center?: HTMLElement | null;
}

function byId(doc: Document, id: string): HTMLElement | null {
  const el = doc.getElementById(id);
  return el instanceof HTMLElement ? el : null;
}

/** Grab the overlay handles; idempotent and safe before match start. */
export function buildHud(doc: Document): HudHandles {
  return {
    hud: byId(doc, "hud"),
    status: byId(doc, "hud-status"),
    health: byId(doc, "hud-health"),
    hpFill: byId(doc, "hud-hp"),
    fuel: byId(doc, "hud-fuel"),
    grenades: byId(doc, "hud-grenades"),
    weapon: byId(doc, "hud-weapon"),
    ammo: byId(doc, "hud-ammo"),
    score: byId(doc, "hud-score"),
    timer: byId(doc, "hud-timer"),
    killfeed: byId(doc, "killfeed"),
    respawn: byId(doc, "respawn"),
    endScreen: byId(doc, "end-screen"),
    endStandings: byId(doc, "end-standings"),
    ammoModule: byId(doc, "ammo-module"),
    ammoIcon: byId(doc, "ammo-icon"),
    ammoName: byId(doc, "ammo-name"),
    ammoCounts: byId(doc, "ammo-counts"),
    ammoPips: byId(doc, "ammo-pips"),
    ammoMags: byId(doc, "ammo-mags"),
    grenadePips: byId(doc, "hud-grenade-pips"),
    respawnCard: byId(doc, "respawn-card"),
    center: byId(doc, "hud-center"),
  };
}

/** Mirror one snapshot into the overlay; missing elements are skipped. */
export function updateHud(
  handles: HudHandles,
  snapshot: HudSnapshot,
  localName?: string | null,
): void {
  if (handles.health !== null) {
    // Bitmap HP digits stay crisp at any camera/browser zoom: hard
    // rects (no anti-aliased vector text) keep Sobel edge energy flat.
    setBitmapText(handles.health, String(Math.ceil(snapshot.hp)));
  }
  // Pixel-pack frame chrome (issues #270, #359): the full-width `#hud`
  // container is cleared to `background-image: none` while the four `.hud-module`
  // clusters (status, center, killfeed, ammo) read their `ui.*` tiles (change-guarded, never throws); the bitmap health/timer/grenade writes above stay untouched.
  applyHudChrome(handles);
  if (handles.fuel !== null) {
    const pct = Math.min(100, Math.max(0, (snapshot.fuel / JETPACK_FUEL_MAX) * 100));
    handles.fuel.style.width = `${pct}%`;
  }
  if (handles.hpFill !== null && handles.hpFill !== undefined) {
    const pct = Math.min(100, Math.max(0, (snapshot.hp / HEALTH_MAX) * 100));
    handles.hpFill.style.width = `${pct}%`;
    // HU-03 three-state bar: the fill swaps its state token (high/mid/low)
    // so the bar reads green/amber/red without re-reading widths.
    setStateClass(handles.hpFill, `hp-${hpStateFor(snapshot.hp)}`, [
      "hp-high",
      "hp-mid",
      "hp-low",
    ]);
  }
  if (handles.fuel !== null && handles.fuel !== undefined) {
    // HU-04 low-fuel flag: the cyan bar blinks once under a quarter tank.
    setFlagClass(handles.fuel, "fuel-low", fuelLowFor(snapshot.fuel));
  }
  if (handles.grenades !== null) {
    setBitmapText(handles.grenades, String(snapshot.grenades));
  }
  const grenadePipsEl = handles.grenadePips ?? null;
  if (grenadePipsEl !== null && grenadePipsEl !== undefined) {
    // HU-06 status pips: the same three grenade states the ammo module
    // mirrors, reconciled through the shared pip row helper.
    syncPipClasses(
      grenadePipsEl,
      grenadePipStates(snapshot.grenades).map((filled) => pipClass(filled)),
    );
  }
  if (handles.weapon !== null) {
    handles.weapon.textContent = snapshot.weaponName;
  }
  if (handles.ammo !== null) {
    handles.ammo.textContent = `${snapshot.weaponName} ${snapshot.magAmmo}`;
  }
  // Bottom-right weapon module (issue #152): plain vector text plus
  // icon, grenade pips, and the five magazine pips (HU-05). The legacy
  // #hud-ammo line above keeps its exact shape so reserve-free
  // snapshots still read `Pistol 7`.
  updateAmmo(
    {
      module: handles.ammoModule ?? null,
      icon: handles.ammoIcon ?? null,
      name: handles.ammoName ?? null,
      counts: handles.ammoCounts ?? null,
      pips: handles.ammoPips ?? null,
      mags: handles.ammoMags ?? null,
    },
    {
      magAmmo: snapshot.magAmmo,
      weapon: snapshot.weaponName,
      grenades: snapshot.grenades,
    },
  );
  if (handles.score !== null) {
    handles.score.textContent = standingsRows(
      snapshot.scores,
      snapshot.ids,
      localName,
    )
      .map((row) => `${row.rank} ${row.name}: ${row.score}`)
      .join(" ");
  }
  if (handles.timer !== null) {
    setBitmapText(
      handles.timer,
      formatTimer(snapshot.tick, snapshot.timeLimitTicks),
    );
  }
  if (handles.respawn !== null) {
    if (snapshot.localAlive) {
      handles.respawn.style.display = "none";
    } else {
      handles.respawn.style.display = "";
      const secs = Math.max(1, Math.ceil(snapshot.respawnTicks / TICK_HZ));
      // HU-10 respawn card: the countdown reads inside #respawn-card
      // when mounted (its textContent still rolls up into #respawn),
      // else directly on the overlay like before.
      const card = handles.respawnCard ?? null;
      const target = card ?? handles.respawn;
      if (target !== null && target !== undefined) {
        target.textContent =
          snapshot.killedBy === null || snapshot.killedBy === ""
            ? `Respawning in ${secs}s`
            : `eliminated by ${snapshot.killedBy} \u2014 Respawning in ${secs}s`;
      }
    }
  }
}

/**
 * Swap one state token on an element: remove every token in the group,
 * add the wanted one, and mirror it as data-state for probes. Missing
 * classList builders and hostile shims are no-ops; never throws.
 */
function setStateClass(
  el: unknown,
  want: string,
  group: readonly string[],
): void {
  try {
    const list = (el as { classList?: unknown }).classList as
      | { add?: unknown; remove?: unknown; contains?: unknown }
      | undefined;
    if (list !== undefined && list !== null) {
      if (typeof list.remove === "function") {
        for (const token of group) {
          if (token !== want) {
            (list.remove as (c: string) => void).call(list, token);
          }
        }
      }
      if (typeof list.add === "function") {
        let present = false;
        if (typeof list.contains === "function") {
          try {
            present =
              (list.contains as (c: string) => unknown).call(list, want) === true;
          } catch {
            present = false;
          }
        }
        if (!present) {
          (list.add as (c: string) => void).call(list, want);
        }
      }
    }
  } catch {
    // Class-list-less fakes: the data-state mirror below still lands.
  }
  try {
    const target = el as { setAttribute?: unknown };
    if (typeof target.setAttribute === "function") {
      (target.setAttribute as (name: string, value: string) => void).call(
        target,
        "data-state",
        want,
      );
    }
  } catch {
    // Attribute-less fakes: the classList above may already have it.
  }
}

/**
 * Toggle one flag token (plus its data-flag mirror) on an element.
 * Missing builders and hostile shims are no-ops; never throws.
 */
function setFlagClass(el: unknown, token: string, on: boolean): void {
  try {
    const list = (el as { classList?: unknown }).classList as
      | { add?: unknown; remove?: unknown }
      | undefined;
    if (list !== undefined && list !== null) {
      if (on && typeof list.add === "function") {
        (list.add as (c: string) => void).call(list, token);
      } else if (!on && typeof list.remove === "function") {
        (list.remove as (c: string) => void).call(list, token);
      }
    }
  } catch {
    // Class-list-less fakes: the data-flag mirror below still lands.
  }
  try {
    const target = el as { setAttribute?: unknown };
    if (typeof target.setAttribute === "function") {
      (target.setAttribute as (name: string, value: string) => void).call(
        target,
        `data-${token}`,
        on ? "true" : "false",
      );
    }
  } catch {
    // Attribute-less fakes: the classList above may already have it.
  }
}

/** Kill-feed flash hold in ms: the new entry pops, then settles (under 1s). */
export const KILLFEED_FLASH_MS = 700;
/** Crosshair hitmarker hold in ms (inside the 100-400ms window). */
export const CROSSHAIR_HIT_MS = 250;
/** HP damage-flash hold in ms: the bar burns warm, then settles (under 1.5s). */
export const HP_DAMAGE_FLASH_MS = 800;
/** Latest damage-flash generation: stale timers never clear a re-armed flash. */
let hpFlashSeq = 0;
/** Pending damage-flash removal handle, cleared when damage re-fires. */
let hpFlashTimer: ReturnType<typeof setTimeout> | null = null;
/** View owning the pending damage-flash removal handle. */
let hpFlashView: { clearTimeout?: unknown } | null = null;

/**
 * Append one killfeed line, capping the feed at the last 5 entries.
 * Killer blows with a known weapon render colored names plus a weapon
 * icon (delegated to the feed module); unattributed deaths and
 * weapon-less blows keep the legacy flat text line so the old
 * `(handles, killer, victim)` call shape keeps compiling and reading.
 */
export function pushKillfeed(
  handles: HudHandles,
  killer: string | null,
  victim: string,
  weapon?: string | null,
  killerIndex?: number | null,
  victimIndex?: number | null,
): void {
  const feed = handles.killfeed;
  if (feed === null) {
    return;
  }
  pushFeed(
    { feed },
    buildFeedEntry(
      killer,
      victim,
      weapon ?? null,
      killerIndex ?? null,
      victimIndex ?? null,
    ),
    KILLFEED_FLASH_MS,
  );
}

/**
 * Flash the crosshair hitmarker for ms milliseconds (default the
 * 250ms hit window). Null-safe: missing elements or timers are no-ops.
 * Re-queries #crosshair on every call so tests can use fake docs.
 */
export function flashCrosshair(doc: Document, ms: number = CROSSHAIR_HIT_MS): void {
  let target: { classList: { add(c: string): void; remove(c: string): void } } | null =
    null;
  try {
    // Duck-typed (not instanceof): unit-test fake docs carry a classList
    // without a real HTMLElement lineage.
    const el = doc.getElementById("crosshair") as unknown as {
      classList?: { add(c: string): void; remove(c: string): void };
    } | null;
    if (
      el !== null &&
      el !== undefined &&
      el.classList !== undefined &&
      typeof el.classList.add === "function" &&
      typeof el.classList.remove === "function"
    ) {
      target = el as {
        classList: { add(c: string): void; remove(c: string): void };
      };
    }
  } catch {
    return;
  }
  if (target === null) {
    return;
  }
  target.classList.add("hit");
  try {
    const timer = doc.defaultView?.setTimeout;
    if (typeof timer !== "function") {
      return;
    }
    timer.call(doc.defaultView, () => {
      target.classList.remove("hit");
    }, ms);
  } catch {
    // Missing timers in fake docs: the hit class simply stays.
  }
}

/** Kill-confirm marker hold in ms: the reticle X lingers past the flash. */
export const CROSSHAIR_KILL_MS = 600;

/**
 * Swap the crosshair skin to the held weapon (HU-09): stamps the
 * normalized weapon id as data-weapon so the per-weapon reticle CSS
 * (ticks per family, dot-only sniper, bracket rocket) follows swaps.
 * Change-guarded so the every-frame mirror stays cheap; null-safe and
 * never throws. Unknown readings fall back to the pistol skin.
 */
export function setCrosshairWeapon(doc: Document, weapon: unknown): void {
  try {
    const el = doc.getElementById("crosshair") as unknown as {
      getAttribute?: unknown;
      setAttribute?: unknown;
    } | null;
    if (el === null || el === undefined) {
      return;
    }
    const want = normalizeWeaponId(weapon);
    let current: string | null = null;
    try {
      if (typeof el.getAttribute === "function") {
        const seen = (el.getAttribute as (name: string) => unknown).call(
          el,
          "data-weapon",
        );
        current = typeof seen === "string" ? seen : null;
      }
    } catch {
      current = null;
    }
    if (current !== want && typeof el.setAttribute === "function") {
      (el.setAttribute as (name: string, value: string) => void).call(
        el,
        "data-weapon",
        want,
      );
    }
  } catch {
    // Hostile shims: the previous skin stands.
  }
}

/**
 * Flash the crosshair kill marker for ms milliseconds (default the
 * 600ms kill window): the reticle becomes the kill X while the entry
 * lands in the feed. Null-safe; missing timers keep the class.
 */
export function flashKillMarker(doc: Document, ms: number = CROSSHAIR_KILL_MS): void {
  let target: { classList: { add(c: string): void; remove(c: string): void } } | null =
    null;
  try {
    const el = doc.getElementById("crosshair") as unknown as {
      classList?: { add(c: string): void; remove(c: string): void };
    } | null;
    if (
      el !== null &&
      el !== undefined &&
      el.classList !== undefined &&
      typeof el.classList.add === "function" &&
      typeof el.classList.remove === "function"
    ) {
      target = el as {
        classList: { add(c: string): void; remove(c: string): void };
      };
    }
  } catch {
    return;
  }
  if (target === null) {
    return;
  }
  target.classList.add("kill");
  try {
    const timer = doc.defaultView?.setTimeout;
    if (typeof timer !== "function") {
      return;
    }
    timer.call(doc.defaultView, () => {
      target.classList.remove("kill");
    }, ms);
  } catch {
    // Missing timers in fake docs: the kill class simply stays.
  }
}

/**
 * Mirror one crosshair frame (HU-09/HU-11): stamp the held-weapon skin,
 * show the scope overlay while the sniper steadies crouched, and hide
 * the reticle behind the lens (unscoped snipers keep the 2px dot via
 * CSS). Change-guarded element lookups; null-safe, never throws.
 */
export function updateCrosshairState(
  doc: Document,
  weapon: unknown,
  scoped: boolean,
): void {
  setCrosshairWeapon(doc, weapon);
  try {
    const scope = doc.getElementById("scope") as unknown as {
      style?: { display?: unknown };
    } | null;
    if (scope !== null && scope !== undefined && scope.style !== undefined) {
      const display = scoped ? "" : "none";
      if ((scope.style as { display?: unknown }).display !== display) {
        (scope.style as { display?: unknown }).display = display;
      }
    }
  } catch {
    // Missing scope overlay: the reticle swap above still lands.
  }
  try {
    const el = doc.getElementById("crosshair") as unknown as {
      classList?: { add?: unknown; remove?: unknown };
    } | null;
    const list = el?.classList;
    if (list !== undefined && list !== null) {
      if (scoped && typeof list.add === "function") {
        (list.add as (c: string) => void).call(list, "scoped");
      } else if (!scoped && typeof list.remove === "function") {
        (list.remove as (c: string) => void).call(list, "scoped");
      }
    }
  } catch {
    // Class-list-less fakes: the overlay display above still hides it.
  }
}

/**
 * Flash the HP bar warm for ms milliseconds (default the 800ms damage
 * window). Null-safe: missing elements or timers are no-ops.
 * Re-queries #hud-hp on every call so tests can use fake docs;
 * re-damage re-arms the full window (stale timers never clear early).
 */
export function flashHpDamage(doc: Document, ms: number = HP_DAMAGE_FLASH_MS): void {
  let target: { classList: { add(c: string): void; remove(c: string): void } } | null =
    null;
  try {
    // Duck-typed (not instanceof): unit-test fake docs carry a classList
    // without a real HTMLElement lineage.
    const el = doc.getElementById("hud-hp") as unknown as {
      classList?: { add(c: string): void; remove(c: string): void };
    } | null;
    if (
      el !== null &&
      el !== undefined &&
      el.classList !== undefined &&
      typeof el.classList.add === "function" &&
      typeof el.classList.remove === "function"
    ) {
      target = el as {
        classList: { add(c: string): void; remove(c: string): void };
      };
    }
  } catch {
    return;
  }
  if (target === null) {
    return;
  }
  hpFlashSeq += 1;
  const seen = hpFlashSeq;
  target.classList.add("hurt");
  try {
    const view = doc.defaultView;
    const timer = view?.setTimeout;
    if (typeof timer !== "function") {
      return;
    }
    try {
      if (hpFlashTimer !== null && hpFlashView !== null) {
        const clearer = hpFlashView.clearTimeout;
        if (typeof clearer === "function") {
          (clearer as (id: unknown) => void).call(hpFlashView, hpFlashTimer);
        }
      }
    } catch {
      // Clearing best-effort: the generation guard below still holds.
    }
    hpFlashView = view ?? null;
    hpFlashTimer = timer.call(view, () => {
      if (seen !== hpFlashSeq) {
        return;
      }
      hpFlashTimer = null;
      target.classList.remove("hurt");
    }, ms) as ReturnType<typeof setTimeout>;
  } catch {
    // Missing timers in fake docs: the hurt class simply stays.
  }
}
