// Bottom-right weapon module (issue #152). Pure display model plus a
// thin DOM binder: display names (the SMG reads Hornet SMG), derived
// reserve text (infinite reserve reads 3x mag, so SMG is 32/96),
// grenade pips, and weapon icon paths. DOM-free helpers stay
// unit-testable under node; the binder degrades to no-ops on fake docs
// without builders and never throws.

import { GRENADE_MAX } from "../../../core/src/constants";
import { WEAPONS, type WeaponId } from "../../../core/src/weapons";

/** Display-only reserve multiplier: reloads never deplete the reserve. */
export const AMMO_RESERVE_MULTIPLIER = 3;

/** Weapon ids in the stat table (mirrors WeaponId without importing it). */
const KNOWN_IDS: readonly string[] = [
  "pistol",
  "smg",
  "rifle",
  "shotgun",
  "sniper",
  "rocket",
];

/**
 * Normalize a held-weapon reading to a stat-table id. Case-insensitive
 * and whitespace-tolerant; "Hornet" and "Hornet SMG" resolve to the SMG
 * (the weaponPlaqueFor hornet-alias idiom); unknown readings fall back
 * to the pistol so bad data still renders instead of crashing.
 */
export function normalizeWeaponId(weapon: unknown): WeaponId {
  if (typeof weapon === "string") {
    const key = weapon.trim().toLowerCase();
    if (key.includes("hornet")) {
      return "smg";
    }
    if (KNOWN_IDS.includes(key)) {
      return key as WeaponId;
    }
  }
  return "pistol";
}

/**
 * Display name for a held weapon: the SMG reads Hornet SMG (the probed
 * substring), every other weapon reads its stat-table name.
 */
export function displayNameFor(weapon: unknown): string {
  const id = normalizeWeaponId(weapon);
  if (id === "smg") {
    return "Hornet SMG";
  }
  return WEAPONS[id].name;
}

/**
 * Display-only reserve for a held weapon: 3x the stat-table mag, so
 * the SMG reads 96. The sim stays reserve-free; this is text only.
 */
export function reserveFor(weapon: unknown): number {
  return WEAPONS[normalizeWeaponId(weapon)].mag * AMMO_RESERVE_MULTIPLIER;
}

/**
 * Mag/reserve counts text (`32/96`): the mag clamps at 0 and
 * non-finite readings render 0, so half-built snapshots never blank.
 */
export function formatAmmoCounts(magAmmo: unknown, weapon: unknown): string {
  const mag = Number(magAmmo);
  const clamped = Number.isFinite(mag) ? Math.max(0, Math.floor(mag)) : 0;
  return `${clamped}/${reserveFor(weapon)}`;
}

/**
 * Grenade pip fill states: exactly GRENADE_MAX entries, the first n
 * filled where n clamps the grenade count into [0, GRENADE_MAX].
 */
export function grenadePipStates(grenades: unknown): boolean[] {
  const count = Number(grenades);
  const filled = Number.isFinite(count)
    ? Math.min(GRENADE_MAX, Math.max(0, Math.floor(count)))
    : 0;
  return Array.from({ length: GRENADE_MAX }, (_, index) => index < filled);
}

/**
 * Weapon icon path for a held weapon: the SMG reuses the Hornet card
 * art, every other weapon reads its own card; unknown readings fall
 * back to the pistol card. Relative to the client root (like the
 * displayFontFaceCss asset URL) so file:// and subpath hosts resolve.
 */
export function iconFor(weapon: unknown): string {
  const id = normalizeWeaponId(weapon);
  if (id === "smg") {
    return "./assets/weapon-hornet.svg";
  }
  return `./assets/weapon-${id}.svg`;
}

/** Live ammo values the binder mirrors into the module each frame. */
export interface AmmoSnapshot {
  magAmmo: number;
  weapon: unknown;
  grenades: number;
}

/** Element handles owned by the module; nulls make updates no-op. */
export interface AmmoHandles {
  module: HTMLElement | null;
  icon: HTMLElement | null;
  name: HTMLElement | null;
  counts: HTMLElement | null;
  pips: HTMLElement | null;
}

/** All-null handles for builder-less docs (updateAmmo still no-ops). */
const NULL_AMMO: AmmoHandles = {
  module: null,
  icon: null,
  name: null,
  counts: null,
  pips: null,
};

