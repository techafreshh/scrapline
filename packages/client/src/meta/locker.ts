// Cosmetics locker: level/challenge-gated helmet/visor/palette grid with
// a setup-reused preview and an in-match accent. Parsing stays DOM-free
// (unit-testable under node like meta/profile.ts); the thin binder
// mirrors the meta/challenges.ts idiom (null-safe lookups, missing
// elements are no-ops, a `window.__locker` probe mirror). The sim stays
// untouched: main.ts owns the storage handle, resolves the equipped
// palette at match start, and forwards it to the soldier accent source.

import { CHALLENGE_TEMPLATES, loadChallenges } from "./challenges";
import { levelForXp, loadProfile } from "./profile";

/** localStorage key holding the equipped locker id (plain id string). */
export const LOCKER_KEY = "scrapline.cosmetic";

/** Locker panel container id (child of #menu). */
export const LOCKER_PANEL_ID = "locker-panel";
/** Locker panel toggle button id (child of #menu). */
export const LOCKER_OPEN_ID = "locker-open";
/** Locker grid container id (child of the panel). */
export const LOCKER_GRID_ID = "locker-grid";
/** Locker preview canvas id (child of the panel). */
export const LOCKER_PREVIEW_ID = "locker-preview";
/** Locker panel title id. */
export const LOCKER_TITLE_ID = "locker-title";
/** Locker status line id (selected callout). */
export const LOCKER_STATUS_ID = "locker-status";
/** Row marker attribute: each row carries `data-locker="<id>"`. */
export const LOCKER_ITEM_ATTR = "data-locker";
/** Locker tab filter buttons: all rows, unlocked rows, locked rows. */
export const LOCKER_TABS_ID = "locker-tabs";
/** Tab marker attribute: each tab carries `data-locker-tab`. */
export const LOCKER_TAB_ATTR = "data-locker-tab";
/** Explicit equip button id (equips the previewed pick). */
export const LOCKER_EQUIP_ID = "locker-equip";
/** Overlay preview canvas id (mirrors `#locker-preview`). */
export const LOCKER_PREVIEW_FULL_ID = "locker-preview-full";
/** Overlay status line id (mirrors `#locker-status`). */
export const LOCKER_STATUS_FULL_ID = "locker-status-full";

/** Active locker tab filter (`all` shows every row). */
export type LockerTab = "all" | "unlocked" | "locked";

/**
 * Tolerantly normalize an unknown value into a locker tab: only the
 * `locked`/`unlocked` names (any case, trimmed) select a filter,
 * everything else reads `all`. Never throws.
 */
export function parseLockerTab(value: unknown): LockerTab {
  try {
    if (typeof value === "string") {
      const key = value.trim().toLowerCase();
      if (key === "locked") {
        return "locked";
      }
      if (key === "unlocked") {
        return "unlocked";
      }
    }
  } catch {
    // Shorn value: the `all` fallback below still lands.
  }
  return "all";
}

/** One locker combo: helmet/visor/palette gated by level/challenge. */
export interface LockerItem {
  /** Stable row id (also the `data-locker` attribute value). */
  id: string;
  /** Player-language row label. */
  label: string;
  /** Helmet pick (mirrors the cosmetics HELMET_LIST). */
  helmet: string;
  /** Visor pick (mirrors the cosmetics VISOR_LIST). */
  visor: string;
  /** Accent palette as #RRGGBB (drives the in-match helmet tint). */
  palette: string;
  /** Minimum profile level to unlock (1-based, always >= 1). */
  level: number;
  /** Optional challenge id that also unlocks the row when done. */
  challenge?: string;
}

/**
 * Locker catalogue, always these eight in this order: two open at
 * level 1 so a fresh locker shows choice, the rest gate on levels
 * 2-5 with three also listening to their challenge row (either path
 * unlocks, so level seeding and challenge seeding both open rows).
 */
export const LOCKER_ITEMS: readonly LockerItem[] = [
  { id: "recruit-cyan", label: "Recruit Cyan", helmet: "cap", visor: "slit", palette: "#00E5FF", level: 1 },
  { id: "street-ember", label: "Street Ember", helmet: "beret", visor: "slit", palette: "#FF6B35", level: 1 },
  { id: "ranger-lime", label: "Ranger Lime", helmet: "hood", visor: "round", palette: "#A3E635", level: 2 },
  { id: "violet-ops", label: "Violet Ops", helmet: "bandana", visor: "shade", palette: "#C084FC", level: 2, challenge: "rifle-5" },
  { id: "ember-ops", label: "Ember Ops", helmet: "beret", visor: "round", palette: "#FF6B35", level: 3 },
  { id: "frost-hood", label: "Frost Hood", helmet: "hood", visor: "shade", palette: "#00E5FF", level: 3, challenge: "grenade-2" },
  { id: "dune-veteran", label: "Dune Veteran", helmet: "bandana", visor: "round", palette: "#A3E635", level: 4 },
  { id: "elite-spectre", label: "Elite Spectre", helmet: "cap", visor: "shade", palette: "#C084FC", level: 5, challenge: "win-dune-1" },
];

/** Fallback equipped id (first catalogue row, always level 1). */
export const DEFAULT_LOCKER_ID = "recruit-cyan";

/** Minimal storage surface so tests can pass a fake (no DOM needed). */
export interface LockerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Probe row: id, combo, gate, lock state, and `LOCKED` text. */
export interface LockerRow {
  id: string;
  label: string;
  helmet: string;
  visor: string;
  palette: string;
  level: number;
  locked: boolean;
  text: string;
}

/** Live binder state returned by bindLocker. */
export interface LockerBinder {
  /** Equipped locker id (persisted under LOCKER_KEY). */
  selected: string;
  /** Last resolved profile level (re-read from storage on refresh). */
  level: number;
  /** Equip an unlocked row now; locked ids are ignored. Returns selected. */
  select(id: unknown): string;
  /** Re-read storage, repaint the panel/preview, mirror; returns selected. */
  refresh(): string;
  /** Detach nothing (listeners attach once); keeps the scene.ts shape. */
  stop(): void;
}

/** Catalogue lookup by id (case-insensitive, trimmed); else undefined. */
export function lockerItemFor(id: unknown): LockerItem | undefined {
  if (typeof id !== "string") {
    return undefined;
  }
  const key = id.trim().toLowerCase();
  if (key === "") {
    return undefined;
  }
  for (const item of LOCKER_ITEMS) {
    if (item.id.toLowerCase() === key) {
      return item;
    }
  }
  return undefined;
}

