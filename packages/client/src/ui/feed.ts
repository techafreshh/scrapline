// Kill-feed overlay entries (issue #153). Pure model (weapon icon
// lookup, entry text/colors) plus a thin timed DOM binder: colored
// killer/victim spans with a weapon icon between them, entries fade at
// 6s and are removed ~0.5s later, capped at 5. DOM-free helpers stay
// unit-testable under node; the binder degrades to no-ops on fake docs
// without builders and never throws.

import { teamCss } from "../view/character";
import { iconFor } from "./ammo";

/** Feed hold in ms: entries stay fully visible this long, then fade. */
export const KILLFEED_HOLD_MS = 6000;
/** Feed fade in ms: fade-to-transparent window before DOM removal. */
export const KILLFEED_FADE_MS = 500;
/** Max visible feed entries (matches the legacy 5-entry cap). */
export const KILLFEED_MAX_ENTRIES = 5;

/** Weapon ids with a feed icon card (mirrors the ammo KNOWN_IDS list). */
const KNOWN_IDS: readonly string[] = [
  "pistol",
  "smg",
  "rifle",
  "shotgun",
  "sniper",
  "rocket",
];

/**
 * Weapon icon for a feed entry: grenade kills reuse the pickup art,
 * gun kills reuse the weapon cards (the SMG reads the Hornet card via
 * iconFor). Null, empty, and unknown readings yield null so unattributed
 * deaths stay text-only (`X died`) instead of showing a wrong icon.
 */
export function feedIconFor(weapon: unknown): string | null {
  if (typeof weapon !== "string") {
    return null;
  }
  const key = weapon.trim().toLowerCase();
  if (key === "") {
    return null;
  }
  if (key.includes("grenade")) {
    return "./assets/pickup-grenade.svg";
  }
  if (key.includes("hornet")) {
    return iconFor("smg");
  }
  if (KNOWN_IDS.includes(key)) {
    return iconFor(key);
  }
  return null;
}

/** One feed entry's display values (pure, DOM-free). */
export interface FeedModel {
  /** Killer display name (null for unattributed deaths). */
  killer: string | null;
  /** Victim display name. */
  victim: string;
  /** Weapon icon path (null for text-only entries). */
  icon: string | null;
  /** Killer name CSS color (null when the killer index is unknown). */
  killerColor: string | null;
  /** Victim name CSS color (null when the victim index is unknown). */
  victimColor: string | null;
  /** True for unattributed deaths (renders today's `X died` text). */
  suicide: boolean;
}

/**
 * Build one entry model: suicide/barrel deaths keep the `X died` shape
 * with no icon; killer blows resolve the icon plus both player colors
 * via teamCss (local cyan, odd orange-red, even amber).
 */
export function buildFeedEntry(
  killer: string | null,
  victim: string,
  weapon: unknown,
  killerIndex: number | null,
  victimIndex: number | null,
): FeedModel {
  if (killer === null || killer === "") {
    return {
      killer: null,
      victim,
      icon: null,
      killerColor: null,
      victimColor: null,
      suicide: true,
    };
  }
  return {
    killer,
    victim,
    icon: feedIconFor(weapon),
    killerColor:
      typeof killerIndex === "number" && Number.isFinite(killerIndex)
        ? teamCss(killerIndex)
        : null,
    victimColor:
      typeof victimIndex === "number" && Number.isFinite(victimIndex)
        ? teamCss(victimIndex)
        : null,
    suicide: false,
  };
}

/** Element handles owned by the feed; nulls make pushes no-op. */
export interface FeedHandles {
  feed: HTMLElement | null;
}

/** All-null handles for builder-less docs (pushFeed still no-ops). */
const NULL_FEED: FeedHandles = { feed: null };

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
 * Grab the feed handles; idempotent and safe before match start.
 * Docs without getElementById (or throwing lookups) read all null and
 * never throw, matching the buildAmmo tolerance.
 */
export function buildFeed(doc: Document): FeedHandles {
  if (doc === null || doc === undefined) {
    return { ...NULL_FEED };
  }
  const lookup = (doc as unknown as { getElementById?(id: string): unknown })
    .getElementById;
  if (typeof lookup !== "function") {
    return { ...NULL_FEED };
  }
  const scoped = { getElementById: lookup.bind(doc) };
  return { feed: byId(scoped, "killfeed") };
}

