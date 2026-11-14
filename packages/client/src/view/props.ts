// Props + pickup art model: readable CC0 reference-grade states for
// crates, barrels, weapon pads, health/grenade markers, and the bounce
// pad squash cycle. Pure (no DOM, no Pixi): palette, hp-fraction
// classification, weapon-plaque resolution (Hornet is the SMG alias),
// and bounce squash timing plus twin Pixi/canvas2d painters share one
// model so headless tests drive the same contract the renderer paints.
// States: props crack at <=50% HP (full-area base shift plus jagged
// overlays, so the damaged sprite differs by thousands of pixels);
// weapon pads paint a centered icon plaque per held weapon; bounce pads
// squash to BOUNCE_SQUASH_MIN at 300ms after a bounce event, then ease
// back to idle by BOUNCE_SQUASH_DURATION_MS.
import { BARREL_HP, CRATE_HP } from "../../../core/src/constants";

/** HP fraction at or below which a prop reads cracked. */
export const PROP_CRACK_FRACTION = 0.5;

/** Bounce squash cycle length in ms (idle -> peak -> idle). */
export const BOUNCE_SQUASH_DURATION_MS = 600;
/** Bounce pad height fraction at peak squash (0.6, well under 0.85). */
export const BOUNCE_SQUASH_MIN = 0.6;
/** Elapsed ms of peak squash (mid-cycle, the 300ms probe point). */
export const BOUNCE_SQUASH_PEAK_MS = BOUNCE_SQUASH_DURATION_MS / 2;

/** Weapon-pad base size in world px (matches pickup-pad.svg 40x16). */
export const PICKUP_PAD_W = 40;
/** Weapon-pad base height in world px. */
export const PICKUP_PAD_H = 16;
/** Icon plaque size in world px (centered on the pad). */
export const PLAQUE_W = 18;
/** Icon plaque height in world px. */
export const PLAQUE_H = 12;

/** Intact prop paint (mirrors the prop-*.svg sources). */
export interface PropPaint {
  baseHex: number;
  baseCss: string;
  bandHex: number;
  bandCss: string;
  crackHex: number;
  crackCss: string;
  sparkHex: number;
  sparkCss: string;
}

/** Cracked barrel paint: darkened shell plus near-black fissures. */
const BARREL_CRACKED: PropPaint = {
  baseHex: 0x7c3a06,
  baseCss: "#7c3a06",
  bandHex: 0x2a1503,
  bandCss: "#2a1503",
  crackHex: 0x0b0b0b,
  crackCss: "#0b0b0b",
  sparkHex: 0xfbbf24,
  sparkCss: "#fbbf24",
};

/** Intact barrel paint (matches prop-barrel.svg). */
const BARREL_INTACT: PropPaint = {
  baseHex: 0xb45309,
  baseCss: "#b45309",
  bandHex: 0x451a03,
  bandCss: "#451a03",
  crackHex: 0x0b0b0b,
  crackCss: "#0b0b0b",
  sparkHex: 0xfbbf24,
  sparkCss: "#fbbf24",
};

/** Cracked crate paint: darkened timber plus near-black fissures. */
const CRATE_CRACKED: PropPaint = {
  baseHex: 0x5c2e0a,
  baseCss: "#5c2e0a",
  bandHex: 0x2a1503,
  bandCss: "#2a1503",
  crackHex: 0x0b0b0b,
  crackCss: "#0b0b0b",
  sparkHex: 0xfbbf24,
  sparkCss: "#fbbf24",
};

/** Intact crate paint (matches prop-crate.svg). */
const CRATE_INTACT: PropPaint = {
  baseHex: 0x92400e,
  baseCss: "#92400e",
  bandHex: 0x451a03,
  bandCss: "#451a03",
  crackHex: 0x0b0b0b,
  crackCss: "#0b0b0b",
  sparkHex: 0xfbbf24,
  sparkCss: "#fbbf24",
};

/**
 * Max HP for a prop kind (core tuning single-source). Barrels read
 * BARREL_HP, everything else (crates, unknown kinds) reads CRATE_HP
 * so bad data still classifies instead of crashing paint.
 */
export function propMaxHp(kind: unknown): number {
  if (typeof kind === "string" && kind.trim().toLowerCase() === "barrel") {
    return BARREL_HP;
  }
  return CRATE_HP;
}

