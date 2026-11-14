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
}

/**
 * Tag text for a player id: the shared bot-name identity (local id 0
 * reads "You"), so feed, scoreboard, and tags never disagree.
 */
export function tagTextFor(id: number): string {
  return playerName(id);
}

/**
 * Tag text color for a player-array index: the single teamCss source
 * (local cyan, odd orange-red, even amber), never hardcoded hex.
 */
export function tagColorFor(index: number): string {
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
    const wantText = tagTextFor(player.id);
    if (readText(node) !== wantText) {
      writeText(node, wantText);
    }
    paintTag(node, tagColorFor(index));
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
