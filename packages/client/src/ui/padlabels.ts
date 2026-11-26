// Floating pickup-pad labels (issue #154). Pure label model (text,
// visibility) plus a thin per-frame DOM reconciler: one `.padlabel`
// child per visible active pickup, projected at the pad center via
// projectCamera, updated every frame so a pad-contents change lands
// within one frame. DOM-free helpers stay unit-testable under node;
// the binder degrades to no-ops on fake docs without builders and
// never throws.

import { projectCamera, type Camera } from "../renderer/camera";
import { pickupPaintFor, weaponPlaqueFor } from "../view/props";
import { pickupIconSrcFor, weaponIconSmallSrcFor } from "./icons";

/**
 * Pad icon src for a pickup: weapon pads read the held-weapon 16px well
 * (specific silhouette per gun), every other kind reads its IC-02 well.
 * Pure.
 */
export function padIconSrcFor(kind: unknown, weapon: unknown): string {
  if (typeof kind === "string" && kind.trim().toLowerCase() === "weapon") {
    try {
      return weaponIconSmallSrcFor(weapon);
    } catch {
      return pickupIconSrcFor(kind);
    }
  }
  return pickupIconSrcFor(kind);
}

/** World px above the pad center where the label anchor sits. */
export const PADLABEL_LIFT_PX = 8;

/** HUD cluster ids whose corner bands labels must avoid (issue #385). */
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
 * Build a HUD-band guard for one frame (issue #385): labels whose
 * anchor projects inside an expanded HUD cluster rect stay hidden so
 * no `.padlabel` rect can overlap the status plate (or the other
 * corner clusters). The overlay positions anchors in canvas backing px
 * written straight as CSS px inside the stage container (placeLabel has
 * no backing-to-CSS scaling), so the guard adds the container origin
 * with no scale factor and compares directly to the live cluster
 * rects; null when the DOM surface is missing (fake docs, hidden HUD)
 * so the reconciler shows labels exactly like before. Never throws.
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
    return (bx: number, by: number): boolean => {
      try {
        if (!Number.isFinite(bx) || !Number.isFinite(by)) {
          return false;
        }
        // No backing-to-CSS scaling: anchors land 1:1 inside the
        // stage container, so the container origin alone maps them
        // into viewport CSS px for the cluster comparison.
        const cx = originLeft + bx;
        const cy = originTop + by;
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
export interface PadlabelsHandles {
  container: HTMLElement | null;
}

/** All-null handles for builder-less docs (updatePadlabels no-ops). */
const NULL_PADLABELS: PadlabelsHandles = { container: null };

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
 * never throw, matching the buildNametags tolerance.
 */
export function buildPadlabels(doc: Document): PadlabelsHandles {
  if (doc === null || doc === undefined) {
    return { ...NULL_PADLABELS };
  }
  const lookup = (doc as unknown as { getElementById?(id: string): unknown })
    .getElementById;
  if (typeof lookup !== "function") {
    return { ...NULL_PADLABELS };
  }
  const scoped = { getElementById: lookup.bind(doc) };
  return { container: byId(scoped, "padlabels") };
}

/** One labelable pickup: the live-sim row shape the binder reads. */
export interface PadlabelPickup {
  id: number;
  kind: unknown;
  weapon?: unknown;
  x: number;
  y: number;
  active: boolean;
}

/** Per-frame values the binder reconciles into the overlay. */
export interface PadlabelsFrame {
  pickups: readonly PadlabelPickup[];
  camera: Camera | null;
  canvasW: number;
  canvasH: number;
}

/**
 * Label text for a pad: the plaque display name for weapon pads (the
 * SMG reads Hornet, matching its weapon-hornet art alias), "HP" for
 * health pads, "GREN" for grenade pads. Plain ASCII keeps the
 * labels OCR-safe with no webfont dependency.
 */
export function labelTextFor(kind: unknown, weapon: unknown): string {
  if (typeof kind === "string") {
    const key = kind.trim().toLowerCase();
    if (key === "health") {
      return "HP";
    }
    if (key === "grenades" || key === "grenade") {
      return "GREN";
    }
  }
  const plaque = weaponPlaqueFor(weapon);
  if (plaque.label === "SMG") {
    return "Hornet";
  }
  return plaque.label;
}

/**
 * True when a pickup earns a visible label: it is active (collected,
 * awaiting-respawn pads show nothing) and a camera exists to project
 * it. Offscreen pickups are culled by the reconciler after projection.
 */
export function shouldShowLabel(
  active: boolean,
  camera: Camera | null,
): boolean {
  return active === true && camera !== null;
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
    // Style-less fakes: removal below still hides the label.
  }
}

/**
 * Paint a label's accent rail from its pickup kind (HU-13): health
 * reads green, grenades amber, weapon/fuel pads cyan. The accent lands
 * as an inset underline plus a data-accent mirror for probes.
 * Change-guarded so the every-frame reconcile stays cheap; never throws.
 */
function paintLabelAccent(el: unknown, kind: unknown): void {
  let edge = "#22d3ee";
  try {
    edge = pickupPaintFor(kind).edgeCss;
  } catch {
    // Hostile kinds: the cyan fallback stands.
  }
  const underline = `inset 0 -3px 0 ${edge}`;
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      const bag = style as Record<string, unknown>;
      if (bag["boxShadow"] !== underline) {
        bag["boxShadow"] = underline;
      }
    }
  } catch {
    // Style-less fakes: the attribute mirror below still carries it.
  }
  if (readAttr(el, "data-accent") !== edge) {
    writeAttr(el, "data-accent", edge);
  }
}