/**
 * HP fraction in [0, 1] for a prop kind and hp reading. Non-finite
 * hp reads intact (1) so shorn harnesses paint the reference sprite.
 */
export function propHpFraction(kind: unknown, hp: unknown): number {
  const max = propMaxHp(kind);
  const value = Number(hp);
  if (!Number.isFinite(value) || max <= 0) {
    return 1;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= max) {
    return 1;
  }
  return value / max;
}

/**
 * Crack stage for a prop: 0 intact, 1 cracked. Cracked at or below
 * half HP, so a barrel at exactly 50% HP paints the damaged sprite.
 * Pure: no DOM, no clock.
 */
export function propCrackStage(kind: unknown, hp: unknown): 0 | 1 {
  return propHpFraction(kind, hp) <= PROP_CRACK_FRACTION ? 1 : 0;
}

/** True when the prop paints its cracked sprite. */
export function isPropCracked(kind: unknown, hp: unknown): boolean {
  return propCrackStage(kind, hp) === 1;
}

/**
 * Paint pair for a prop kind and hp reading. The cracked rows shift
 * the full-area base (barrel #b45309 -> #7c3a06, crate #92400e ->
 * #5c2e0a) plus jagged overlays, so the damaged sprite differs by
 * thousands of pixels, not a hairline. Returns a copy.
 */
export function propPaintFor(kind: unknown, hp: unknown): PropPaint {
  const cracked = isPropCracked(kind, hp);
  const isBarrel =
    typeof kind === "string" && kind.trim().toLowerCase() === "barrel";
  if (isBarrel) {
    return { ...(cracked ? BARREL_CRACKED : BARREL_INTACT) };
  }
  return { ...(cracked ? CRATE_CRACKED : CRATE_INTACT) };
}

/** One weapon icon plaque entry (atlas card plus display color). */
export interface WeaponPlaque {
  /** Atlas key without extension (e.g. weapon-hornet). */
  key: string;
  /** Co-located CC0 source file. */
  file: string;
  /** Display name (Hornet for the SMG alias). */
  label: string;
  /** Icon paint as Pixi hex. */
  colorHex: number;
  /** Icon paint as CSS. */
  colorCss: string;
  /** Gun glyph length in world px (drives the plaque silhouette). */
  length: number;
}

const PLAQUES: Record<string, WeaponPlaque> = {
  pistol: {
    key: "weapon-pistol",
    file: "weapon-pistol.svg",
    label: "Pistol",
    colorHex: 0xf8fafc,
    colorCss: "#F8FAFC",
    length: 8,
  },
  smg: {
    key: "weapon-smg",
    file: "weapon-smg.svg",
    label: "SMG",
    colorHex: 0xe2e8f0,
    colorCss: "#E2E8F0",
    length: 10,
  },
  rifle: {
    key: "weapon-rifle",
    file: "weapon-rifle.svg",
    label: "Rifle",
    colorHex: 0xfbbf24,
    colorCss: "#FBBF24",
    length: 12,
  },
  shotgun: {
    key: "weapon-shotgun",
    file: "weapon-shotgun.svg",
    label: "Shotgun",
    colorHex: 0xfb923c,
    colorCss: "#FB923C",
    length: 13,
  },
  sniper: {
    key: "weapon-sniper",
    file: "weapon-sniper.svg",
    label: "Sniper",
    colorHex: 0x93c5fd,
    colorCss: "#93C5FD",
    length: 16,
  },
  rocket: {
    key: "weapon-rocket",
    file: "weapon-rocket.svg",
    label: "Rocket",
    colorHex: 0x94a3b8,
    colorCss: "#94A3B8",
    length: 15,
  },
  hornet: {
    key: "weapon-hornet",
    file: "weapon-hornet.svg",
    label: "Hornet",
    colorHex: 0x22d3ee,
    colorCss: "#22D3EE",
    length: 10,
  },
};

/**
 * Icon plaque for a weapon pickup holding. Case-insensitive and
 * whitespace-tolerant; "Hornet" (and "Hornet SMG") resolve to the
 * dedicated Hornet card; unknown holdings fall back to the pistol so
 * bad data still paints a centered plaque. Returns a copy.
 */
