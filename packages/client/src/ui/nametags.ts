// Floating name-tag overlay (issue #153). Pure helpers (tag text,
// colors, visibility) plus a thin per-frame DOM reconciler: one
// `.nametag` child per visible alive player, projected above the head
// via projectCamera, hidden when the setting is off. DOM-free helpers
// stay unit-testable under node; the binder degrades to no-ops on fake
// docs without builders and never throws.

import {
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "../../../core/src/constants";
import { projectCamera, type Camera } from "../renderer/camera";
import { teamCss } from "../view/character";
import { playerName } from "../hud/hud";

/** Pixels above the player top where the tag anchor sits. */
export const NAMETAG_LIFT_PX = 6;

/** HUD cluster ids whose corner bands tags must avoid (issue #385). */
const HUD_GUARD_IDS: readonly string[] = [
  "hud-status",
  "hud-center",
  "killfeed",
  "ammo-module",
];
/** Guard padding in CSS px around each cluster (covers label half-size
  plus its icon well, so an anchor just outside still cannot bleed its
  rect over the plate). */
const HUD_GUARD_PAD_PX = 48;

/** Guard box in viewport CSS px. */
interface HudGuardBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Build a HUD-band guard for one frame (issue #385): tags whose
 * anchor projects inside an expanded HUD cluster rect stay hidden so
 * no `.nametag` rect can overlap the status plate (or the other
 * corner clusters). The overlay positions anchors in logical px written
 * straight as CSS px inside the scaled stage container (placeTag writes
 * logical values untouched: the #nametags transform scale stretches
 * them onto CSS px), so the guard derives the
 * live logical-to-CSS scale from the container rect and maps anchors
 * into viewport CSS px for the cluster comparison; null when the DOM
 * surface is missing (fake docs, hidden HUD)
 * so the reconciler shows tags exactly like before. Never throws.
 */
function buildHudGuard(
  container: unknown,
  canvasW: number,
  canvasH: number,
): ((bx: number, by: number) => boolean) | null {
  try {
    if (!Number.isFinite(canvasW) || !Number.isFinite(canvasH) || canvasW <= 0 || canvasH <= 0) {
      return null;
    }
    const box = container as {
      ownerDocument?: unknown;
      getBoundingClientRect?: unknown;
    };
    const doc = box.ownerDocument ?? null;
    if (doc === null || doc === undefined) {
      return null;
    }
    const lookup = (doc as { getElementById?: unknown }).getElementById;
    if (typeof lookup !== "function") {
      return null;
    }
    const containerRectFn = box.getBoundingClientRect;
    if (typeof containerRectFn !== "function") {
      return null;
    }
    let containerRect: unknown = null;
    try {
      containerRect = (containerRectFn as () => unknown).call(container);
    } catch {
      return null;
    }
    const cr = containerRect as {
      left?: unknown;
      top?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (
      typeof cr.left !== "number" ||
      typeof cr.top !== "number" ||
      typeof cr.width !== "number" ||
      typeof cr.height !== "number"
    ) {
      return null;
    }
    if (!Number.isFinite(cr.left) || !Number.isFinite(cr.top) || !Number.isFinite(cr.width) || !Number.isFinite(cr.height)) {
      return null;
    }
    if (cr.width <= 0 || cr.height <= 0) {
      return null;
    }
    const boxes: HudGuardBox[] = [];
    for (const id of HUD_GUARD_IDS) {
      let el: unknown = null;
      try {
        el = (lookup as (name: string) => unknown).call(doc, id);
      } catch {
        continue;
      }
      if (el === null || el === undefined) {
        continue;
      }
      const rectFn = (el as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (typeof rectFn !== "function") {
        continue;
      }
      let rect: unknown = null;
      try {
        rect = (rectFn as () => unknown).call(el);
      } catch {
        continue;
      }
      const r = rect as {
        left?: unknown;
        top?: unknown;
        right?: unknown;
        bottom?: unknown;
        width?: unknown;
        height?: unknown;
      };
      if (typeof r.left !== "number" || typeof r.top !== "number") {
        continue;
      }
      let right: number | null = typeof r.right === "number" ? r.right : null;
      let bottom: number | null = typeof r.bottom === "number" ? r.bottom : null;
      if (right === null && typeof r.width === "number") {
        right = (r.left as number) + (r.width as number);
      }
      if (bottom === null && typeof r.height === "number") {
        bottom = (r.top as number) + (r.height as number);
      }
      if (right === null || bottom === null) {
        continue;
      }
      if (!Number.isFinite(right) || !Number.isFinite(bottom)) {
        continue;
      }
      const width = right - (r.left as number);
      const height = bottom - (r.top as number);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        continue;
      }
      boxes.push({ left: r.left as number, top: r.top as number, right, bottom });
    }
    if (boxes.length === 0) {
      return null;
    }
    const originLeft = cr.left as number;
    const originTop = cr.top as number;
    // Logical-to-CSS scale (issue #392): the #nametags transform
    // stretches logical anchor px onto the CSS-sized stage, so the
    // guard maps with the same scale. Defensive: non-finite ratios
    // fall back to 1 (anchors compare unscaled, like before).
    const rawSx = (cr.width as number) / canvasW;
    const rawSy = (cr.height as number) / canvasH;
    const sx = Number.isFinite(rawSx) && rawSx > 0 ? rawSx : 1;
    const sy = Number.isFinite(rawSy) && rawSy > 0 ? rawSy : 1;
    return (bx: number, by: number): boolean => {
      try {
        if (!Number.isFinite(bx) || !Number.isFinite(by)) {
          return false;
        }
        // Scaled mapping: logical anchors land on the CSS-sized stage
        // through the container origin plus the overlay scale, matching
        // the rendered tag position for the cluster comparison.
        const cx = originLeft + bx * sx;
        const cy = originTop + by * sy;
        for (const guard of boxes) {
          if (
            cx >= guard.left - HUD_GUARD_PAD_PX &&
            cx <= guard.right + HUD_GUARD_PAD_PX &&
            cy >= guard.top - HUD_GUARD_PAD_PX &&
            cy <= guard.bottom + HUD_GUARD_PAD_PX
          ) {
            return true;
          }
        }
        return false;
      } catch {
        return false;
      }
    };
  } catch {
    return null;
  }
}

/** Element handles owned by the overlay; nulls make updates no-op. */
export interface NametagsHandles {
  container: HTMLElement | null;
}

/** All-null handles for builder-less docs (updateNametags no-ops). */
const NULL_NAMETAGS: NametagsHandles = { container: null };

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
 * Grab the overlay handles; idempotent and safe before match start.
 * Docs without getElementById (or throwing lookups) read all null and
 * never throw, matching the buildAmmo tolerance.
 */
export function buildNametags(doc: Document): NametagsHandles {
  if (doc === null || doc === undefined) {
    return { ...NULL_NAMETAGS };
  }
  const lookup = (doc as unknown as { getElementById?(id: string): unknown })
    .getElementById;
  if (typeof lookup !== "function") {
    return { ...NULL_NAMETAGS };
  }
  const scoped = { getElementById: lookup.bind(doc) };
  return { container: byId(scoped, "nametags") };
}

/** One taggable player: the live-sim row shape the binder reads. */
export interface NametagPlayer {
  id: number;
  x: number;
  y: number;
  alive: boolean;
  crouching?: boolean;
}

/** Per-frame values the binder reconciles into the overlay. */
export interface NametagsFrame {
  players: readonly NametagPlayer[];
  camera: Camera | null;
  canvasW: number;
  canvasH: number;
  show: boolean;
  /** Local-name override for the id-0 tag (empty reads You). */
  localName?: string | null;
  /** Avatar-palette override tinting only the id-0 tag. */
  localPalette?: string | null;
  /**
   * Server roster override (issue #217): when present, the roster name
   * wins over the offline bot-name pool so remotes render their server
   * name (Bob reads Bob for Alice). Accepts a Map, a plain record, or
   * readonly [{id, name}] rows; missing ids fall back to the pool.
   */
  names?:
    | ReadonlyMap<number, string>
    | Readonly<Record<number, string>>
    | readonly { id: number; name: string }[]
    | null;
}

/** Roster lookup: Map, plain record, or [{id, name}] rows (never throws). */
function rosterNameFor(
  names: NametagsFrame["names"],
  id: number,
): string | null {
  try {
    if (names === null || names === undefined) {
      return null;
    }
    if (Array.isArray(names)) {
      for (const row of names) {
        if (row !== null && typeof row === "object" && row.id === id) {
          return typeof row.name === "string" && row.name.length > 0 ? row.name : null;
        }
      }
      return null;
    }
    if (typeof (names as ReadonlyMap<number, string>).get === "function") {
      const hit = (names as ReadonlyMap<number, string>).get(id);
      return typeof hit === "string" && hit.length > 0 ? hit : null;
    }
    if (typeof names === "object") {
      const hit = (names as Readonly<Record<number, string>>)[id];
      return typeof hit === "string" && hit.length > 0 ? hit : null;
    }
  } catch {
    // Hostile roster: the pool fallback stands.
  }
  return null;
}

/**
 * Tag text for a player id: the server roster wins when it names the id
 * (issue #217: Bob reads Bob for Alice), else the shared bot-name
 * identity (local id 0 reads "You"), so feed, scoreboard, and tags
 * never disagree. A non-empty local name still overrides the id-0 tag
 * when the roster is silent for it.
 */
export function tagTextFor(
  id: number,
  localName?: string | null,
  names?: NametagsFrame["names"],
): string {
  const rosterHit = rosterNameFor(names, id);
  if (rosterHit !== null) {
    return rosterHit;
  }
  return playerName(id, localName);
}

/** True for a verbatim #RRGGBB palette override. */
function isPaletteOverride(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 7 || value[0] !== "#") {
    return false;
  }
  for (let i = 1; i < 7; i += 1) {
    const code = value.charCodeAt(i);
    if (
      !(code >= 48 && code <= 57) &&
      !(code >= 65 && code <= 70) &&
      !(code >= 97 && code <= 102)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Tag text color for a player-array index: the single teamCss source
 * (local cyan, odd orange-red, even amber), never hardcoded hex. A
 * valid-hex palette tints only the local (index 0) tag.
 */
export function tagColorFor(index: number, palette?: string | null): string {
  if (index === 0 && isPaletteOverride(palette)) {
    return palette;
  }
  return teamCss(index);
}

/** True for the local player's own tag (array index 0): brighter outline. */
export function isOwnTag(index: number): boolean {
  return index === 0;
}

/**
 * True when a player earns a visible tag: the setting is on, the player
 * is alive, and the camera exists to project them. Offscreen players
 * are culled by the reconciler after projection.
 */
export function shouldShowTag(
  show: boolean,
  alive: boolean,
  camera: Camera | null,
): boolean {
  return show && alive && camera !== null;
}

/** Write a string attribute without throwing on hostile shims. */
function writeAttr(el: unknown, attr: string, value: string): void {
  try {
    const target = el as { setAttribute?(id: string, v: string): void };
    if (typeof target.setAttribute === "function") {
      target.setAttribute(attr, value);
    }
  } catch {
    // Attribute-less fakes: the direct props below still carry it.
  }
  try {
    const target = el as Record<string, unknown>;
    if (attr === "class" && "className" in target) {
      target["className"] = value;
    }
  } catch {
    // Read-only shims: the attribute above may already have landed.
  }
}

/** Read a string attribute or property without throwing. */
function readAttr(el: unknown, attr: string): string | null {
  try {
    const target = el as {
      getAttribute?(id: string): unknown;
      className?: unknown;
    };
    if (typeof target.getAttribute === "function") {
      const viaAttr = target.getAttribute(attr);
      if (typeof viaAttr === "string") {
        return viaAttr;
      }
    }
    if (attr === "class" && typeof target.className === "string") {
      return target.className;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write textContent without throwing on hostile shims. */
function writeText(el: unknown, value: string): void {
  try {
    (el as { textContent?: unknown }).textContent = value;
  } catch {
    // Read-only shims: the attribute mirror below still carries it.
  }
  writeAttr(el, "data-value", value);
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

/** Assign display on an unknown handle when it carries a style bag. */
function setDisplay(el: unknown, display: string): void {
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      (style as Record<string, unknown>)["display"] = display;
    }
  } catch {
    // Style-less fakes: removal below still hides the tag.
  }
}

/** Move a tag node to canvas backing-store px. */
function placeTag(el: unknown, x: number, y: number): void {
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      const bag = style as Record<string, unknown>;
      bag["left"] = `${x}px`;
      bag["top"] = `${y}px`;
    }
  } catch {
    // Style-less fakes keep the tag at its last spot (still labeled).
  }
}

/** Paint a tag's text color through the style bag plus an attribute. */
function paintTag(el: unknown, color: string): void {
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      (style as Record<string, unknown>)["color"] = color;
    }
  } catch {
    // Style-less fakes: the attribute mirror below still carries it.
  }
  writeAttr(el, "data-color", color);
}

/** Remove every tag child and hide the container (the OFF path). */
function clearTags(container: unknown): void {
  try {
    const box = container as {
      children?: { length?: unknown; [index: number]: unknown } | null;
      removeChild?: unknown;
    };
    const list = box.children;
    const length = typeof list?.length === "number" ? list.length : 0;
    const remove =
      typeof box.removeChild === "function"
        ? (box.removeChild as (kid: unknown) => void).bind(box)
        : null;
    if (remove !== null) {
      for (let i = length - 1; i >= 0; i -= 1) {
        const kid = (list as { [index: number]: unknown })[i];
        if (kid === undefined) {
          continue;
        }
        try {
          remove(kid);
        } catch {
          break;
        }
      }
    }
  } catch {
    // Builder-less containers: nothing to clear.
  }
  setDisplay(container, "none");
}

/**
 * Reconcile the overlay to one frame: when the setting is off the
 * container hides with zero tag nodes; otherwise every alive onscreen
 * player gets one `.nametag` child (`data-player` id, `own` only for
 * index 0) positioned above the head, while dead/offscreen players
 * keep no node. Missing containers are no-ops.
 */
export function updateNametags(
  handles: NametagsHandles | null | undefined,
  frame: NametagsFrame,
): void {
  if (handles === null || handles === undefined) {
    return;
  }
  const container = handles.container ?? null;
  if (container === null) {
    return;
  }
  if (frame.show !== true || frame.camera === null) {
    // OFF (or no camera yet): zero visible tags, container hidden.
    clearTags(container);
    return;
  }
  setDisplay(container, "");
  const cam = frame.camera as Camera;
  const box = container as {
    children?: { length?: unknown; [index: number]: unknown } | null;
    ownerDocument?: { createElement?: unknown } | null;
    appendChild?: unknown;
    removeChild?: unknown;
  };
  // Index existing tag nodes by data-player id.
  const existing = new Map<string, unknown>();
  try {
    const list = box.children;
    const length = typeof list?.length === "number" ? list.length : 0;
    for (let i = 0; i < length; i += 1) {
      const kid = (list as { [index: number]: unknown })[i];
      const id = readAttr(kid, "data-player");
      if (typeof id === "string" && !existing.has(id)) {
        existing.set(id, kid);
      }
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
      ? (box.appendChild as (kid: unknown) => void).bind(box)
      : null;
  const remove =
    typeof box.removeChild === "function"
      ? (box.removeChild as (kid: unknown) => void).bind(box)
      : null;
  const seen = new Set<string>();
  // HUD corner-band guard (issue #385): anchors inside an expanded
  // cluster rect stay hidden so tags never overlap the status plate.
  // Null on fake docs or a hidden HUD, where tags show like before.
  const hudGuard = buildHudGuard(container, frame.canvasW, frame.canvasH);
  for (let index = 0; index < frame.players.length; index += 1) {
    const player = frame.players[index] as NametagPlayer | undefined;
    if (
      player === undefined ||
      !shouldShowTag(frame.show, player.alive, frame.camera)
    ) {
      continue;
    }
    const key = String(player.id);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const height = player.crouching
      ? PLAYER_CROUCH_HEIGHT
      : PLAYER_HEIGHT;
    const point = projectCamera(
      cam,
      frame.canvasW,
      frame.canvasH,
      player.x + PLAYER_WIDTH / 2,
      player.y - NAMETAG_LIFT_PX - (PLAYER_HEIGHT - height),
    );
    // Cull tags projected outside the view (plus a small margin so
    // edge-hugging players keep their label until fully out).
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < -50 ||
      point.y < -50 ||
      point.x > frame.canvasW + 50 ||
      point.y > frame.canvasH + 50
    ) {
      continue;
    }
    // HUD corner-band cull (issue #385): drop the anchor (and any
    // stale node via the seen-set below) instead of painting over
    // the status plate. Fake docs and hidden HUDs guard null.
    if (hudGuard !== null) {
      let inside = false;
      try {
        inside = hudGuard(point.x, point.y) === true;
      } catch {
        // Hostile guard: keep the anchor visible like before.
      }
      if (inside) {
        try {
          seen.delete(key);
        } catch {
          // Set-less shims: the removal pass below still hides it.
        }
        continue;
      }
    }
    let node: unknown = existing.get(key) ?? null;
    if (node === null) {
      if (create === null || append === null) {
        continue;
      }
      try {
        node = create("div");
      } catch {
        continue;
      }
      writeAttr(node, "data-player", key);
      try {
        append(node);
      } catch {
        continue;
      }
      existing.set(key, node);
    }
    const wantClass = isOwnTag(index) ? "nametag own" : "nametag";
    if (readAttr(node, "class") !== wantClass) {
      writeAttr(node, "class", wantClass);
    }
    const wantText = tagTextFor(player.id, frame.localName, frame.names);
    if (readText(node) !== wantText) {
      writeText(node, wantText);
    }
    paintTag(node, tagColorFor(index, frame.localPalette));
    placeTag(node, point.x, point.y);
    setDisplay(node, "");
  }
  // Drop nodes for dead, duplicate, or offscreen players.
  if (remove !== null) {
    for (const [key, node] of existing) {
      if (!seen.has(key)) {
        try {
          remove(node);
        } catch {
          // Half-built docs: leave the stale node hidden instead.
          setDisplay(node, "none");
        }
      }
    }
  }
}
