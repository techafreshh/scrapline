// HUD view-model and DOM binder: pure helpers (player names, ordinals,
// timer text, standings rows, kill attribution) plus a thin DOM binder
// mirroring the live World into #hud/#killfeed/#respawn/#end-screen.
// The sim stays untouched: kill attribution diffs scores/alive flags
// around stepOnce instead of extending the frozen WorldEvent contract.

import { JETPACK_FUEL_MAX, TICK_HZ } from "../../../core/src/constants";
import { standingsFor } from "../../../core/src/match";
import { updateAmmo } from "../ui/ammo";
import { setBitmapText } from "../ui/fonts";

/** Display name for a player id: the local id 0 is always "You". */
export function playerName(id: number): string {
  return id === 0 ? "You" : `Bot ${id}`;
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
): StandingsRow[] {
  const byId = new Map<number, number>();
  for (let k = 0; k < ids.length; k += 1) {
    byId.set(ids[k] as number, scores[k] ?? 0);
  }
  return standingsFor(scores, ids).map((id, index) => ({
    id,
    name: playerName(id),
    score: byId.get(id) ?? 0,
    rank: ordinal(index + 1),
  }));
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
): EndStandingsRow[] {
  const killsById = new Map<number, number>();
  const deathsById = new Map<number, number>();
  for (let k = 0; k < ids.length; k += 1) {
    killsById.set(ids[k] as number, scores[k] ?? 0);
    deathsById.set(ids[k] as number, deaths[k] ?? 0);
  }
  return standingsFor(scores, ids).map((id, index) => ({
    id,
    name: playerName(id),
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

/** Element handles owned by the overlay; nulls make updates no-op. */
export interface HudHandles {
  hud: HTMLElement | null;
  health: HTMLElement | null;
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
}

function byId(doc: Document, id: string): HTMLElement | null {
  const el = doc.getElementById(id);
  return el instanceof HTMLElement ? el : null;
}

/** Grab the overlay handles; idempotent and safe before match start. */
export function buildHud(doc: Document): HudHandles {
  return {
    hud: byId(doc, "hud"),
    health: byId(doc, "hud-health"),
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
  };
}

/** Mirror one snapshot into the overlay; missing elements are skipped. */
export function updateHud(handles: HudHandles, snapshot: HudSnapshot): void {
  if (handles.health !== null) {
    // Bitmap HP digits stay crisp at any camera/browser zoom: hard
    // rects (no anti-aliased vector text) keep Sobel edge energy flat.
    setBitmapText(handles.health, String(Math.ceil(snapshot.hp)));
  }
  if (handles.fuel !== null) {
    const pct = Math.min(100, Math.max(0, (snapshot.fuel / JETPACK_FUEL_MAX) * 100));
    handles.fuel.style.width = `${pct}%`;
  }
  if (handles.grenades !== null) {
    setBitmapText(handles.grenades, String(snapshot.grenades));
  }
  if (handles.weapon !== null) {
    handles.weapon.textContent = snapshot.weaponName;
  }
  if (handles.ammo !== null) {
    handles.ammo.textContent = `${snapshot.weaponName} ${snapshot.magAmmo}`;
  }
  // Bottom-right weapon module (issue #152): plain vector text plus
  // icon and grenade pips. The legacy #hud-ammo line above keeps its
  // exact shape so reserve-free snapshots still read `Pistol 7`.
  updateAmmo(
    {
      module: handles.ammoModule ?? null,
      icon: handles.ammoIcon ?? null,
      name: handles.ammoName ?? null,
      counts: handles.ammoCounts ?? null,
      pips: handles.ammoPips ?? null,
    },
    {
      magAmmo: snapshot.magAmmo,
      weapon: snapshot.weaponName,
      grenades: snapshot.grenades,
    },
  );
  if (handles.score !== null) {
    handles.score.textContent = standingsRows(snapshot.scores, snapshot.ids)
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
      handles.respawn.textContent =
        snapshot.killedBy === null || snapshot.killedBy === ""
          ? `Respawning in ${secs}s`
          : `eliminated by ${snapshot.killedBy} \u2014 Respawning in ${secs}s`;
    }
  }
}

/** Kill-feed flash hold in ms: the new entry pops, then settles (under 1s). */
export const KILLFEED_FLASH_MS = 700;
/** Crosshair hitmarker hold in ms (inside the 100-400ms window). */
export const CROSSHAIR_HIT_MS = 250;

/** Append one killfeed line, capping the feed at the last 5 entries. */
export function pushKillfeed(
  handles: HudHandles,
  killer: string | null,
  victim: string,
): void {
  const feed = handles.killfeed;
  if (feed === null) {
    return;
  }
  const entry = feed.ownerDocument.createElement("div");
  entry.setAttribute("class", "kill-entry flash");
  entry.textContent =
    killer === null || killer === "" ? `${victim} died` : `${killer} killed ${victim}`;
  feed.appendChild(entry);
  try {
    const timer = feed.ownerDocument.defaultView?.setTimeout;
    if (typeof timer === "function") {
      timer.call(feed.ownerDocument.defaultView, () => {
        // The entry may already be capped away; classList no-ops safely.
        entry.classList.remove("flash");
      }, KILLFEED_FLASH_MS);
    }
  } catch {
    // Fake docs in unit tests may lack timers: the flash class simply stays.
  }
  while (feed.children.length > 5) {
    const oldest = feed.children[0];
    if (oldest === undefined) {
      break;
    }
    feed.removeChild(oldest);
  }
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