export function weaponPlaqueFor(weapon: unknown): WeaponPlaque {
  if (typeof weapon === "string") {
    const key = weapon.trim().toLowerCase();
    if (key.includes("hornet")) {
      return { ...PLAQUES["hornet"] } as WeaponPlaque;
    }
    const direct = PLAQUES[key];
    if (direct !== undefined) {
      return { ...direct };
    }
  }
  return { ...(PLAQUES["pistol"] as WeaponPlaque) };
}

/** Pad edge paint per pickup kind. */
export interface PickupPaint {
  edgeHex: number;
  edgeCss: string;
}

/**
 * Pad edge paint for a pickup kind: weapon cyan, health green,
 * grenades amber; unknown kinds fall back to cyan so pads stay lit.
 */
export function pickupPaintFor(kind: unknown): PickupPaint {
  if (typeof kind === "string") {
    const key = kind.trim().toLowerCase();
    if (key === "health") {
      return { edgeHex: 0x22c55e, edgeCss: "#22c55e" };
    }
    if (key === "grenades" || key === "grenade") {
      return { edgeHex: 0xeab308, edgeCss: "#eab308" };
    }
  }
  return { edgeHex: 0x22d3ee, edgeCss: "#22d3ee" };
}

/**
 * Bounce squash scale for an elapsed-ms reading since the trigger.
 * Half-sine ease: 1 at trigger, BOUNCE_SQUASH_MIN at the 300ms peak,
 * back to 1 at BOUNCE_SQUASH_DURATION_MS, holding 1 outside the
 * window. Non-finite readings hold idle (1). Pure: no clock reads.
 */
export function bounceSquashAt(elapsedMs: unknown): number {
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 1;
  }
  if (elapsed >= BOUNCE_SQUASH_DURATION_MS) {
    return 1;
  }
  const phase = (elapsed / BOUNCE_SQUASH_DURATION_MS) * Math.PI;
  return 1 - (1 - BOUNCE_SQUASH_MIN) * Math.sin(phase);
}

/**
 * Live bounce squash scale for a draw clock. Null or non-finite
 * trigger readings hold idle (1); otherwise delegates to
 * bounceSquashAt(nowMs - triggerMs). Pure: clocks arrive as args.
 */
export function bounceSquashScale(
  nowMs: unknown,
  lastBounceAtMs: unknown,
): number {
  if (lastBounceAtMs == null) {
    return 1;
  }
  if (typeof lastBounceAtMs === "string" && lastBounceAtMs.trim() === "") {
    return 1;
  }
  const now = Number(nowMs);
  const trigger = Number(lastBounceAtMs);
  if (!Number.isFinite(now) || !Number.isFinite(trigger)) {
    return 1;
  }
  return bounceSquashAt(now - trigger);
}

/** Minimal Pixi graphics surface (structural, no pixi.js import). */
export interface PropsPixiGraphics {
  rect(x: number, y: number, w: number, h: number): unknown;
  fill(style: number | { color?: number; alpha?: number }): unknown;
  circle(x: number, y: number, r: number): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  stroke(style?: { width?: number; color?: number; alpha?: number; cap?: "butt" | "round" | "square" }): unknown;
}

/**
 * Paint one prop in Pixi at screen coords (sx/sy top-left, w/h scaled
 * world size). Intact rows fill the reference base with banding; the
 * cracked stage shifts the full base darker and adds jagged fissures
 * plus a hot chip so the state reads at a glance.
 */
