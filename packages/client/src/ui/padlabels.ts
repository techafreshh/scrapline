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