/** Move a label node to canvas backing-store px. */
function placeLabel(el: unknown, x: number, y: number): void {
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      const bag = style as Record<string, unknown>;
      bag["left"] = `${x}px`;
      bag["top"] = `${y}px`;
    }
  } catch {
    // Style-less fakes keep the label at its last spot (still labeled).
  }
}

/** Remove every label child and hide the container (the empty path). */
function clearLabels(container: unknown): void {
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
 * Ensure a pad label carries its icon <img>: first
 * `.padlabel-icon` child with the pad icon src (weapon pads read the
 * held-weapon small well, others their IC-02 well). Change-guarded so
 * the every-frame reconciler stays cheap; missing builders are no-ops
 * and never throw.
 */
function syncPadIcon(node: unknown, kind: unknown, weapon: unknown): void {
  let want: string;
  try {
    want = padIconSrcFor(kind, weapon);
  } catch {
    return;
  }
  if (want === "") {
    return;
  }
  try {
    const box = node as {
      children?: { length?: unknown; [index: number]: unknown } | null;
      ownerDocument?: { createElement?: unknown } | null;
      appendChild?: unknown;
    };
    const list = box.children;
    const length = typeof list?.length === "number" ? list.length : 0;
    for (let i = 0; i < length; i += 1) {
      const kid = (list as { [index: number]: unknown })[i];
      try {
        const cls = (kid as { getAttribute?: unknown }).getAttribute;
        let isIcon = false;
        if (typeof cls === "function") {
          const got = (cls as (n: string) => unknown).call(kid, "class");
          if (typeof got === "string" && got.split(" ").includes("padlabel-icon")) {
            isIcon = true;
          }
        } else {
          const cn = (kid as { className?: unknown }).className;
          if (typeof cn === "string" && cn.split(" ").includes("padlabel-icon")) {
            isIcon = true;
          }
        }
        if (!isIcon) {
          continue;
        }
        let cur: string | null = null;
        const getter = (kid as { getAttribute?: unknown }).getAttribute;
        if (typeof getter === "function") {
          const got = (getter as (n: string) => unknown).call(kid, "src");
          if (typeof got === "string") {
            cur = got;
          }
        }
        if (cur === null) {
          const direct = (kid as { src?: unknown }).src;
          if (typeof direct === "string") {
            cur = direct;
          }
        }
        if (cur !== want) {
          const setter = (kid as { setAttribute?: unknown }).setAttribute;
          if (typeof setter === "function") {
            (setter as (n: string, v: string) => void).call(kid, "src", want);
          }
          try {
            (kid as Record<string, unknown>)["src"] = want;
          } catch {
            // Attribute above already landed.
          }
        }
        return;
      } catch {
        continue;
      }
    }
    const ownerDoc = box.ownerDocument ?? null;
    const create =
      ownerDoc !== null &&
      typeof (ownerDoc as { createElement?: unknown }).createElement === "function"
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
    if (create === null || append === null) {
      return;
    }
    const icon = create("img");
    try {
      const setter = (icon as { setAttribute?: unknown }).setAttribute;
      if (typeof setter === "function") {
        (setter as (n: string, v: string) => void).call(icon, "class", "padlabel-icon");
        (setter as (n: string, v: string) => void).call(icon, "src", want);
        (setter as (n: string, v: string) => void).call(icon, "alt", "pickup icon");
      }
    } catch {
      // Attribute-less fakes: direct props below still carry it.
    }
    try {
      (icon as Record<string, unknown>)["className"] = "padlabel-icon";
      (icon as Record<string, unknown>)["src"] = want;
    } catch {
      // Read-only shims: attributes above already landed.
    }
    try {
      append(icon);
    } catch {
      // Half-built docs: the text label still reads.
    }
  } catch {
    // Hostile shims: the text label still reads.
  }
}

/** Attr-safe string of a pickup field for data-kind/data-weapon. */
function attrText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

/**
 * Reconcile the overlay to one frame: with no camera the container
 * hides with zero label nodes; otherwise every active onscreen pickup
 * gets one `.padlabel` child (`data-pickup` id plus `data-kind` and
 * `data-weapon` for DOM queries) positioned at the pad center minus
 * the lift, while inactive/offscreen pickups keep no node. Text writes
 * are change-guarded, so a weapon mutation on a live pad id flips the
 * label without node churn. Missing containers are no-ops.
 */
export function updatePadlabels(
  handles: PadlabelsHandles | null | undefined,
  frame: PadlabelsFrame,
): void {
  if (handles === null || handles === undefined) {
    return;
  }
  const container = handles.container ?? null;
  if (container === null) {
    return;
  }
  if (frame.camera === null) {
    // No camera yet: zero visible labels, container hidden.
    clearLabels(container);
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
  // Index existing label nodes by data-pickup id.
  const existing = new Map<string, unknown>();
  try {
    const list = box.children;
    const length = typeof list?.length === "number" ? list.length : 0;
    for (let i = 0; i < length; i += 1) {
      const kid = (list as { [index: number]: unknown })[i];
      const id = readAttr(kid, "data-pickup");
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
  // cluster rect stay hidden so labels never overlap the status plate.
  // Null on fake docs or a hidden HUD, where labels show like before.
  const hudGuard = buildHudGuard(container, frame.canvasW, frame.canvasH);
  for (const pickup of frame.pickups) {
    if (
      pickup === undefined ||
      !shouldShowLabel(pickup.active, frame.camera)
    ) {
      continue;
    }
    const key = String(pickup.id);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const point = projectCamera(
      cam,
      frame.canvasW,
      frame.canvasH,
      pickup.x,
      pickup.y - PADLABEL_LIFT_PX,
    );
    // Cull labels projected outside the view (plus a small margin so
    // edge-hugging pads keep their label until fully out).
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
      writeAttr(node, "data-pickup", key);
      try {
        append(node);
      } catch {
        continue;
      }
      existing.set(key, node);
    }
    const wantClass = "padlabel";
    if (readAttr(node, "class") !== wantClass) {
      writeAttr(node, "class", wantClass);
    }
    const wantKind = attrText(pickup.kind);
    if (readAttr(node, "data-kind") !== wantKind) {
      writeAttr(node, "data-kind", wantKind);
    }
    const wantWeapon = attrText(pickup.weapon);
    if (readAttr(node, "data-weapon") !== wantWeapon) {
      writeAttr(node, "data-weapon", wantWeapon);
    }
    const wantText = labelTextFor(pickup.kind, pickup.weapon);
    if (readText(node) !== wantText) {
      writeText(node, wantText);
    }
    syncPadIcon(node, pickup.kind, pickup.weapon);
    paintLabelAccent(node, pickup.kind);
    placeLabel(node, point.x, point.y);
    setDisplay(node, "");
  }
  // Drop nodes for collected, duplicate, or offscreen pickups.
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
