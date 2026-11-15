// Local profile model: editable pilot name plus avatar palette persisted
// to localStorage, with XP/level progression awarded on match end. Parsing
// is DOM-free (unit-testable under node like setup.ts); the badge/editor
// binder mirrors the settings.ts pattern (null-safe lookups, missing
// elements are no-ops, listeners attach once). The sim stays untouched:
// main.ts owns the storage handle and passes the resolved name down, so
// the pure hud/nametag helpers never read storage themselves.

import { PALETTE_LIST } from "../cosmetics";

/** localStorage key holding the profile JSON object. */
export const PROFILE_KEY = "scrapline.profile";

/** XP for winning a match (local id 0 tops the standings). */
export const XP_WIN = 50;
/** XP per kill scored by the local player. */
export const XP_KILL = 10;
/** XP for completing a match (the authoritative matchEnd edge). */
export const XP_COMPLETE = 20;
/** XP per level: level = 1 + floor(xp / 100). */
export const XP_PER_LEVEL = 100;

/** Max stored name length; longer inputs truncate. */
export const PROFILE_NAME_MAX = 16;

/** Avatar palettes in menu order (reuses the cosmetics source). */
export const PROFILE_PALETTES: readonly string[] = PALETTE_LIST;

/** One persisted local profile: display name, avatar palette, XP. */
export interface Profile {
  name: string;
  palette: string;
  xp: number;
}

/** First-visit (and corrupt-storage) defaults: anonymous cyan rookie. */
export const DEFAULT_PROFILE: Profile = {
  name: "",
  palette: "#00E5FF",
  xp: 0,
};

/** Minimal storage surface so tests can pass a fake (no DOM needed). */
export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Match outcome feeding the XP award: win, local kills, completion. */
export interface MatchResult {
  win: boolean;
  kills: number;
  completed: boolean;
}

/**
 * Tolerantly normalize an unknown value into a pilot name: trimmed,
 * printable-only (control chars stripped), truncated to 16 chars.
 * Empty or non-string input falls back to "" (which renders as You).
 */
export function parseProfileName(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_PROFILE.name;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return DEFAULT_PROFILE.name;
  }
  let clean = "";
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) {
      continue;
    }
    clean += ch;
  }
  clean = clean.trim();
  if (clean === "") {
    return DEFAULT_PROFILE.name;
  }
  return [...clean].slice(0, PROFILE_NAME_MAX).join("");
}

/** True for a verbatim #RRGGBB hex string (any palette, not just listed). */
function isHexPalette(value: string): boolean {
  if (value.length !== 7 || value[0] !== "#") {
    return false;
  }
  for (let i = 1; i < 7; i += 1) {
    const code = value.charCodeAt(i);
    const digit =
      code >= 48 && code <= 57 ? true : code >= 65 && code <= 70 ? true : code >= 97 && code <= 102;
    if (!digit) {
      return false;
    }
  }
  return true;
}

/**
 * Tolerantly normalize an unknown value into an avatar palette: listed
 * entries return canonically, any other valid #RRGGBB is kept verbatim,
 * everything else falls back to local-cyan.
 */
export function parseProfilePalette(value: unknown): string {
  if (typeof value === "string") {
    const key = value.trim();
    for (const entry of PALETTE_LIST) {
      if (entry.toUpperCase() === key.toUpperCase()) {
        return entry;
      }
    }
    if (isHexPalette(key)) {
      return key;
    }
  }
  return DEFAULT_PROFILE.palette;
}

/**
 * Tolerantly normalize an unknown value into XP: finite numbers and
 * numeric strings floor into >= 0, everything else falls back to 0.
 */
export function parseProfileXp(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    if (value.trim() === "") {
      return DEFAULT_PROFILE.xp;
    }
    n = Number(value);
  } else {
    return DEFAULT_PROFILE.xp;
  }
  if (!Number.isFinite(n)) {
    return DEFAULT_PROFILE.xp;
  }
  return Math.max(0, Math.floor(n));
}

/** Tolerantly normalize an unknown value into a 1-based level. */
function parseLevelField(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    if (value.trim() === "") {
      return 0;
    }
    n = Number(value);
  } else {
    return 0;
  }
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

/**
 * XP threshold for a 1-based level: level 1 starts at 0, each further
 * level costs another 100 XP. Non-positive levels read 0.
 */
export function xpForLevel(level: unknown): number {
  const n = parseLevelField(level);
  if (n <= 1) {
    return 0;
  }
  return (n - 1) * XP_PER_LEVEL;
}

/**
 * Tolerantly normalize an unknown value into a profile: each corrupt
 * field falls back independently (the parseSetup idiom). An explicit
 * stored `level` backfills `xp` up to at least its threshold, so a
 * probe seeding either `{"xp":200}` or `{"level":3}` reads `Lv 3`.
 */
export function parseProfile(value: unknown): Profile {
  const rec =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const xp = parseProfileXp(rec["xp"]);
  const backfill = xpForLevel(rec["level"]);
  return {
    name: parseProfileName(rec["name"]),
    palette: parseProfilePalette(rec["palette"]),
    xp: Math.max(xp, backfill),
  };
}