export function paintPropPixi(
  graphics: PropsPixiGraphics,
  sx: number,
  sy: number,
  w: number,
  h: number,
  scale: number,
  kind: unknown,
  hp: unknown,
): void {
  const paint = propPaintFor(kind, hp);
  const cracked = isPropCracked(kind, hp);
  const isBarrel =
    typeof kind === "string" && kind.trim().toLowerCase() === "barrel";
  graphics.rect(sx, sy, w, h);
  graphics.fill(paint.baseHex);
  const bandH = Math.max(1, 3 * scale);
  if (isBarrel) {
    graphics.rect(sx, sy + h * 0.18, w, bandH);
    graphics.fill(paint.bandHex);
    graphics.rect(sx, sy + h * 0.73, w, bandH);
    graphics.fill(paint.bandHex);
  } else {
    graphics.rect(sx, sy + h * 0.43, w, Math.max(1, 4 * scale));
    graphics.fill(paint.bandHex);
    graphics.rect(sx + w * 0.43, sy, Math.max(1, 4 * scale), h);
    graphics.fill(paint.bandHex);
  }
  if (!cracked) {
    return;
  }
  const crackW = Math.max(1.5, 2 * scale);
  graphics.moveTo(sx + w * 0.2, sy);
  graphics.lineTo(sx + w * 0.4, sy + h * 0.3);
  graphics.lineTo(sx + w * 0.3, sy + h * 0.55);
  graphics.lineTo(sx + w * 0.55, sy + h);
  graphics.stroke({ width: crackW, color: paint.crackHex });
  graphics.moveTo(sx + w * 0.8, sy);
  graphics.lineTo(sx + w * 0.6, sy + h * 0.35);
  graphics.lineTo(sx + w * 0.72, sy + h * 0.6);
  graphics.lineTo(sx + w * 0.5, sy + h);
  graphics.stroke({ width: crackW, color: paint.crackHex });
  graphics.rect(sx + w * 0.35, sy + h * 0.4, w * 0.28, h * 0.2);
  graphics.fill(paint.crackHex);
  graphics.rect(sx + w * 0.15, sy + h * 0.62, w * 0.18, h * 0.12);
  graphics.fill(paint.sparkHex);
}

/** Paint one prop on a 2D canvas (mirrors paintPropPixi). */
export function paintProp2D(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  w: number,
  h: number,
  scale: number,
  kind: unknown,
  hp: unknown,
): void {
  const paint = propPaintFor(kind, hp);
  const cracked = isPropCracked(kind, hp);
  const isBarrel =
    typeof kind === "string" && kind.trim().toLowerCase() === "barrel";
  ctx.fillStyle = paint.baseCss;
  ctx.fillRect(sx, sy, w, h);
  const bandH = Math.max(1, 3 * scale);
  ctx.fillStyle = paint.bandCss;
  if (isBarrel) {
    ctx.fillRect(sx, sy + h * 0.18, w, bandH);
    ctx.fillRect(sx, sy + h * 0.73, w, bandH);
  } else {
    ctx.fillRect(sx, sy + h * 0.43, w, Math.max(1, 4 * scale));
    ctx.fillRect(sx + w * 0.43, sy, Math.max(1, 4 * scale), h);
  }
  if (!cracked) {
    return;
  }
  ctx.strokeStyle = paint.crackCss;
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx + w * 0.2, sy);
  ctx.lineTo(sx + w * 0.4, sy + h * 0.3);
  ctx.lineTo(sx + w * 0.3, sy + h * 0.55);
  ctx.lineTo(sx + w * 0.55, sy + h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx + w * 0.8, sy);
  ctx.lineTo(sx + w * 0.6, sy + h * 0.35);
  ctx.lineTo(sx + w * 0.72, sy + h * 0.6);
  ctx.lineTo(sx + w * 0.5, sy + h);
  ctx.stroke();
  ctx.fillStyle = paint.crackCss;
  ctx.fillRect(sx + w * 0.35, sy + h * 0.4, w * 0.28, h * 0.2);
  ctx.fillStyle = paint.sparkCss;
  ctx.fillRect(sx + w * 0.15, sy + h * 0.62, w * 0.18, h * 0.12);
}

/**
 * Paint one pickup in Pixi centered on (cx, cy): the dark pad base
 * with the per-kind lit edge, the centered plaque frame, and the
 * centered icon (weapon glyph per held weapon incl. Hornet, green
 * cross for health, olive grenade for grenades). Every icon pixel
 * sits within half the pad of the pad center by construction.
 */