/**
 * Tolerantly normalize an unknown value into a locker id: plain ids
 * pass through canonically, JSON-encoded strings (`"ranger-lime"`)
 * and `{id:"..."}` objects unwrap, everything else falls back to the
 * default recruit row. Never throws.
 */
export function parseLockerId(value: unknown): string {
  try {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") {
        return DEFAULT_LOCKER_ID;
      }
      // JSON-encoded selections (`"ranger-lime"` or `{"id":"..."}`)
      // unwrap to the bare id before the catalogue lookup.
      if (trimmed.startsWith('"') || trimmed.startsWith("{")) {
        try {
          const decoded = JSON.parse(trimmed) as unknown;
          if (typeof decoded === "string") {
            return lockerItemFor(decoded)?.id ?? DEFAULT_LOCKER_ID;
          }
          if (typeof decoded === "object" && decoded !== null) {
            const inner = (decoded as Record<string, unknown>)["id"];
            if (typeof inner === "string") {
              return lockerItemFor(inner)?.id ?? DEFAULT_LOCKER_ID;
            }
          }
        } catch {
          // Not valid JSON: fall through to the bare-id lookup.
        }
      }
      return lockerItemFor(trimmed)?.id ?? DEFAULT_LOCKER_ID;
    }
    if (typeof value === "object" && value !== null) {
      const inner = (value as Record<string, unknown>)["id"];
      if (typeof inner === "string") {
        return lockerItemFor(inner)?.id ?? DEFAULT_LOCKER_ID;
      }
    }
  } catch {
    // Normalization never throws: corrupt input reads the default.
  }
  return DEFAULT_LOCKER_ID;
}

/** Null-safe read: storage errors (or absence) yield null. */
function safeGet(
  storage: LockerStorage | null | undefined,
  key: string,
): string | null {
  if (storage === null || storage === undefined) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Load the equipped locker id; missing, corrupt, or unreadable values
 * fall back to DEFAULT_LOCKER_ID. Stored JSON-encoded ids unwrap, so a
 * probe seeding either `ranger-lime` or `"ranger-lime"` equips the row.
 */
export function loadLockerSelection(
  storage: LockerStorage | null | undefined,
): string {
  const raw = safeGet(storage, LOCKER_KEY);
  if (raw === null || raw.trim() === "") {
    return DEFAULT_LOCKER_ID;
  }
  return parseLockerId(raw);
}

/**
 * Persist the equipped locker id as a plain id string; unknown ids
 * normalize to the default. Storage errors are swallowed.
 */
export function saveLockerSelection(
  storage: LockerStorage | null | undefined,
  id: unknown,
): void {
  if (storage === null || storage === undefined) {
    return;
  }
  try {
    storage.setItem(LOCKER_KEY, parseLockerId(id));
  } catch {
    // Private-mode storage: the preview still updates, just not persisted.
  }
}

/** Palette hex for a locker id (unknown ids read the default cyan). */
export function lockerPaletteFor(id: unknown): string {
  return lockerItemFor(typeof id === "string" ? id : parseLockerId(id))?.palette
    ?? (lockerItemFor(DEFAULT_LOCKER_ID) as LockerItem).palette;
}

/** Helmet pick for a locker id (unknown ids read the default cap). */
export function lockerHelmetFor(id: unknown): string {
  return lockerItemFor(typeof id === "string" ? id : parseLockerId(id))?.helmet
    ?? (lockerItemFor(DEFAULT_LOCKER_ID) as LockerItem).helmet;
}

/** Visor pick for a locker id (unknown ids read the default slit). */
export function lockerVisorFor(id: unknown): string {
  return lockerItemFor(typeof id === "string" ? id : parseLockerId(id))?.visor
    ?? (lockerItemFor(DEFAULT_LOCKER_ID) as LockerItem).visor;
}

/** Tolerantly normalize an unknown value into a 1-based level. */
function parseLevelField(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    if (value.trim() === "") {
      return 1;
    }
    n = Number(value);
  } else {
    return 1;
  }
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.max(1, Math.floor(n));
}

/** Challenge template lookup by id; unknown ids read undefined. */
function challengeTemplateFor(id: unknown): { target: number } | undefined {
  if (typeof id !== "string") {
    return undefined;
  }
  for (const template of CHALLENGE_TEMPLATES) {
    if (template.id === id) {
      return template;
    }
  }
  return undefined;
}

/**
 * True when a challenge id reads done in an unknown challenges value:
 * accepts a Set/array of done ids, a done-map, or a full
 * ChallengeState (`{progress:{<id>:{progress,claimed}}}` compared
 * against its template quota). Unknown shapes read false. Never throws.
 */