/** Null-safe read: storage errors (or absence) yield null. */
function safeGet(
  storage: ProfileStorage | null | undefined,
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
 * Load the persisted profile; missing, corrupt, or unreadable values
 * fall back to DEFAULT_PROFILE per field. Invalid JSON is a plain
 * fallback (never throws), so the menu still renders.
 */
export function loadProfile(
  storage: ProfileStorage | null | undefined,
): Profile {
  const raw = safeGet(storage, PROFILE_KEY);
  if (raw === null || raw.trim() === "") {
    return { ...DEFAULT_PROFILE };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ...DEFAULT_PROFILE };
  }
  return parseProfile(parsed);
}

/**
 * Persist the (normalized) profile as one JSON object holding exactly
 * `{name, palette, xp}`; storage errors are swallowed.
 */
export function saveProfile(
  storage: ProfileStorage | null | undefined,
  profile: Profile,
): void {
  if (storage === null || storage === undefined) {
    return;
  }
  const parsed = parseProfile(profile);
  try {
    storage.setItem(
      PROFILE_KEY,
      JSON.stringify({ name: parsed.name, palette: parsed.palette, xp: parsed.xp }),
    );
  } catch {
    // Private-mode storage: the match still starts, just not persisted.
  }
}

/**
 * XP earned for one match outcome: 50 on a win, 10 per local kill,
 * 20 on completion. Negative kill counts clamp to 0.
 */
export function xpForMatch(result: MatchResult): number {
  const rec =
    typeof result === "object" && result !== null
      ? (result as unknown as Record<string, unknown>)
      : {};
  const win = rec["win"] === true;
  const completed = rec["completed"] === true;
  let kills = 0;
  const rawKills = rec["kills"];
  if (typeof rawKills === "number" && Number.isFinite(rawKills)) {
    kills = Math.max(0, Math.floor(rawKills));
  }
  return (win ? XP_WIN : 0) + kills * XP_KILL + (completed ? XP_COMPLETE : 0);
}

/**
 * Level for an XP total: linear `1 + floor(xp / 100)`, minimum 1.
 */
export function levelForXp(xp: unknown): number {
  return 1 + Math.floor(parseProfileXp(xp) / XP_PER_LEVEL);
}

/** Level for a profile (tolerantly normalized first). */
export function profileLevel(profile: unknown): number {
  return levelForXp(parseProfile(profile).xp);
}

/**
 * Menu badge text for a level: exactly `Lv N`, minimum `Lv 1`.
 */
export function formatLevelBadge(level: unknown): string {
  const n = parseLevelField(level);
  return `Lv ${n >= 1 ? n : 1}`;
}

/**
 * Award one match outcome onto a profile: adds `xpForMatch` to the
 * (normalized, level-backfilled) stored XP and returns the new profile.
 */
export function awardMatchXp(profile: unknown, result: MatchResult): Profile {
  const base = parseProfile(profile);
  return { ...base, xp: base.xp + xpForMatch(result) };
}

/** Menu badge element id (child of #menu). */
export const PROFILE_BADGE_ID = "profile-badge";
/** Profile name input id (child of #menu). */
export const PROFILE_NAME_ID = "profile-name";
/** Profile palette select id (child of #menu). */
export const PROFILE_PALETTE_ID = "profile-palette";

/** Live binder state returned by bindProfile. */
export interface ProfileBinder {
  /** Current profile (updated by the editor inputs). */
  profile: Profile;
  /** Palette select handle (null when the editor is absent). */
  select: unknown;
  /** Re-read storage, repaint the badge, mirror the probe; returns badge text. */
  refresh(): string;
  /** Detach nothing (listeners attach once); keeps the scene.ts shape. */
  stop(): void;
}

/** Minimal text-input surface; the real HTMLInputElement satisfies it. */
interface InputLike {
  value: string;
  addEventListener(type: string, listener: () => void): void;
}

/** Narrow an unknown handle to the text-input surface; else null. */
function asInput(el: unknown): InputLike | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const candidate = el as {
    value?: unknown;
    addEventListener?: unknown;
  };
  if (typeof candidate.value !== "string") {
    return null;
  }
  if (typeof candidate.addEventListener !== "function") {
    return null;
  }
  return candidate as InputLike;
}

/** Null-safe id lookup: shorn documents read null instead of throwing. */
function byId(doc: Document, id: string): unknown {
  try {
    const byId = (doc as unknown as { getElementById?: unknown }).getElementById;
    if (typeof byId !== "function") {
      return null;
    }
    return (byId as (key: string) => unknown).call(doc, id);
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
  if (typeof style !== "object" || style === null) {
    return;
  }
  (style as Record<string, unknown>)[name] = value;
}

/** Mirror the profile into window.__profile for black-box probes. */
function mirrorProfile(profile: Profile, badge: string): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    (window as unknown as Record<string, unknown>)["__profile"] = {
      name: profile.name,
      palette: profile.palette,
      xp: profile.xp,
      level: levelForXp(profile.xp),
      badge,
    };
  } catch {
    // Probe mirror best-effort only.
  }
}