export function paintPickupPixi(
  graphics: PropsPixiGraphics,
  cx: number,
  cy: number,
  scale: number,
  kind: unknown,
  weapon: unknown,
): void {
  const pad = pickupPaintFor(kind);
  const padW = PICKUP_PAD_W * scale;
  const padH = PICKUP_PAD_H * scale;
  const plaqueW = PLAQUE_W * scale;
  const plaqueH = PLAQUE_H * scale;
  graphics.rect(cx - padW / 2, cy - padH / 2, padW, padH);
  graphics.fill(0x1f2937);
  graphics.rect(cx - padW / 2, cy + padH / 2 - Math.max(1, 2 * scale), padW, Math.max(1, 2 * scale));
  graphics.fill(pad.edgeHex);
  graphics.rect(cx - plaqueW / 2, cy - plaqueH / 2, plaqueW, plaqueH);
  graphics.fill(0x0b1020);
  const key = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  if (key === "health") {
    const armL = Math.max(1, 10 * scale);
    const armT = Math.max(1, 4 * scale);
    graphics.rect(cx - armL / 2, cy - armT / 2, armL, armT);
    graphics.fill(pad.edgeHex);
    graphics.rect(cx - armT / 2, cy - armL / 2, armT, armL);
    graphics.fill(pad.edgeHex);
    return;
  }
  if (key === "grenades" || key === "grenade") {
    const r = Math.max(2, 5 * scale);
    graphics.circle(cx, cy + scale, r);
    graphics.fill(0xa3e635);
    graphics.circle(cx - r * 0.3, cy, Math.max(1, r * 0.35));
    graphics.fill(0xd9f99d);
    graphics.moveTo(cx + r * 0.4, cy - r - 2 * scale);
    graphics.lineTo(cx + r + 2 * scale, cy - r - 2 * scale);
    graphics.stroke({ width: Math.max(1, scale), color: 0xe2e8f0 });
    return;
  }
  const plaque = weaponPlaqueFor(weapon);
  const gunL = plaque.length * scale;
  const gunW = Math.max(1.5, 3 * scale);
  graphics.moveTo(cx - gunL / 2, cy);
  graphics.lineTo(cx + gunL / 2, cy);
  graphics.stroke({ width: gunW, color: plaque.colorHex });
  graphics.circle(cx + gunL / 2, cy, Math.max(1, 1.5 * scale));
  graphics.fill(0xfde047);
}

/** Paint one pickup on a 2D canvas (mirrors paintPickupPixi). */
export function paintPickup2D(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  kind: unknown,
  weapon: unknown,
): void {
  const pad = pickupPaintFor(kind);
  const padW = PICKUP_PAD_W * scale;
  const padH = PICKUP_PAD_H * scale;
  const plaqueW = PLAQUE_W * scale;
  const plaqueH = PLAQUE_H * scale;
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(cx - padW / 2, cy - padH / 2, padW, padH);
  ctx.fillStyle = pad.edgeCss;
  ctx.fillRect(cx - padW / 2, cy + padH / 2 - Math.max(1, 2 * scale), padW, Math.max(1, 2 * scale));
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(cx - plaqueW / 2, cy - plaqueH / 2, plaqueW, plaqueH);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - plaqueW / 2, cy - plaqueH / 2, plaqueW, plaqueH);
  const key = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  if (key === "health") {
    const armL = Math.max(1, 10 * scale);
    const armT = Math.max(1, 4 * scale);
    ctx.fillStyle = pad.edgeCss;
    ctx.fillRect(cx - armL / 2, cy - armT / 2, armL, armT);
    ctx.fillRect(cx - armT / 2, cy - armL / 2, armT, armL);
    return;
  }
  if (key === "grenades" || key === "grenade") {
    const r = Math.max(2, 5 * scale);
    ctx.fillStyle = "#a3e635";
    ctx.beginPath();
    ctx.arc(cx, cy + scale, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d9f99d";
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy, Math.max(1, r * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.4, cy - r - 2 * scale);
    ctx.lineTo(cx + r + 2 * scale, cy - r - 2 * scale);
    ctx.stroke();
    return;
  }
  const plaque = weaponPlaqueFor(weapon);
  const gunL = plaque.length * scale;
  ctx.strokeStyle = plaque.colorCss;
  ctx.lineWidth = Math.max(1.5, 3 * scale);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - gunL / 2, cy);
  ctx.lineTo(cx + gunL / 2, cy);
  ctx.stroke();
  ctx.fillStyle = "#fde047";
  ctx.beginPath();
  ctx.arc(cx + gunL / 2, cy, Math.max(1, 1.5 * scale), 0, Math.PI * 2);
  ctx.fill();
}