function byId(
  doc: { getElementById(id: string): unknown },
  id: string,
): HTMLElement | null {
  let el: unknown;
  try {
    el = doc.getElementById(id);
  } catch {
    return null;
  }
  // typeof-guarded: unit tests run under node where HTMLElement is
  // unbound, so a bare instanceof would throw a ReferenceError.
  try {
    if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement) {
      return el;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Grab the module handles; idempotent and safe before match start.
 * Docs without getElementById (or throwing lookups) read all null and
 * never throw, matching the buildHud tolerance.
 */
export function buildAmmo(doc: Document): AmmoHandles {
  if (doc === null || doc === undefined) {
    return { ...NULL_AMMO };
  }
  const lookup = (doc as unknown as { getElementById?(id: string): unknown })
    .getElementById;
  if (typeof lookup !== "function") {
    return { ...NULL_AMMO };
  }
  const scoped = { getElementById: lookup.bind(doc) };
  return {
    module: byId(scoped, "ammo-module"),
    icon: byId(scoped, "ammo-icon"),
    name: byId(scoped, "ammo-name"),
    counts: byId(scoped, "ammo-counts"),
    pips: byId(scoped, "ammo-pips"),
  };
}

/** Read textContent without throwing on hostile shims. */
function readText(el: unknown): string | null {
  try {
    const value = (el as { textContent?: unknown }).textContent;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Write textContent; change-guarded by the caller, never throws. */
function writeText(el: unknown, value: string): void {
  try {
    (el as { textContent?: unknown }).textContent = value;
  } catch {
    // Read-only shims: the data-value fallback below still carries it.
  }
  try {
    const target = el as { setAttribute?(id: string, v: string): void };
    if (typeof target.setAttribute === "function") {
      target.setAttribute("data-value", value);
    }
  } catch {
    // Attribute-less fakes: textContent above still carries the value.
  }
}

/** Read a string attribute or property without throwing. */
function readAttr(el: unknown, attr: "src" | "alt" | "class"): string | null {
  try {
    const target = el as {
      getAttribute?(id: string): unknown;
      src?: unknown;
      alt?: unknown;
      className?: unknown;
    };
    if (typeof target.getAttribute === "function") {
      const viaAttr = target.getAttribute(attr);
      if (typeof viaAttr === "string") {
        return viaAttr;
      }
    }
    const direct =
      attr === "src"
        ? target.src
        : attr === "alt"
          ? target.alt
          : target.className;
    return typeof direct === "string" ? direct : null;
  } catch {
    return null;
  }
}

/** Write a string attribute (plus the matching property when present). */
function writeAttr(el: unknown, attr: "src" | "alt" | "class", value: string): void {
  try {
    const target = el as {
      setAttribute?(id: string, v: string): void;
      src?: unknown;
      alt?: unknown;
      className?: unknown;
    };
    if (typeof target.setAttribute === "function") {
      target.setAttribute(attr, value);
    }
    if (attr === "src" && "src" in (target as object)) {
      target.src = value;
    } else if (attr === "alt" && "alt" in (target as object)) {
      target.alt = value;
    } else if (attr === "class" && "className" in (target as object)) {
      target.className = value;
    }
  } catch {
    // Hostile shims: the mirrored write above may already have landed.
  }
}

/** Pip class for a fill state (read by the bottom-right capture probe). */
export function pipClass(filled: boolean): string {
  return filled ? "pip filled" : "pip empty";
}

/**
 * Reconcile the pip container to exactly GRENADE_MAX children with the
 * given fill classes. Builder-less containers keep (and restyle) their
 * existing children; missing builders or hostile shims are no-ops.
 */
function syncPips(container: unknown, states: readonly boolean[]): void {
  const box = container as {
    children?: { length?: unknown; [index: number]: unknown } | null;
    ownerDocument?: { createElement?: unknown } | null;
    appendChild?: unknown;
    removeChild?: unknown;
  };
  const kids: unknown[] = [];
  try {
    const list = box.children;
    const length = typeof list?.length === "number" ? list.length : 0;
    for (let i = 0; i < length; i += 1) {
      kids.push((list as { [index: number]: unknown })[i]);
    }
  } catch {
    return;
  }
  const ownerDoc = box.ownerDocument ?? null;
  const create =
    ownerDoc !== null &&
    typeof (ownerDoc as { createElement?: unknown }).createElement ===
      "function"
      ? (
        ownerDoc as unknown as {
          createElement(tag: string): unknown;
        }
      ).createElement.bind(ownerDoc)
      : null;
  const append =
    typeof box.appendChild === "function"
      ? (box.appendChild as (child: unknown) => void).bind(box)
      : null;
  const remove =
    typeof box.removeChild === "function"
      ? (box.removeChild as (child: unknown) => void).bind(box)
      : null;
  if (create !== null && append !== null) {
    try {
      while (kids.length < states.length) {
        const pip = create("span");
        writeAttr(pip, "class", pipClass(states[kids.length] ?? false));
        append(pip);
        kids.push(pip);
      }
      while (kids.length > states.length) {
        const extra = kids[kids.length - 1];
        if (remove !== null && extra !== undefined) {
          remove(extra);
        }
        kids.pop();
      }
    } catch {
      // Half-built docs: fall through and stamp whatever children exist.
    }
  }
  for (let i = 0; i < kids.length && i < states.length; i += 1) {
    const want = pipClass(states[i] ?? false);
    if (readAttr(kids[i], "class") !== want) {
      writeAttr(kids[i], "class", want);
    }
  }
}

/**
 * Mirror one snapshot into the module: plain vector textContent for the
 * name/counts (never the 3x5 bitmap rects, since `/` and letters fall
 * back to plain text), the weapon icon src/alt, and exactly
 * GRENADE_MAX pip children. Every write is change-guarded so the
 * every-frame mirror stays cheap; missing elements are skipped.
 */
export function updateAmmo(
  handles: AmmoHandles | null | undefined,
  snapshot: AmmoSnapshot,
): void {
  if (handles === null || handles === undefined) {
    return;
  }
  if (snapshot === null || snapshot === undefined) {
    return;
  }
  const id = normalizeWeaponId(snapshot.weapon);
  const name = displayNameFor(id);
  const counts = formatAmmoCounts(snapshot.magAmmo, id);
  const states = grenadePipStates(snapshot.grenades);
  const nameEl = handles.name ?? null;
  if (nameEl !== null && readText(nameEl) !== name) {
    writeText(nameEl, name);
  }
  const countsEl = handles.counts ?? null;
  if (countsEl !== null && readText(countsEl) !== counts) {
    writeText(countsEl, counts);
  }
  const iconEl = handles.icon ?? null;
  if (iconEl !== null) {
    const src = iconFor(id);
    if (readAttr(iconEl, "src") !== src) {
      writeAttr(iconEl, "src", src);
    }
    const alt = `${name} icon`;
    if (readAttr(iconEl, "alt") !== alt) {
      writeAttr(iconEl, "alt", alt);
    }
  }
  const pipsEl = handles.pips ?? null;
  if (pipsEl !== null) {
    syncPips(pipsEl, states);
  }
}