export function isChallengeDone(state: unknown, id: unknown): boolean {
  try {
    if (typeof id !== "string" || id === "") {
      return false;
    }
    if (state === null || state === undefined) {
      return false;
    }
    if (typeof (state as Set<string>).has === "function") {
      try {
        return ((state as Set<string>).has as (k: string) => boolean).call(state, id);
      } catch {
        return false;
      }
    }
    if (Array.isArray(state)) {
      return (state as unknown[]).includes(id);
    }
    if (typeof state === "object") {
      const rec = state as Record<string, unknown>;
      // Full ChallengeState shape: progress.<id>.progress >= quota.
      const progress = rec["progress"];
      if (typeof progress === "object" && progress !== null) {
        const row = (progress as Record<string, unknown>)[id];
        if (typeof row === "object" && row !== null) {
          const fill = (row as Record<string, unknown>)["progress"];
          const template = challengeTemplateFor(id);
          if (template !== undefined && typeof fill === "number" && Number.isFinite(fill)) {
            return Math.floor(fill) >= template.target;
          }
        }
      }
      // Done-map shape: {<id>: true} or {done:[...]} / {claimed...}.
      const direct = rec[id];
      if (direct === true) {
        return true;
      }
      if (typeof direct === "object" && direct !== null) {
        const done = (direct as Record<string, unknown>)["done"];
        if (done === true) {
          return true;
        }
      }
      const doneList = rec["done"];
      if (Array.isArray(doneList)) {
        return (doneList as unknown[]).includes(id);
      }
      const unlocked = rec["unlocked"];
      if (Array.isArray(unlocked)) {
        return (unlocked as unknown[]).includes(id);
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * True when a locker row is unlocked: the profile level meets the row
 * gate, or (for challenge rows) the linked challenge reads done. Level
 * is tolerant (floored, minimum 1); garbage rows read locked. Never
 * throws.
 */
export function isLockerUnlocked(
  item: LockerItem | string | unknown,
  level: unknown,
  challenges?: unknown,
): boolean {
  try {
    const row = typeof item === "string" ? lockerItemFor(item) : (item as LockerItem | undefined);
    if (row === undefined || row === null || typeof row !== "object") {
      return false;
    }
    if (typeof row.id !== "string" || typeof row.level !== "number") {
      return false;
    }
    const have = parseLevelField(level);
    if (have >= Math.max(1, Math.floor(row.level))) {
      return true;
    }
    if (typeof row.challenge === "string" && row.challenge !== "") {
      return isChallengeDone(challenges, row.challenge);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Probe rows for a level (plus optional challenge state), in catalogue
 * order: id, combo, gate, lock flag, and the `LOCKED` readout. Locked
 * rows read `LOCKED · Lv N` (plus the challenge id when one also
 * unlocks); unlocked rows read the `helmet visor palette` triple so the
 * preview assertion has a stable string. Never throws.
 */
export function lockerRows(level: unknown, challenges?: unknown): LockerRow[] {
  try {
    const have = parseLevelField(level);
    return LOCKER_ITEMS.map((item) => {
      const unlocked = isLockerUnlocked(item, have, challenges);
      const text = unlocked
        ? `${item.helmet} ${item.visor} ${item.palette}`
        : `LOCKED \u00b7 Lv ${Math.max(1, Math.floor(item.level))}`;
      return {
        id: item.id,
        label: item.label,
        helmet: item.helmet,
        visor: item.visor,
        palette: item.palette,
        level: Math.max(1, Math.floor(item.level)),
        locked: !unlocked,
        text,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Profile level for a storage handle (reads `scrapline.profile` via
 * the profile module, tolerantly backfilling `level` seeds). Missing or
 * unreadable storage reads 1. Never throws.
 */
export function lockerLevel(storage: LockerStorage | null | undefined): number {
  try {
    const profile = loadProfile(storage as unknown as Parameters<typeof loadProfile>[0]);
    return Math.max(1, levelForXp(profile.xp));
  } catch {
    return 1;
  }
}

/**
 * Live challenge state for a storage handle (reads
 * `scrapline.challenges.v1` via the challenges module). Missing or
 * unreadable storage reads null (no challenge unlocks). Never throws.
 */
function lockerChallenges(storage: LockerStorage | null | undefined): unknown {
  try {
    if (storage === null || storage === undefined) {
      return null;
    }
    return loadChallenges(storage as unknown as Parameters<typeof loadChallenges>[0]);
  } catch {
    return null;
  }
}

/** Null-safe id lookup: shorn documents read null instead of throwing. */
function byId(doc: Document, id: string): unknown {
  try {
    const lookup = (doc as unknown as { getElementById?: unknown }).getElementById;
    if (typeof lookup !== "function") {
      return null;
    }
    return (lookup as (key: string) => unknown).call(doc, id);
  } catch {
    return null;
  }
}

/** Assign text on an unknown handle when it carries textContent. */
function setText(el: unknown, text: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  if ("textContent" in el) {
    (el as { textContent: unknown }).textContent = text;
  }
}

/** Write one style property on an unknown handle's style bag. */
function setStyle(el: unknown, name: string, value: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  const style = (el as { style?: unknown }).style;
  if (style === null || typeof style !== "object") {
    return;
  }
  (style as Record<string, unknown>)[name] = value;
}

/** Read one attribute off an unknown handle; else empty string. */
function getAttr(el: unknown, name: string): string {
  try {
    if (typeof el !== "object" || el === null) {
      return "";
    }
    const getter = (el as { getAttribute?: unknown }).getAttribute;
    if (typeof getter !== "function") {
      return "";
    }
    const value = (getter as (key: string) => unknown).call(el, name);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** Write one attribute on an unknown handle (best-effort). */
function setAttr(el: unknown, name: string, value: string): void {
  try {
    if (typeof el !== "object" || el === null) {
      return;
    }
    const setter = (el as { setAttribute?: unknown }).setAttribute;
    if (typeof setter !== "function") {
      return;
    }
    (setter as (key: string, val: string) => void).call(el, name, value);
  } catch {
    // Attribute write best-effort: the text update below still lands.
  }
}

/** Create one element via the document (null when shorn). */
function makeEl(doc: Document, tag: string): unknown {
  try {
    const creator = (doc as unknown as { createElement?: unknown }).createElement;
    if (typeof creator !== "function") {
      return null;
    }
    const el = (creator as (t: string) => unknown).call(doc, tag);
    return el !== null && typeof el === "object" ? el : null;
  } catch {
    return null;
  }
}

/** Append a child (false when the parent cannot take it). */
function appendKid(parent: unknown, kid: unknown): boolean {
  try {
    if (parent === null || typeof parent !== "object") {
      return false;
    }
    if (kid === null || typeof kid !== "object") {
      return false;
    }
    const appender = (parent as { appendChild?: unknown }).appendChild;
    if (typeof appender !== "function") {
      return false;
    }
    (appender as (k: unknown) => void).call(parent, kid);
    return true;
  } catch {
    return false;
  }
}

/** First child of a row whose class list contains the name. */
function childByClass(row: unknown, name: string): unknown {
  try {
    if (row === null || typeof row !== "object") {
      return null;
    }
    const kids = (row as { children?: unknown; childNodes?: unknown }).children;
    const list: ArrayLike<unknown> =
      kids !== null && typeof kids === "object" && typeof (kids as ArrayLike<unknown>).length === "number"
        ? (kids as ArrayLike<unknown>)
        : [];
    for (let i = 0; i < list.length; i += 1) {
      const kid = list[i];
      if (kid === null || typeof kid !== "object") {
        continue;
      }
      const cls = (kid as { className?: unknown }).className;
      if (typeof cls === "string") {
        for (const part of cls.split(/\s+/)) {
          if (part === name) {
            return kid;
          }
        }
      }
    }
    try {
      const query = (row as { querySelector?: unknown }).querySelector;
      if (typeof query === "function") {
        const found = (query as (sel: string) => unknown).call(row, `.${name}`);
        if (found !== null && typeof found === "object") {
          return found;
        }
      }
    } catch {
      // Children scan missed: no slot to paint.
    }
    return null;
  } catch {
    return null;
  }
}

/** All locker rows: every node carrying a `data-locker` attribute. */
/** Direct selector fallback for a row slot (bypasses the children scan). */
function directSlot(row: unknown, selector: string): unknown {
  try {
    if (row === null || typeof row !== "object") {
      return null;
    }
    const query = (row as { querySelector?: unknown }).querySelector;
    if (typeof query !== "function") {
      return null;
    }
    const found = (query as (sel: string) => unknown).call(row, selector);
    return found !== null && typeof found === "object" ? found : null;
  } catch {
    return null;
  }
}
function panelRows(doc: Document, panel: unknown): unknown[] {
  const rows: unknown[] = [];
  try {
    const query = (doc as unknown as { querySelectorAll?: unknown }).querySelectorAll;
    if (typeof query === "function") {
      const found = (query as (sel: string) => unknown).call(doc, `[${LOCKER_ITEM_ATTR}]`);
      if (found !== null && typeof found === "object") {
        const list = found as ArrayLike<unknown>;
        if (typeof list.length === "number") {
          for (let i = 0; i < list.length; i += 1) {
            const row = list[i];
            if (row !== null && typeof row === "object") {
              rows.push(row);
            }
          }
          return rows;
        }
        if (typeof (found as Iterable<unknown>)[Symbol.iterator] === "function") {
          for (const row of found as Iterable<unknown>) {
            if (row !== null && typeof row === "object") {
              rows.push(row);
            }
          }
          return rows;
        }
      }
    }
  } catch {
    // Selector surface shorn: fall back to the panel children below.
  }
  try {
    const grid = byId(doc, LOCKER_GRID_ID);
    const scope = grid !== null && typeof grid === "object" ? grid : panel;
    if (scope !== null && typeof scope === "object") {
      const kids = (scope as { children?: unknown }).children;
      if (kids !== null && typeof kids === "object" && typeof (kids as ArrayLike<unknown>).length === "number") {
        const list = kids as ArrayLike<unknown>;
        for (let i = 0; i < list.length; i += 1) {
          const row = list[i];
          if (row !== null && typeof row === "object" && getAttr(row, LOCKER_ITEM_ATTR) !== "") {
            rows.push(row);
          }
        }
      }
    }
  } catch {
    // Children unreadable: the panel stays as-is.
  }
  return rows;
}

/**
 * Build one locker row node: `<button class="locker-item"
 * data-locker="<id>">` with label, combo/`LOCKED`, and requirement
 * spans. Buttons stay focusable so keyboard probes can equip rows.
 */
function buildRow(doc: Document, item: LockerItem): unknown {
  const row = makeEl(doc, "button");
  if (row === null) {
    return null;
  }
  setAttr(row, LOCKER_ITEM_ATTR, item.id);
  setAttr(row, "data-palette", item.palette);
  setAttr(row, "data-helmet", item.helmet);
  setAttr(row, "data-visor", item.visor);
  try {
    (row as { className?: unknown }).className = "locker-item";
    (row as { type?: unknown }).type = "button";
  } catch {
    // Class best-effort: the attribute marker still selects the row.
  }
  const swatch = makeEl(doc, "span");
  if (swatch !== null) {
    try {
      (swatch as { className?: unknown }).className = "locker-swatch";
    } catch {
      // Class best-effort only.
    }
    setAttr(swatch, "data-palette", item.palette);
    setAttr(swatch, "aria-hidden", "true");
    setStyle(swatch, "background", item.palette);
    appendKid(row, swatch);
  }
  const label = makeEl(doc, "span");
  if (label !== null) {
    try {
      (label as { className?: unknown }).className = "locker-label";
    } catch {
      // Class best-effort only.
    }
    setText(label, item.label);
    appendKid(row, label);
  }
  const combo = makeEl(doc, "span");
  if (combo !== null) {
    try {
      (combo as { className?: unknown }).className = "locker-combo";
    } catch {
      // Class best-effort only.
    }
    setText(combo, `${item.helmet} ${item.visor} ${item.palette}`);
    appendKid(row, combo);
  }
  const lock = makeEl(doc, "span");
  if (lock !== null) {
    try {
      (lock as { className?: unknown }).className = "locker-lock";
    } catch {
      // Class best-effort only.
    }
    setText(lock, `Lv ${Math.max(1, Math.floor(item.level))}`);
    appendKid(row, lock);
  }
  return row;
}

/**
 * Paint a palette swatch into a canvas preview (2d context when the
 * harness offers one): helmet dome plus visor slit in the equipped
 * palette over a dark chip, so pixel probes read the palette without
 * depending on text. Shorn contexts still get the data-* attributes
 * and the text fallback below. Never throws.
 */
function paintPreviewCanvas(preview: unknown, item: LockerItem): void {
  try {
    if (preview === null || typeof preview !== "object") {
      return;
    }
    const canvas = preview as {
      getContext?: unknown;
      width?: unknown;
      height?: unknown;
    };
    const getter = canvas.getContext;
    if (typeof getter !== "function") {
      return;
    }
    const ctx = (getter as (kind: string) => unknown).call(preview, "2d") as
      | {
          fillStyle?: unknown;
          fillRect?: unknown;
          beginPath?: unknown;
          arc?: unknown;
          fill?: unknown;
        }
      | null;
    if (ctx === null || typeof ctx !== "object") {
      return;
    }
    const w = typeof canvas.width === "number" && Number.isFinite(canvas.width) ? canvas.width : 96;
    const h = typeof canvas.height === "number" && Number.isFinite(canvas.height) ? canvas.height : 96;
    try {
      if (typeof ctx.fillRect === "function") {
        (ctx as { fillStyle?: unknown }).fillStyle = "#0b1020";
        (ctx.fillRect as (x: number, y: number, ww: number, hh: number) => void).call(ctx, 0, 0, w, h);
        (ctx as { fillStyle?: unknown }).fillStyle = item.palette;
        const domeR = Math.min(w, h) * 0.32;
        if (typeof ctx.beginPath === "function" && typeof ctx.arc === "function" && typeof ctx.fill === "function") {
          (ctx.beginPath as () => void).call(ctx);
          (ctx.arc as (x: number, y: number, r: number, a0: number, a1: number) => void).call(
            ctx, w / 2, h * 0.42, domeR, 0, Math.PI * 2,
          );
          (ctx.fill as () => void).call(ctx);
        } else {
          (ctx.fillRect as (x: number, y: number, ww: number, hh: number) => void).call(
            ctx, w * 0.2, h * 0.15, w * 0.6, h * 0.45,
          );
        }
        // Dark visor slit across the dome (readable visor cue).
        (ctx as { fillStyle?: unknown }).fillStyle = "#0f172a";
        (ctx.fillRect as (x: number, y: number, ww: number, hh: number) => void).call(
          ctx, w * 0.28, h * 0.36, w * 0.44, h * 0.12,
        );
      }
    } catch {
      // Canvas paint best-effort: attributes/text still update.
    }
  } catch {
    // Preview paint never breaks the locker.
  }
}

/**
 * Repaint the setup-reused preview plus the locker canvas from an item:
 * `#cosmetics-preview` keeps its `data-helmet/data-visor/data-palette`
 * contract (text `helmet visor palette`, background tints to the
 * palette), `#locker-preview` mirrors the same triple and paints the
 * swatch, and `#menu-soldier` tints so the menu figure wears the pick.
 * Missing nodes are no-ops. Never throws.
 */
export function updateLockerPreview(doc: Document, id: unknown): string {
  try {
    const item = lockerItemFor(typeof id === "string" ? id : parseLockerId(id))
      ?? lockerItemFor(DEFAULT_LOCKER_ID) as LockerItem;
    const triple = `${item.helmet} ${item.visor} ${item.palette}`;
    const setupPreview = byId(doc, "cosmetics-preview");
    if (setupPreview !== null && typeof setupPreview === "object") {
      setAttr(setupPreview, "data-helmet", item.helmet);
      setAttr(setupPreview, "data-visor", item.visor);
      setAttr(setupPreview, "data-palette", item.palette);
      const text = childByClass(setupPreview, "cosmetics-text");
      if (text !== null) {
        setText(text, triple);
      } else {
        // Skeleton without span hooks: repaint the node text in place
        // (mirrors the setup.ts renderCosmetics contract).
        setText(setupPreview, triple);
      }
      setStyle(setupPreview, "background", item.palette);
      // Equipped id rides a non-row attribute so `[data-locker]`
      // still counts only grid rows (the panelRows contract).
      setAttr(setupPreview, "data-equipped", item.id);
    }
    const preview = byId(doc, LOCKER_PREVIEW_ID);
    if (preview !== null && typeof preview === "object") {
      setAttr(preview, "data-helmet", item.helmet);
      setAttr(preview, "data-visor", item.visor);
      setAttr(preview, "data-palette", item.palette);
      setAttr(preview, "data-equipped", item.id);
      const slot = childByClass(preview, "locker-preview-text");
      if (slot !== null) {
        setText(slot, triple);
      } else if (!("getContext" in (preview as object))) {
        setText(preview, triple);
      }
      setStyle(preview, "background", item.palette);
      paintPreviewCanvas(preview, item);
    }
    // Menu soldier wears the equipped palette (the in-menu showcase).
    try {
      const soldier = byId(doc, "menu-soldier");
      if (soldier !== null && typeof soldier === "object") {
        setStyle(soldier, "background", item.palette);
        setAttr(soldier, "data-palette", item.palette);
        setAttr(soldier, "data-equipped", item.id);
      }
    } catch {
      // Soldier tint best-effort only.
    }
    const status = byId(doc, LOCKER_STATUS_ID);
    if (status !== null && typeof status === "object") {
      setText(status, `Equipped ${item.label} ${item.palette}`);
      setAttr(status, "data-equipped", item.id);
    }
    // Overlay mirror pass (SC-06 two-column body): every extra
    // `.locker-preview` canvas and `.locker-status` line follows the
    // equipped pick. Query-less fakes skip this; never throws.
    try {
      const query = (doc as unknown as { querySelectorAll?: unknown })
        .querySelectorAll;
      if (typeof query === "function") {
        const previews = (query as (sel: string) => unknown).call(
          doc,
          "canvas.locker-preview",
        ) as ArrayLike<unknown> | null;
        const count =
          previews !== null &&
          typeof previews === "object" &&
          typeof (previews as ArrayLike<unknown>).length === "number"
            ? (previews as ArrayLike<unknown>).length
            : 0;
        for (let i = 0; i < count; i += 1) {
          const extra = (previews as ArrayLike<unknown>)[i];
          if (extra === null || typeof extra !== "object" || extra === preview) {
            continue;
          }
          setAttr(extra, "data-helmet", item.helmet);
          setAttr(extra, "data-visor", item.visor);
          setAttr(extra, "data-palette", item.palette);
          setAttr(extra, "data-equipped", item.id);
          setStyle(extra, "background", item.palette);
          paintPreviewCanvas(extra, item);
        }
        const statuses = (query as (sel: string) => unknown).call(
          doc,
          ".locker-status",
        ) as ArrayLike<unknown> | null;
        const total =
          statuses !== null &&
          typeof statuses === "object" &&
          typeof (statuses as ArrayLike<unknown>).length === "number"
            ? (statuses as ArrayLike<unknown>).length
            : 0;
        for (let i = 0; i < total; i += 1) {
          const extra = (statuses as ArrayLike<unknown>)[i];
          if (extra === null || typeof extra !== "object" || extra === status) {
            continue;
          }
          setText(extra, `Equipped ${item.label} ${item.palette}`);
          setAttr(extra, "data-equipped", item.id);
        }
      }
    } catch {
      // Mirror best-effort: the primary nodes above already landed.
    }
    return item.id;
  } catch {
    return DEFAULT_LOCKER_ID;
  }
}

/**
 * Ensure the locker panel exists inside #menu with the title, grid of
 * exactly the catalogue rows, preview canvas, and status line
 * (idempotent; existing rows are never rebuilt). Returns the panel
 * node, or null when #menu is missing. Never throws.
 */
export function ensureLockerPanel(doc: Document): unknown {
  try {
    const existing = byId(doc, LOCKER_PANEL_ID);
    if (existing !== null && typeof existing === "object") {
      try {
        const have = new Set<string>();
        for (const row of panelRows(doc, existing)) {
          const id = getAttr(row, LOCKER_ITEM_ATTR);
          if (id !== "") {
            have.add(id);
          }
        }
        let grid = byId(doc, LOCKER_GRID_ID);
        if (grid === null || typeof grid !== "object") {
          grid = existing;
        }
        for (const item of LOCKER_ITEMS) {
          if (!have.has(item.id)) {
            const row = buildRow(doc, item);
            if (row !== null) {
              appendKid(grid, row);
            }
          }
        }
        if (byId(doc, LOCKER_PREVIEW_ID) === null) {
          const canvas = makeEl(doc, "canvas");
          if (canvas !== null) {
            setAttr(canvas, "id", LOCKER_PREVIEW_ID);
            try {
              (canvas as { id?: unknown }).id = LOCKER_PREVIEW_ID;
              (canvas as { width?: unknown }).width = 96;
              (canvas as { height?: unknown }).height = 96;
            } catch {
              // Size best-effort only.
            }
            appendKid(existing, canvas);
          }
        }
        if (byId(doc, LOCKER_STATUS_ID) === null) {
          const status = makeEl(doc, "span");
          if (status !== null) {
            setAttr(status, "id", LOCKER_STATUS_ID);
            try {
              (status as { id?: unknown }).id = LOCKER_STATUS_ID;
            } catch {
              // Id best-effort only.
            }
            appendKid(existing, status);
          }
        }
      } catch {
        // Top-up best-effort: the skeleton rows still render.
      }
      return existing;
    }
    const menu = byId(doc, "menu");
    if (menu === null || typeof menu !== "object") {
      return null;
    }
    const panel = makeEl(doc, "div");
    if (panel === null) {
      return null;
    }
    setAttr(panel, "id", LOCKER_PANEL_ID);
    try {
      (panel as { id?: unknown }).id = LOCKER_PANEL_ID;
    } catch {
      // Id assignment best-effort: the attribute still selects it.
    }
    setStyle(panel, "display", "none");
    const title = makeEl(doc, "span");
    if (title !== null) {
      setAttr(title, "id", LOCKER_TITLE_ID);
      try {
        (title as { id?: unknown }).id = LOCKER_TITLE_ID;
      } catch {
        // Id best-effort only.
      }
      setText(title, "Cosmetics Locker");
      appendKid(panel, title);
    }
    const grid = makeEl(doc, "div");
    if (grid !== null) {
      setAttr(grid, "id", LOCKER_GRID_ID);
      try {
        (grid as { id?: unknown }).id = LOCKER_GRID_ID;
      } catch {
        // Id best-effort only.
      }
      for (const item of LOCKER_ITEMS) {
        const row = buildRow(doc, item);
        if (row !== null) {
          appendKid(grid, row);
        }
      }
      appendKid(panel, grid);
    }
    const preview = makeEl(doc, "canvas");
    if (preview !== null) {
      setAttr(preview, "id", LOCKER_PREVIEW_ID);
      try {
        (preview as { id?: unknown }).id = LOCKER_PREVIEW_ID;
        (preview as { width?: unknown }).width = 96;
        (preview as { height?: unknown }).height = 96;
      } catch {
        // Size best-effort only.
      }
      // Attribute triple for canvas-blind harnesses (non-row attrs
      // so the row count stays exactly the catalogue size).
      const fallback = lockerItemFor(DEFAULT_LOCKER_ID) as LockerItem;
      setAttr(preview, "data-helmet", fallback.helmet);
      setAttr(preview, "data-visor", fallback.visor);
      setAttr(preview, "data-palette", fallback.palette);
      setAttr(preview, "data-equipped", fallback.id);
      appendKid(panel, preview);
    }
    const status = makeEl(doc, "span");
    if (status !== null) {
      setAttr(status, "id", LOCKER_STATUS_ID);
      try {
        (status as { id?: unknown }).id = LOCKER_STATUS_ID;
      } catch {
        // Id best-effort only.
      }
      setText(status, `Equipped ${(lockerItemFor(DEFAULT_LOCKER_ID) as LockerItem).label}`);
      appendKid(panel, status);
    }
    if (!appendKid(menu, panel)) {
      return null;
    }
    return panel;
  } catch {
    return null;
  }
}

/** Mirror the live locker onto window.__locker (best-effort). */
function mirrorLocker(selected: string, level: number, challenges: unknown): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    const item = lockerItemFor(selected) ?? lockerItemFor(DEFAULT_LOCKER_ID) as LockerItem;
    const surface: Record<string, unknown> = {
      selected: item.id,
      id: item.id,
      palette: item.palette,
      helmet: item.helmet,
      visor: item.visor,
      level,
      rows: lockerRows(level, challenges),
    };
    const current = (window as unknown as Record<string, unknown>)["__locker"] as
      | Record<string, unknown>
      | undefined;
    if (current !== undefined && current !== null && typeof current === "object") {
      Object.assign(current, surface);
    } else {
      (window as unknown as Record<string, unknown>)["__locker"] = surface;
    }
  } catch {
    // Probe mirror best-effort only.
  }
}

/** True while the locker panel overlay is on screen. */
function isPanelVisible(panel: unknown): boolean {
  try {
    if (panel === null || typeof panel !== "object") {
      return false;
    }
    const style = (panel as { style?: { display?: unknown } }).style;
    if (style === null || style === undefined || typeof style !== "object") {
      return false;
    }
    return style.display !== "none";
  } catch {
    return false;
  }
}

/**
 * Repaint the locker rows from a level plus challenge state: each
 * `data-locker` row carries `data-locked`, its lock span reads `LOCKED`
 * (or the `Lv N` gate), the combo span reads the triple, and the
 * equipped row carries `data-selected`. Rows are never rebuilt here.
 * The setup-reused preview follows the equipped pick. Mirrors
 * `window.__locker`. Returns the painted row count. Never throws.
 */
export function updateLockerPanel(
  doc: Document,
  level: unknown,
  challenges?: unknown,
  selected?: unknown,
): number {
  try {
    const panel = ensureLockerPanel(doc);
    if (panel === null || typeof panel !== "object") {
      return 0;
    }
    const have = parseLevelField(level);
    const equipped = parseLockerId(
      typeof selected === "string" && selected.trim() !== "" ? selected : DEFAULT_LOCKER_ID,
    );
    const rows = lockerRows(have, challenges);
    const byRow = new Map<string, LockerRow>();
    for (const row of rows) {
      byRow.set(row.id, row);
    }
    const nodes = panelRows(doc, panel);
    let painted = 0;
    for (const node of nodes) {
      const id = getAttr(node, LOCKER_ITEM_ATTR);
      const item = lockerItemFor(id);
      const probe = byRow.get(id);
      if (item === undefined || probe === undefined) {
        continue;
      }
      const locked = probe.locked;
      setAttr(node, "data-locked", locked ? "true" : "false");
      setAttr(node, "data-palette", item.palette);
      setAttr(node, "data-helmet", item.helmet);
      setAttr(node, "data-visor", item.visor);
      setAttr(node, "data-level", String(item.level));
      if (item.challenge !== undefined) {
        // Namespaced separately from the challenges panel's
        // `data-challenge` (which that binder repaints by selector):
        // sharing the name would let the challenge repaint hijack
        // locker rows with the same template ids.
        setAttr(node, "data-require", item.challenge);
      }
      if (equipped === item.id) {
        setAttr(node, "data-selected", "true");
        setAttr(node, "aria-pressed", "true");
      } else {
        try {
          const remover = (node as { removeAttribute?: unknown }).removeAttribute;
          if (typeof remover === "function") {
            (remover as (k: string) => void).call(node, "data-selected");
          }
        } catch {
          setAttr(node, "data-selected", "false");
        }
        setAttr(node, "aria-pressed", "false");
      }
      const lockSlot =
        childByClass(node, "locker-lock") ?? directSlot(node, ".locker-lock");
      if (lockSlot !== null) {
        setText(lockSlot, locked ? "LOCKED" : `Lv ${item.level}`);
      }
      // Non-destructive: skeletons without span hooks keep their static
      // LOCKED readout (never overwrite the whole row, which would drop
      // the spans for later repaints).
      const comboSlot =
        childByClass(node, "locker-combo") ?? directSlot(node, ".locker-combo");
      if (comboSlot !== null) {
        setText(comboSlot, locked ? `LOCKED \u00b7 Lv ${item.level}` : `${item.helmet} ${item.visor} ${item.palette}`);
      }
      painted += 1;
    }
    updateLockerPreview(doc, equipped);
    mirrorLocker(equipped, have, challenges);
    return painted;
  } catch {
    return 0;
  }
}

/**
 * Ensure the locker opener exists as a child of #menu
 * (`<button id="locker-open">`). Idempotent; missing parents read
 * null. Never throws.
 */
export function ensureLockerOpen(doc: Document): unknown {
  try {
    const existing = byId(doc, LOCKER_OPEN_ID);
    if (existing !== null && typeof existing === "object") {
      return existing;
    }
    const menu = byId(doc, "menu");
    if (menu === null || typeof menu !== "object") {
      return null;
    }
    const opener = makeEl(doc, "button");
    if (opener === null) {
      return null;
    }
    setAttr(opener, "id", LOCKER_OPEN_ID);
    try {
      (opener as { id?: unknown }).id = LOCKER_OPEN_ID;
      (opener as { type?: unknown }).type = "button";
    } catch {
      // Id best-effort only.
    }
    setText(opener, "Locker");
    if (!appendKid(menu, opener)) {
      return null;
    }
    return opener;
  } catch {
    return null;
  }
}

/**
 * Apply one locker tab filter: tabs read `aria-pressed` for the
 * active filter while rows outside it read `display: none`. Query-less
 * fakes are no-ops. Returns the applied tab. Never throws.
 */
export function applyLockerTab(doc: Document, tab: unknown): LockerTab {
  const active = parseLockerTab(tab);
  try {
    const panel = ensureLockerPanel(doc);
    const query = (doc as unknown as { querySelectorAll?: unknown })
      .querySelectorAll;
    if (typeof query !== "function") {
      return active;
    }
    const tabs = (query as (sel: string) => unknown).call(
      doc,
      `[${LOCKER_TAB_ATTR}]`,
    ) as ArrayLike<unknown> | null;
    const tabCount =
      tabs !== null &&
      typeof tabs === "object" &&
      typeof (tabs as ArrayLike<unknown>).length === "number"
        ? (tabs as ArrayLike<unknown>).length
        : 0;
    for (let i = 0; i < tabCount; i += 1) {
      const node = (tabs as ArrayLike<unknown>)[i];
      if (node === null || typeof node !== "object") {
        continue;
      }
      const name = parseLockerTab(getAttr(node, LOCKER_TAB_ATTR));
      setAttr(node, "aria-pressed", name === active ? "true" : "false");
    }
    for (const row of panelRows(doc, panel)) {
      try {
        const locked = getAttr(row, "data-locked") === "true";
        const show =
          active === "all" || (active === "locked" ? locked : !locked);
        setStyle(row, "display", show ? "" : "none");
      } catch {
        // One stuck row never blocks the rest.
      }
    }
  } catch {
    // Filter best-effort: the rows still render unfiltered.
  }
  return active;
}

/**
 * Wire the cosmetics locker: ensure the opener plus panel DOM, paint
 * from storage (profile level + challenge state + equipped id),
 * mirror `window.__locker`, repaint the setup-reused preview on every
 * equip, filter rows from the tab bar, confirm picks from the equip
 * button, and persist equips to LOCKER_KEY (plain id). Locked rows are
 * not equippable; missing elements are no-ops; listeners attach once.
 * Never throws.
 */
export function bindLocker(
  doc: Document,
  storage: LockerStorage | null | undefined,
): LockerBinder {
  const binder: LockerBinder = {
    selected: loadLockerSelection(storage),
    level: lockerLevel(storage),
    select: (): string => binder.selected,
    refresh: (): string => "",
    stop: (): void => {},
  };

  const currentChallenges = (): unknown => lockerChallenges(storage);

  const repaint = (selected: string): string => {
    try {
      const level = lockerLevel(storage);
      const challenges = currentChallenges();
      binder.selected = parseLockerId(selected);
      binder.level = level;
      updateLockerPanel(doc, level, challenges, binder.selected);
      updateLockerPreview(doc, binder.selected);
      mirrorLocker(binder.selected, level, challenges);
      return binder.selected;
    } catch {
      return binder.selected;
    }
  };

  binder.select = (id: unknown): string => {
    try {
      const item = lockerItemFor(typeof id === "string" ? id : parseLockerId(id));
      if (item === undefined) {
        return binder.selected;
      }
      const level = lockerLevel(storage);
      if (!isLockerUnlocked(item, level, currentChallenges())) {
        return binder.selected;
      }
      saveLockerSelection(storage, item.id);
      // Legacy setup-preview sync (issue #212 reuses the setup preview):
      // mirror the pick into `scrapline.cosmetics.v1` so a later
      // setup show() prefills the same triple without waiting for
      // the next match start (best-effort, never breaks the equip).
      try {
        storage?.setItem?.(
          "scrapline.cosmetics.v1",
          JSON.stringify({ helmet: item.helmet, visor: item.visor, palette: item.palette }),
        );
      } catch {
        // Private-mode storage: the locker key above still lands.
      }
      return repaint(item.id);
    } catch {
      return binder.selected;
    }
  };

  binder.refresh = (): string => {
    try {
      const stored = loadLockerSelection(storage);
      return repaint(stored);
    } catch {
      return binder.selected;
    }
  };

  try {
    ensureLockerOpen(doc);
  } catch {
    // Opener optional: the panel still paints underneath.
  }
  try {
    ensureLockerPanel(doc);
  } catch {
    // Static skeleton suffices: the paint below still mirrors.
  }
  try {
    repaint(binder.selected);
  } catch {
    // Initial paint best-effort only.
  }

  // Row equips: delegate from the panel so topped-up skeleton rows
  // added after bind still equip (one listener, never per-row).
  try {
    const panel = ensureLockerPanel(doc);
    if (panel !== null && typeof panel === "object") {
      if (getAttr(panel, "data-locker-bound") !== "true") {
        setAttr(panel, "data-locker-bound", "true");
        const listen = (panel as { addEventListener?: unknown }).addEventListener;
        if (typeof listen === "function") {
          (listen as (type: string, fn: (ev: unknown) => void) => void).call(
            panel,
            "click",
            (ev: unknown) => {
              try {
                let target: unknown = null;
                if (ev !== null && typeof ev === "object") {
                  target = (ev as { target?: unknown }).target
                    ?? (ev as { srcElement?: unknown }).srcElement
                    ?? null;
                }
                // Walk up at most 3 ancestors to the data-locker row
                // (clicks land on the inner label/combo/lock spans).
                for (let depth = 0; depth < 4; depth += 1) {
                  if (target === null || typeof target !== "object") {
                    break;
                  }
                  const id = getAttr(target, LOCKER_ITEM_ATTR);
                  if (id !== "") {
                    binder.select(id);
                    break;
                  }
                  const parent = (target as { parentNode?: unknown; parentElement?: unknown }).parentNode
                    ?? (target as { parentElement?: unknown }).parentElement
                    ?? null;
                  if (parent === null || typeof parent !== "object") {
                    break;
                  }
                  target = parent;
                }
              } catch {
                // Equip best-effort: the panel still renders.
              }
            },
          );
        }
      }
    }
  } catch {
    // Delegation optional: direct row hooks below still equip.
  }

  // Direct row hooks for fake-doc harnesses without bubbling.
  try {
    for (const row of panelRows(doc, ensureLockerPanel(doc))) {
      try {
        if (getAttr(row, "data-locker-hooked") === "true") {
          continue;
        }
        setAttr(row, "data-locker-hooked", "true");
        const listen = (row as { addEventListener?: unknown }).addEventListener;
        if (typeof listen === "function") {
          (listen as (type: string, fn: () => void) => void).call(row, "click", () => {
            try {
              binder.select(getAttr(row, LOCKER_ITEM_ATTR));
            } catch {
              // Equip best-effort only.
            }
          });
        }
      } catch {
        // One bad row never breaks the rest.
      }
    }
  } catch {
    // Direct hooks best-effort only.
  }

  try {
    const opener = byId(doc, LOCKER_OPEN_ID);
    if (opener === null || typeof opener !== "object") {
      ensureLockerOpen(doc);
    }
    const toggle = byId(doc, LOCKER_OPEN_ID);
    if (toggle !== null && typeof toggle === "object") {
      if (getAttr(toggle, "data-locker-bound") !== "true") {
        setAttr(toggle, "data-locker-bound", "true");
        const listen = (toggle as { addEventListener?: unknown }).addEventListener;
        if (typeof listen === "function") {
          (listen as (type: string, fn: () => void) => void).call(toggle, "click", () => {
            try {
              const panel = ensureLockerPanel(doc);
              if (panel === null || typeof panel !== "object") {
                return;
              }
              if (isPanelVisible(panel)) {
                setStyle(panel, "display", "none");
                return;
              }
              repaint(loadLockerSelection(storage));
              setStyle(panel, "display", "");
            } catch {
              // Toggle best-effort: the menu still works.
            }
          });
        }
      }
    }
  } catch {
    // Opener optional: the panel still paints underneath.
  }
  // Tab bar: one filter listener per tab (All / Unlocked / Locked).
  // Missing tabs are no-ops; listeners attach once per id.
  try {
    const query = (doc as unknown as { querySelectorAll?: unknown })
      .querySelectorAll;
    if (typeof query === "function") {
      const tabs = (query as (sel: string) => unknown).call(
        doc,
        `[${LOCKER_TAB_ATTR}]`,
      ) as ArrayLike<unknown> | null;
      const count =
        tabs !== null &&
        typeof tabs === "object" &&
        typeof (tabs as ArrayLike<unknown>).length === "number"
          ? (tabs as ArrayLike<unknown>).length
          : 0;
      for (let i = 0; i < count; i += 1) {
        try {
          const tab = (tabs as ArrayLike<unknown>)[i];
          if (tab === null || typeof tab !== "object") {
            continue;
          }
          if (getAttr(tab, "data-locker-tab-bound") === "true") {
            continue;
          }
          setAttr(tab, "data-locker-tab-bound", "true");
          const listen = (tab as { addEventListener?: unknown })
            .addEventListener;
          if (typeof listen === "function") {
            (listen as (type: string, fn: () => void) => void).call(
              tab,
              "click",
              () => {
                try {
                  applyLockerTab(doc, getAttr(tab, LOCKER_TAB_ATTR));
                } catch {
                  // Filter best-effort only.
                }
              },
            );
          }
        } catch {
          // One bad tab never blocks the rest.
        }
      }
    }
  } catch {
    // Tabs optional: the grid still renders unfiltered.
  }
  // Equip button: confirm the previewed pick (idempotent when the
  // preview already follows the equipped row). Missing button is a
  // no-op; the listener attaches once.
  try {
    const equip = byId(doc, LOCKER_EQUIP_ID);
    if (equip !== null && typeof equip === "object") {
      if (getAttr(equip, "data-locker-bound") !== "true") {
        setAttr(equip, "data-locker-bound", "true");
        const listen = (equip as { addEventListener?: unknown })
          .addEventListener;
        if (typeof listen === "function") {
          (listen as (type: string, fn: () => void) => void).call(
            equip,
            "click",
            () => {
              try {
                const preview = byId(doc, LOCKER_PREVIEW_FULL_ID);
                const id =
                  preview !== null && typeof preview === "object"
                    ? getAttr(preview, "data-equipped")
                    : "";
                binder.select(id !== "" ? id : binder.selected);
              } catch {
                // Equip best-effort only.
              }
            },
          );
        }
      }
    }
  } catch {
    // Equip optional: row clicks still equip directly.
  }
  return binder;
}