/**
 * Ensure the menu level badge exists as a child of #menu. Creates
 * `<span id="profile-badge">` on first call (idempotent, prepend-safe);
 * missing parents or shorn documents read null instead of throwing.
 */
export function ensureProfileBadge(doc: Document): unknown {
  try {
    const existing = byId(doc, PROFILE_BADGE_ID);
    if (existing !== null && typeof existing === "object") {
      return existing;
    }
    const menu = byId(doc, "menu");
    if (menu === null || typeof menu !== "object") {
      return null;
    }
    const creator = (doc as unknown as { createElement?: unknown }).createElement;
    if (typeof creator !== "function") {
      return null;
    }
    const badge = (creator as (tag: string) => unknown).call(doc, "span");
    if (badge === null || typeof badge !== "object") {
      return null;
    }
    try {
      const setAttr = (
        badge as { setAttribute?: (name: string, value: string) => void }
      ).setAttribute;
      if (typeof setAttr === "function") {
        setAttr.call(badge, "id", PROFILE_BADGE_ID);
      }
      (badge as { id?: unknown }).id = PROFILE_BADGE_ID;
    } catch {
      // Id assignment best-effort: the text update below still lands.
    }
    try {
      const appender = (menu as { appendChild?: unknown }).appendChild;
      if (typeof appender !== "function") {
        return null;
      }
      const prepender = (menu as { prepend?: unknown }).prepend;
      if (typeof prepender === "function") {
        (prepender as (kid: unknown) => void).call(menu, badge);
      } else {
        (appender as (kid: unknown) => void).call(menu, badge);
      }
      return badge;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Repaint the menu badge from a profile: text reads `Lv N` and the
 * background tints to the avatar palette. Returns the rendered text
 * (empty when the badge is absent). Never throws.
 */
export function updateProfileBadge(
  doc: Document,
  profile: unknown,
): string {
  try {
    const parsed = parseProfile(profile);
    const badge = ensureProfileBadge(doc);
    if (badge === null || typeof badge !== "object") {
      return "";
    }
    const text = formatLevelBadge(levelForXp(parsed.xp));
    setText(badge, text);
    setStyle(badge, "background", parsed.palette);
    mirrorProfile(parsed, text);
    return text;
  } catch {
    return "";
  }
}

/**
 * Wire the menu profile editor: prefill the name input and palette
 * select from storage, persist `input`/`change` edits via saveProfile,
 * repaint the badge, and mirror window.__profile. Missing elements are
 * no-ops; listeners attach once. Never throws.
 */
export function bindProfile(
  doc: Document,
  storage: ProfileStorage | null | undefined,
  onChange?: (profile: Profile) => void,
): ProfileBinder {
  const binder: ProfileBinder = {
    profile: loadProfile(storage),
    select: null,
    refresh: (): string => "",
    stop: (): void => {},
  };

  const repaint = (): string => {
    try {
      const text = updateProfileBadge(doc, binder.profile);
      if (typeof onChange === "function") {
        try {
          onChange({ ...binder.profile });
        } catch {
          // Host callback faults never break the editor.
        }
      }
      return text;
    } catch {
      return "";
    }
  };
  binder.refresh = (): string => {
    try {
      binder.profile = loadProfile(storage);
      const nameInput = asInput(byId(doc, PROFILE_NAME_ID));
      if (nameInput !== null) {
        nameInput.value = binder.profile.name;
      }
      const paletteSelect = asInput(byId(doc, PROFILE_PALETTE_ID));
      if (paletteSelect !== null) {
        paletteSelect.value = binder.profile.palette;
      }
      return repaint();
    } catch {
      return "";
    }
  };

  try {
    const nameInput = asInput(byId(doc, PROFILE_NAME_ID));
    if (nameInput !== null) {
      nameInput.value = binder.profile.name;
      const commitName = (): void => {
        binder.profile = {
          ...binder.profile,
          name: parseProfileName(nameInput.value),
        };
        saveProfile(storage, binder.profile);
        repaint();
      };
      nameInput.addEventListener("input", commitName);
      nameInput.addEventListener("change", commitName);
    }
    {
      const paletteSelect = asInput(byId(doc, PROFILE_PALETTE_ID));
      binder.select = paletteSelect;
      if (paletteSelect !== null) {
        paletteSelect.value = binder.profile.palette;
        const commitPalette = (): void => {
          binder.profile = {
            ...binder.profile,
            palette: parseProfilePalette(paletteSelect.value),
          };
          saveProfile(storage, binder.profile);
          repaint();
        };
        paletteSelect.addEventListener("change", commitPalette);
        paletteSelect.addEventListener("input", commitPalette);
      }
    }
  } catch {
    // Editor optional: the badge below still binds.
  }

  try {
    repaint();
  } catch {
    // Initial paint best-effort only.
  }
  return binder;
}