/** Write textContent; never throws on hostile shims. */
function writeText(el: unknown, value: string): void {
  try {
    (el as { textContent?: unknown }).textContent = value;
  } catch {
    // Read-only shims: the attribute mirror below still carries it.
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

/** Write a string attribute (plus the matching property when present). */
function writeAttr(el: unknown, attr: string, value: string): void {
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

/** Read a string attribute or property without throwing. */
function readAttr(el: unknown, attr: string): string | null {
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

/** Paint a name span: style.color plus the style-attribute mirror. */
function paintName(el: unknown, color: string | null): void {
  if (color === null || color === "") {
    return;
  }
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      (style as Record<string, unknown>)["color"] = color;
    }
  } catch {
    // Style-less fakes: the attribute mirror below still carries it.
  }
  try {
    const target = el as { setAttribute?(id: string, v: string): void };
    if (typeof target.setAttribute === "function") {
      target.setAttribute("style", `color: ${color};`);
    }
  } catch {
    // Attribute-less fakes: the style bag above still carries it.
  }
}

/** Append a child; returns false on builder-less fakes (never throws). */
function appendKid(parent: unknown, child: unknown): boolean {
  try {
    const target = parent as { appendChild?: unknown };
    if (typeof target.appendChild === "function") {
      (target.appendChild as (kid: unknown) => void).call(parent, child);
      return true;
    }
  } catch {
    // Hostile shims fall through to the text fallback below.
  }
  return false;
}

/** Add one class token without dropping the existing class list. */
function addClass(el: unknown, token: string): void {
  try {
    const list = (el as { classList?: unknown }).classList as
      | { add?: unknown }
      | undefined;
    if (list !== undefined && typeof list.add === "function") {
      (list.add as (c: string) => void).call(list, token);
    }
  } catch {
    // Class-list-less fakes: the attribute path below still lands.
  }
  try {
    const current = readAttr(el, "class") ?? "";
    const parts = current.split(" ").filter((part) => part !== "");
    if (!parts.includes(token)) {
      parts.push(token);
      writeAttr(el, "class", parts.join(" "));
    }
  } catch {
    // Attribute-less fakes: the classList above may already have it.
  }
}

/** Remove one class token, keeping the rest of the list. */
function removeClass(el: unknown, token: string): void {
  try {
    const list = (el as { classList?: unknown }).classList as
      | { remove?: unknown }
      | undefined;
    if (list !== undefined && typeof list.remove === "function") {
      (list.remove as (c: string) => void).call(list, token);
    }
  } catch {
    // Class-list-less fakes: the attribute path below still lands.
  }
  try {
    const current = readAttr(el, "class") ?? "";
    const parts = current.split(" ").filter((part) => part !== "" && part !== token);
    writeAttr(el, "class", parts.join(" "));
  } catch {
    // Attribute-less fakes: the classList above may already have it.
  }
}

/** Set opacity through the style bag plus the style-attribute mirror. */
function setOpacity(el: unknown, value: string): void {
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      (style as Record<string, unknown>)["opacity"] = value;
    }
  } catch {
    // Style-less fakes: the fade class still carries the state.
  }
  try {
    const target = el as { setAttribute?(id: string, v: string): void };
    if (typeof target.setAttribute === "function") {
      target.setAttribute("data-opacity", value);
    }
  } catch {
    // Attribute-less fakes: the style bag above still carries it.
  }
}

/** Schedule a callback on the feed's owner-document timers (never throws). */
function later(feed: unknown, ms: number, fn: () => void): void {
  try {
    const owner = (feed as { ownerDocument?: unknown }).ownerDocument as
      | { defaultView?: unknown }
      | undefined;
    const view = owner?.defaultView as
      | { setTimeout?: unknown }
      | undefined;
    const timer = view?.setTimeout;
    if (typeof timer === "function") {
      (timer as (fn: () => void, ms: number) => void).call(view, fn, ms);
    }
  } catch {
    // Fake docs in unit tests may lack timers: the entry simply stays.
  }
}

