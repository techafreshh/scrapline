// Composed vector character sprite: pure local-space geometry for one
// player figure in a 26x58 frame (PLAYER_WIDTH x PLAYER_HEIGHT), plus the
// team palettes and the weapon-muzzle helper. Dependency-free apart from
// the core size constants and the shared barrel math, so it stays
// unit-testable under node with no DOM or Pixi imports. Both renderer
// backends draw this same geometry (Pixi containers bake it once and
// re-pose it per frame; the canvas2d fallback redraws it every frame),
// so friend-vs-foe reads identically on either backend.
import {
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "../../../core/src/constants";
import { BARREL_LENGTH, barrelEndpoint } from "../renderer/index";

/** Authored character frame width in local px (matches PLAYER_WIDTH). */
export const CHARACTER_W = PLAYER_WIDTH;
/** Authored character frame height in local px (matches PLAYER_HEIGHT). */
export const CHARACTER_H = PLAYER_HEIGHT;
/** Vertical squash applied to the standing frame for a crouching pose. */
export const CROUCH_SQUASH = PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT;
/** Arm/weapon pivot in local frame px (the body center the muzzle orbits). */
export const ARM_PIVOT = { x: 13, y: 29 };
/**
 * Weapon barrel segment in pivot-relative px (rest pose points at +x).
 * A function (not a const) so character.ts never reads the shared
 * BARREL_LENGTH at module top level: renderer/index.ts imports this
 * module, and a top-level read would TDZ-crash whichever entry point
 * loads the renderer first.
 */
export function gunBarrel(): { x1: number; y1: number; x2: number; y2: number; width: number } {
  return { x1: 5, y1: 0, x2: BARREL_LENGTH, y2: 0, width: 3 };
}
/** Weapon muzzle dot in pivot-relative px (sits exactly at BARREL_LENGTH). */
export function gunMuzzle(): { x: number; y: number; r: number } {
  return { x: BARREL_LENGTH, y: 0, r: 2 };
}
/** Dark visor paint (contrasts every team-colored head disc). */
export const VISOR_HEX = 0x0f172a;
/** Dark visor paint as CSS. */
export const VISOR_CSS = "#0f172a";

/** Local player family: cyan. */
export const LOCAL_HEX = 0x00e5ff;
/** Local player family as CSS (uppercase; probes compare case-insensitively). */
export const LOCAL_CSS = "#00E5FF";
/** Enemy family A (odd player indices): vivid orange-red. */
export const ENEMY_A_HEX = 0xff6b35;
/** Enemy family A as CSS. */
export const ENEMY_A_CSS = "#FF6B35";
/** Enemy family B (even nonzero player indices): warm amber. */
export const ENEMY_B_HEX = 0xffb347;
/** Enemy family B as CSS. */
export const ENEMY_B_CSS = "#FFB347";

/**
 * Named sprite parts, front to back. Two leg rects, the torso, the head
 * disc, the dark visor, and the two aim-driven arms (armR carries the
 * held weapon whose muzzle sits at BARREL_LENGTH from the pivot).
 */
export const PART_NAMES = [
  "legL",
  "legR",
  "body",
  "head",
  "visor",
  "armL",
  "armR",
] as const;

/** One named sprite part. */
export type PartName = (typeof PART_NAMES)[number];

/** Axis-aligned box part in local frame px (legs, torso, visor). */
export interface PartRect {
  kind: "rect";
  name: PartName;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Disc part in local frame px (head). */
export interface PartCircle {
  kind: "circle";
  name: PartName;
  cx: number;
  cy: number;
  r: number;
}

/**
 * Thick-segment part in pivot-relative px (arms). Renderers translate to
 * ARM_PIVOT and rotate by the aim angle; the rest pose points at +x
 * (aim 0) so rotation by aim lands the hand end on the aim ray.
 */
export interface PartLimb {
  kind: "limb";
  name: PartName;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

/** One drawable piece of the composed figure. */
export type CharacterPart = PartRect | PartCircle | PartLimb;

/** Standing-pose part boxes in the 26x58 local frame. */
function standingParts(): CharacterPart[] {
  return [
    { kind: "rect", name: "legL", x: 4, y: 44, w: 7, h: 14 },
    { kind: "rect", name: "legR", x: 15, y: 44, w: 7, h: 14 },
    { kind: "rect", name: "body", x: 5, y: 20, w: 16, h: 24 },
    { kind: "circle", name: "head", cx: 13, cy: 12, r: 8 },
    { kind: "rect", name: "visor", x: 7, y: 9, w: 12, h: 5 },
    { kind: "limb", name: "armL", x1: 0, y1: -4, x2: 6, y2: 0, width: 4 },
    { kind: "limb", name: "armR", x1: 0, y1: 4, x2: 6, y2: 0, width: 4 },
  ];
}

/**
 * Part descriptors for one pose. Standing returns the authored 26x58
 * boxes; crouching pre-multiplies every y-axis measurement by
 * CROUCH_SQUASH (feet stay planted at the squashed height), so the
 * canvas2d fallback draws the crouch directly while the Pixi backend
 * bakes the standing pose once and squashes via container scaleY.
 */
export function characterParts(crouch: boolean): CharacterPart[] {
  if (!crouch) {
    return standingParts();
  }
  return standingParts().map((part): CharacterPart => {
    if (part.kind === "rect") {
      return { ...part, y: part.y * CROUCH_SQUASH, h: part.h * CROUCH_SQUASH };
    }
    if (part.kind === "circle") {
      return { ...part, cy: part.cy * CROUCH_SQUASH };
    }
    return {
      ...part,
      y1: part.y1 * CROUCH_SQUASH,
      y2: part.y2 * CROUCH_SQUASH,
    };
  });
}

/** Cosmetic pick shape for pre-match identity (helmet/visor/palette). */
export interface CosmeticPick {
  helmet: string;
  visor: string;
  palette: string;
}

/**
 * Diversity key for a cosmetic pick: `helmet+visor`. Enemy slots
 * compare on this key so bots stop looking identical.
 */
export function cosmeticKey(pick: { helmet: string; visor: string }): string {
  return `${pick.helmet}+${pick.visor}`;
}

/**
 * Convert a #RRGGBB CSS color to a Pixi hex int; corrupt input falls
 * back to the local cyan so accents never poison a tint.
 */
export function accentHex(css: unknown): number {
  if (typeof css === "string") {
    const full = css.trim().match(/^#([0-9a-fA-F]{6})$/);
    if (full?.[1] !== undefined) {
      return Number.parseInt(full[1], 16);
    }
    const short = css.trim().match(/^#([0-9a-fA-F]{3})$/);
    if (short?.[1] !== undefined) {
      const expanded = short[1].split("").map((c) => c + c).join("");
      return Number.parseInt(expanded, 16);
    }
  }
  return LOCAL_HEX;
}

/** Team Pixi-hex for a player index: 0 local, odd enemy A, even enemy B. */
export function teamColor(index: number): number {
  if (index === 0) {
    return LOCAL_HEX;
  }
  return index % 2 === 1 ? ENEMY_A_HEX : ENEMY_B_HEX;
}

/** Team CSS color for a player index: 0 local, odd enemy A, even enemy B. */
export function teamCss(index: number): string {
  if (index === 0) {
    return LOCAL_CSS;
  }
  return index % 2 === 1 ? ENEMY_A_CSS : ENEMY_B_CSS;
}

/**
 * Weapon muzzle in world coords for a body center and aim angle.
 * Delegates to the shared barrel math, so the composed weapon tip and
 * the tracer origin coincide by construction (never re-derive this).
 */
export function characterMuzzle(
  centerX: number,
  centerY: number,
  aim: number,
): { x: number; y: number } {
  return barrelEndpoint(centerX, centerY, aim);
}