/** Drop the oldest entries while the feed exceeds the 5-entry cap. */
function enforceCap(feed: unknown): void {
  try {
    const box = feed as {
      children?: { length?: unknown; [index: number]: unknown } | null;
      removeChild?: unknown;
    };
    const list = box.children;
    const length = typeof list?.length === "number" ? list.length : 0;
    if (length <= KILLFEED_MAX_ENTRIES) {
      return;
    }
    const remove =
      typeof box.removeChild === "function"
        ? (box.removeChild as (kid: unknown) => void).bind(box)
        : null;
    if (remove === null) {
      return;
    }
    for (let i = length; i > KILLFEED_MAX_ENTRIES; i -= 1) {
      const oldest = (list as { [index: number]: unknown })[0];
      if (oldest === undefined) {
        break;
      }
      try {
        remove(oldest);
      } catch {
        break;
      }
    }
  } catch {
    // Builder-less fakes: nothing to cap.
  }
}

/**
 * Append one entry to the feed: text-only `X died` for unattributed
 * deaths (or icon-less killer blows, preserving the legacy flat line),
 * otherwise colored killer/victim spans with the weapon icon between
 * them. The entry pops with `flash`, holds KILLFEED_HOLD_MS, fades over
 * KILLFEED_FADE_MS, then leaves the DOM; the feed caps at 5 entries.
 * Missing feeds are no-ops; hostile shims never throw (structured
 * builds fall back to the flat text line).
 */
export function pushFeed(
  handles: FeedHandles | null | undefined,
  entry: FeedModel | null | undefined,
  flashMs = 700,
): void {
  if (handles === null || handles === undefined) {
    return;
  }
  if (entry === null || entry === undefined) {
    return;
  }
  const feed = handles.feed ?? null;
  if (feed === null) {
    return;
  }
  let node: unknown;
  try {
    const owner = (feed as { ownerDocument?: unknown }).ownerDocument as
      | { createElement?: unknown }
      | undefined;
    const create =
      owner !== undefined && typeof owner.createElement === "function"
        ? (owner.createElement as (tag: string) => unknown).bind(owner)
        : null;
    if (create === null) {
      return;
    }
    node = create("div");
  } catch {
    return;
  }
  writeAttr(node, "class", "kill-entry flash");
  const structured = !entry.suicide && entry.icon !== null;
  if (!structured) {
    writeText(
      node,
      entry.suicide || entry.killer === null || entry.killer === ""
        ? `${entry.victim} died`
        : `${entry.killer} killed ${entry.victim}`,
    );
  } else {
    try {
      const owner = (feed as { ownerDocument?: unknown }).ownerDocument as {
        createElement(tag: string): unknown;
      };
      const killer = owner.createElement("span");
      writeAttr(killer, "class", "killer");
      writeText(killer, entry.killer as string);
      paintName(killer, entry.killerColor);
      const icon = owner.createElement("img");
      writeAttr(icon, "class", "kill-weapon");
      writeAttr(icon, "src", entry.icon as string);
      writeAttr(icon, "alt", "weapon icon");
      const victim = owner.createElement("span");
      writeAttr(victim, "class", "victim");
      writeText(victim, entry.victim);
      paintName(victim, entry.victimColor);
      if (!appendKid(node, killer) || !appendKid(node, icon) || !appendKid(node, victim)) {
        throw new Error("feed append unsupported");
      }
    } catch {
      // Builder-less fakes: degrade to the legacy flat text line.
      writeText(
        node,
        `${entry.killer as string} killed ${entry.victim}`,
      );
    }
  }
  if (!appendKid(feed, node)) {
    return;
  }
  enforceCap(feed);
  const held = node;
  later(feed, flashMs, () => {
    removeClass(held, "flash");
  });
  later(feed, KILLFEED_HOLD_MS, () => {
    addClass(held, "fade");
    setOpacity(held, "0");
  });
  later(feed, KILLFEED_HOLD_MS + KILLFEED_FADE_MS, () => {
    try {
      (feed as { removeChild(kid: unknown): void }).removeChild(held);
    } catch {
      // Already capped away: nothing left to remove.
    }
  });
}
