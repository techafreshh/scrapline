// Per-player composed-sprite nodes plus the window.__game probe
// publisher. Headless-safe: Pixi is consumed through a structural
// interface (never imported), so node unit tests drive the plain-object
// stub branch while the live Pixi backend gets real Containers with one
// Graphics child per named part.
import type { WeaponId } from "../../../core/src/weapons";
import {
  selectSoldierFrame,
  soldierAccentFor,
  soldierLegOffsetBlended,
  weaponDef,
  type SoldierFrameId,
} from "./soldier";
import {
  ARM_PIVOT,
  CHARACTER_H,
  CHARACTER_W,
  LOCAL_CSS,
  PART_NAMES,
  VISOR_HEX,
  characterParts,
  teamCss,
  type PartName,
} from "./character";

/** Minimal 2D point with a Pixi-style set method. */
export interface PointLike {
  set(x: number, y: number): void;
}

/** Structural Pixi Sprite surface: the soldier-card overlay (issue #281).
 *  Only the fields the poser touches are modeled; the live Pixi Sprite
 *  carries the rest (texture, width/height). `textureKey` is optional so
 *  a verbatim `PIXI.Sprite` still satisfies the factory structurally. */
export interface SpriteLike {
  label: string;
  position: PointLike;
  tint: number | string;
  visible: boolean;
  textureKey?: string | null;
  width?: number;
  height?: number;
}

/** Structural Pixi Graphics surface (mirrors the renderer paint style). */
export interface GraphicsLike {
  label: string;
  position: PointLike;
  rotation: number;
  tint: number | string;
  /** Hidden while the soldier card covers the vector body (issue #281). */
  visible?: boolean;
  clear?(): unknown;
  rect(x: number, y: number, w: number, h: number): unknown;
  circle(x: number, y: number, r: number): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  stroke(style?: { width?: number; color?: number }): unknown;
  fill(style?: number | { color?: number }): unknown;
}

/** Structural Pixi Container surface. */
export interface ContainerLike {
  label: string;
  alpha: number;
  visible: boolean;
  position: PointLike;
  scale: PointLike;
  children: Array<GraphicsLike | SpriteLike>;
  addChild(child: GraphicsLike | SpriteLike): void;
}

/** Structural Pixi module surface (Container + Graphics constructors,
 *  plus the optional soldier-card Sprite for the pack swap). The Sprite
 *  member stays optional so the existing Graphics-only fakes (and every
 *  committed node test) keep typechecking while the live Pixi factory
 *  passes its verbatim Sprite constructor. */
export interface PixiFactory {
  Container: new () => ContainerLike;
  Graphics: new () => GraphicsLike;
  Sprite?: new () => SpriteLike;
  /** Structural texture upload (tinted-card canvas to GPU, issue #281). */
  Texture?: { from(source: unknown, skipCache?: boolean): unknown };
}

/** Structural Pixi stage surface (containers attach exactly once). */
export interface StageLike {
  addChild(child: ContainerLike): unknown;
}

/** Plain-object fallback node (canvas2d backend and headless probes). */
export interface StubNode {
  kind: "stub";
  name: string;
  visible: boolean;
  children: { name: string; label?: string }[];
}

/** One live per-player node: a real Pixi container or a stub. */
export type PlayerNode = ContainerLike | StubNode;

/** Probe-facing player entry published under window.__game.players. */
export interface ProbePlayer {
  index: number;
  node: {
    name: string;
    children: { name: string; label?: string }[];
  };
  color: number;
  colorCss: string;
  /** Selected soldier frame id for this player (additive probe field). */
  frame?: SoldierFrameId;
  /** Equipped weapon id for this player (additive probe field). */
  weapon?: WeaponId;
  /** Walk↔sprint blend for this player (additive probe field). */
  gaitBlend?: number;
  /** Stand↔crouch air blend for this player (additive probe field). */
  airBlend?: number;
  /** Alias of airBlend (crouch weight while airborne). */
  crouchWeight?: number;
  /** Smoothed aim for this player (additive probe field). */
  aimSmoothed?: number;
  /** Landing squash for this player (additive probe field). */
  landSquash?: number;
  /** Spawn ease for this player (additive probe field). */
  spawnEase?: number;
  /** Death ease for this player (additive probe field). */
  deathEase?: number;
  /** Live pack-sprite texture for this player (additive probe field,
   *  issue #281: `soldier.*` locally, `<set>.*` per bot). */
  texture?: string;
}

/** Write an expando field without fighting the Pixi v8 typings. */
function setField(node: object, key: string, value: string): void {
  (node as unknown as Record<string, unknown>)[key] = value;
}

/** Read the probe-facing name off either node kind. */
function nodeName(node: PlayerNode): string {
  if ("label" in node) {
    return node.label;
  }
  return node.name;
}

/** Draw one part descriptor into a Graphics child (Pixi local coords). */
function drawPartInto(
  graphics: GraphicsLike,
  partName: PartName,
  weapon: WeaponId = "pistol",
): void {
  const parts = characterParts(false);
  for (const part of parts) {
    if (part.name !== partName) {
      continue;
    }
    if (part.kind === "rect") {
      graphics.rect(part.x, part.y, part.w, part.h);
      graphics.fill(partName === "visor" ? VISOR_HEX : 0xffffff);
    } else if (part.kind === "circle") {
      graphics.circle(part.cx, part.cy, part.r);
      graphics.fill(0xffffff);
    } else {
      // Limb drawn pivot-relative; the child is positioned at ARM_PIVOT
      // and rotated by aim in syncPlayerNode. armR carries the held
      // weapon: a stock segment plus the WEAPON_DEFS gun ending in the
      // muzzle dot at the per-weapon length from the pivot.
      graphics.moveTo(part.x1, part.y1);
      graphics.lineTo(part.x2, part.y2);
      graphics.stroke({ width: part.width, color: 0xffffff });
      if (partName === "armR") {
        const gun = weaponDef(weapon);
        graphics.moveTo(5, 0);
        graphics.lineTo(gun.length, 0);
        graphics.stroke({ width: gun.width, color: 0xffffff });
        graphics.circle(gun.muzzleX, 0, 2);
        graphics.fill(0xffffff);
      }
    }
  }
}

/**
 * Build one per-player node. With a Pixi factory this is a real
 * Container with one Graphics child per PART_NAMES entry (body parts at
 * local frame coords, arm children pivoted at ARM_PIVOT for aim
 * rotation); without it a plain-object stub with the same named
 * children, so probes read the same shape on either backend.
 */
export function buildPlayerNode(
  pixi: PixiFactory | null,
  index: number,
): PlayerNode {
  if (pixi === null || pixi === undefined) {
    return {
      kind: "stub",
      name: `player${index}`,
      visible: true,
      children: PART_NAMES.map((name) => ({ name, label: name })),
    };
  }
  const container = new pixi.Container();
  container.label = `player${index}`;
  setField(container, "name", `player${index}`);
  for (const name of PART_NAMES) {
    const child = new pixi.Graphics();
    child.label = name;
    setField(child, "name", name);
    if (name === "armL" || name === "armR") {
      child.position.set(ARM_PIVOT.x, ARM_PIVOT.y);
    }
    drawPartInto(child, name);
    container.addChild(child);
  }
  // Soldier-card overlay (issue #281): the pack sprite rides above the
  // vector body once a texture resolves, so the WebGL backend paints
  // the same `platformer-characters` art the canvas2d backend draws.
  // Graphics-only fakes (and the canvas2d stubs above) skip this child
  // and keep the exact 7-part shape the committed tests pin.
  if (pixi.Sprite !== undefined && pixi.Sprite !== null) {
    try {
      const sprite = new pixi.Sprite();
      sprite.label = "soldierSprite";
      setField(sprite, "name", "soldierSprite");
      sprite.position.set(0, 0);
      sprite.tint = 0xffffff;
      sprite.visible = false;
      sprite.textureKey = null;
      container.addChild(sprite);
    } catch {
      // Sprite construction best-effort only: the vector body stays.
    }
  }
  return container;
}

/** Per-frame pose for one node. */
export interface SyncPose {
  /** Screen-space top-left of the authored frame (backing-store px). */
  x: number;
  y: number;
  /** World-to-screen scale (cam.scale). */
  scale: number;
  /** Aim angle in radians (rotates only the arm/weapon children). */
  aim: number;
  /** Team/victim tint hex (white-baked parts take this color). */
  colorHex: number;
  /** Spawn-blink opacity. */
  alpha: number;
  /** Vertical squash (crouch h / 58); 1 while standing. */
  squash: number;
  /** Hidden while beyond the live player count. */
  visible: boolean;
  /** Signed leg offset in local px (legL -swing, legR +swing). */
  legSwing?: number;
  /** Wall-clock run-cycle phase in radians (run-a/b quadrant for frame-less callers; same convention as SoldierPoseInput.legPhase). */
  legPhase?: number;
  /** Tucked legs while jetting (both up and toward center). */
  tuck?: boolean;
  /** White hurt flash (overrides the team/victim tint). */
  hurtFlash?: boolean;
  /** Burst pose while dead (legs splayed outward). */
  deadPose?: boolean;
  /** Equipped weapon id (re-draws the armR gun at its length). */
  weapon?: WeaponId;
  /** Selected soldier frame (drives the frame-specific leg offsets). */
  frame?: SoldierFrameId;
  /** Walk↔sprint blend in [0, 1] (weights the stride, defaults to 1). */
  gaitBlend?: number;
  /** Stand↔crouch air blend in [0, 1] (widens/lowers the stance). */
  airBlend?: number;
  /** Smoothed aim in radians (rotates the arms, no ±π snap). */
  aimSmoothed?: number;
  /** Landing squash (multiplies scale.y through the 4-frame dip). */
  landSquash?: number;
  /** Spawn ease in [0, 1] (rides the ease scale, blink alpha untouched). */
  spawnEase?: number;
  /** Death ease in [0, 1] (rides the ease scale, dead pose untouched). */
  deathEase?: number;
  /** Pack-sprite texture for this pose (`soldier.*` / `<set>.*` manifest
   *  key, issue #281). Null hides the card and restores the vector body;
   *  the renderer passes null while a victim flash is live so the red
   *  vector reads, mirroring the canvas2d `if (!flashed)` guard. */
  textureKey?: string | null;
}

/**
 * Pose one node for the frame: position/scale the container, rotate only
 * the arm children toward aim (the body stays upright), tint the
 * white-baked parts, and apply spawn-blink alpha. Legs take the
 * frame-specific soldierLegOffset for the selected frame (run-a/run-b
 * stride in opposition, jet tucks both legs, death splays them), hurt
 * flashes every non-visor child white, and the armR gun is re-drawn at
 * the pose weapon's length when the backend supports clear. Frame-less
 * callers select run-a/run-b from legPhase/legSwing while an explicit
 * frame bypasses selection. Stubs record
 * nothing pose-specific (their shape is the probe contract).
 */
export function syncPlayerNode(node: PlayerNode, pose: SyncPose): void {
  if (!("children" in node) || !("position" in node)) {
    return;
  }
  const container = node;
  container.position.set(pose.x, pose.y);
  const landSquash =
    typeof pose.landSquash === "number" && Number.isFinite(pose.landSquash)
      ? pose.landSquash
      : 1;
  container.scale.set(pose.scale, pose.scale * pose.squash * landSquash);
  container.alpha = pose.alpha;
  container.visible = pose.visible;
  const swing = pose.legSwing ?? 0;
  const airBlend =
    typeof pose.airBlend === "number" && Number.isFinite(pose.airBlend)
      ? Math.min(1, Math.max(0, pose.airBlend))
      : 0;
  const gaitBlend =
    typeof pose.gaitBlend === "number" && Number.isFinite(pose.gaitBlend)
      ? Math.min(1, Math.max(0, pose.gaitBlend))
      : 1;
  const aim =
    typeof pose.aimSmoothed === "number" && Number.isFinite(pose.aimSmoothed)
      ? pose.aimSmoothed
      : pose.aim;
  const frame: SoldierFrameId =
    pose.frame ??
    selectSoldierFrame({
      deadPose: pose.deadPose,
      tuck: pose.tuck,
      legPhase: pose.legPhase ?? 0,
      swing,
    });
  const tint = pose.hurtFlash === true ? 0xffffff : pose.colorHex;
  // Soldier-card intent (issue #281): the overlay child carries the live
  // manifest key so the WebGL backend paints the same pack art the
  // canvas2d backend draws via tintedSoldierFor. The renderer
  // materializes the tinted canvas into a GPU texture; headless fakes
  // assert on this intent alone (key + visibility), never on pixels.
  const textureKey =
    typeof pose.textureKey === "string" && pose.textureKey.length > 0
      ? pose.textureKey
      : null;
  for (const child of container.children) {
    if (child.label !== "soldierSprite") {
      continue;
    }
    const sprite = child as SpriteLike;
    sprite.textureKey = textureKey;
    sprite.visible = textureKey !== null;
    if (textureKey !== null) {
      sprite.tint = 0xffffff;
    }
  }
  // The card already carries legs/torso/head: hide the vector body
  // while it is live (arms stay: they rotate the held gun above the
  // card, mirroring the canvas2d spritePainted path in drawCharacter2D).
  const spriteLive =
    textureKey !== null &&
    container.children.some((child) => child.label === "soldierSprite");
  for (const child of container.children) {
    if (child.label === "soldierSprite" || "textureKey" in child) {
      continue;
    }
    const gfx = child as GraphicsLike;
    if (gfx.label === "legL" || gfx.label === "legR") {
      const side = gfx.label === "legL" ? -1 : 1;
      const { dx, dy } = soldierLegOffsetBlended(
        frame,
        swing,
        side,
        gaitBlend,
        airBlend,
      );
      gfx.position.set(dx, dy);
      gfx.tint = tint;
    } else if (gfx.label === "armL" || gfx.label === "armR") {
      gfx.rotation = aim;
      gfx.tint = tint;
      if (
        gfx.label === "armR" &&
        pose.weapon !== undefined &&
        typeof gfx.clear === "function"
      ) {
        gfx.clear();
        drawPartInto(gfx, "armR", pose.weapon);
      }
    } else if (gfx.label === "visor") {
      gfx.tint = 0xffffff;
    } else {
      gfx.tint = tint;
    }
    gfx.visible = spriteLive ? gfx.label === "armL" || gfx.label === "armR" : true;
  }
  if (spriteLive) {
    // Arms above the card (live Pixi moves an re-added child to the
    // top, matching the canvas2d gun-over-sprite order); Graphics-only
    // fakes never reach here without a soldierSprite child.
    for (const label of ["armL", "armR"] as const) {
      const arm = container.children.find((child) => child.label === label);
      if (arm !== undefined) {
        try {
          container.addChild(arm);
        } catch {
          // Shorn stage: paint order best-effort only.
        }
      }
    }
  }
}

/**
 * Merge the composed-sprite probe surface into window.__game (never
 * replace the object: main.ts owns the tick/state fields updated around
 * each draw). `nodes` are the live per-player nodes (real Pixi
 * containers or stubs); `indices` selects the published players;
 * muzzle and weaponTip are the same projected screen point, so the
 * tracer-origin coincidence probe reads 0 by construction.
 */
/** Animation probe values for the local player (player 0 globals). */
export interface AnimProbes {
  legPhase: number;
  isFlameVisible: boolean;
  playerHeightScale: number;
  isHurtFlash: boolean;
  /** Walk↔sprint blend for the local player (additive probe field). */
  gaitBlend?: number;
  /** Stand↔crouch air blend for the local player (additive probe field). */
  airBlend?: number;
  /** Alias of airBlend (crouch weight while airborne). */
  crouchWeight?: number;
  /** Smoothed aim for the local player (additive probe field). */
  aimSmoothed?: number;
  /** Landing squash for the local player (additive probe field). */
  landSquash?: number;
  /** Alias of landSquash (vertical scale through the landing dip). */
  scaleY?: number;
  /** Spawn ease for the local player (additive probe field). */
  spawnEase?: number;
  /** Death ease for the local player (additive probe field). */
  deathEase?: number;
}

export function publishGameProbes(
  nodes: readonly PlayerNode[],
  indices: readonly number[],
  colors: readonly { color: number; colorCss: string }[],
  muzzle: { x: number; y: number },
  weaponTip: { x: number; y: number },
  anim?: AnimProbes,
  extras?: readonly {
    frame?: SoldierFrameId;
    weapon?: WeaponId;
    gaitBlend?: number;
    airBlend?: number;
    crouchWeight?: number;
    aimSmoothed?: number;
    landSquash?: number;
    spawnEase?: number;
    deathEase?: number;
    /** Live pack-sprite texture (`soldier.*` / `<set>.*`, issue #281). */
    texture?: string;
  }[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  const game = window.__game as unknown as Record<string, unknown>;
  if (game === null || typeof game !== "object") {
    return;
  }
  const players: ProbePlayer[] = indices.map((index, k) => {
    const node = nodes[k];
    const entry = colors[k] ?? { color: 0x00e5ff, colorCss: LOCAL_CSS };
    const children =
      node !== undefined && "children" in node
        ? node.children.map((child) => {
            const label =
              "label" in child && typeof child.label === "string"
                ? child.label
                : undefined;
            const name =
              "name" in child && typeof child.name === "string"
                ? (child.name as string)
                : (label ?? "");
            return label === undefined ? { name } : { name, label };
          })
        : PART_NAMES.map((name) => ({ name, label: name }));
    return {
      index,
      node: {
        name: node === undefined ? `player${index}` : nodeName(node),
        children,
      },
      color: entry.color,
      colorCss: entry.colorCss,
      ...(extras?.[k]?.frame !== undefined
        ? { frame: extras[k]?.frame as SoldierFrameId }
        : {}),
      ...(extras?.[k]?.weapon !== undefined
        ? { weapon: extras[k]?.weapon as WeaponId }
        : {}),
      ...(typeof extras?.[k]?.gaitBlend === "number"
        ? { gaitBlend: extras[k]?.gaitBlend as number }
        : {}),
      ...(typeof extras?.[k]?.airBlend === "number"
        ? { airBlend: extras[k]?.airBlend as number }
        : {}),
      ...(typeof extras?.[k]?.crouchWeight === "number"
        ? { crouchWeight: extras[k]?.crouchWeight as number }
        : {}),
      ...(typeof extras?.[k]?.aimSmoothed === "number"
        ? { aimSmoothed: extras[k]?.aimSmoothed as number }
        : {}),
      ...(typeof extras?.[k]?.landSquash === "number"
        ? { landSquash: extras[k]?.landSquash as number }
        : {}),
      ...(typeof extras?.[k]?.spawnEase === "number"
        ? { spawnEase: extras[k]?.spawnEase as number }
        : {}),
      ...(typeof extras?.[k]?.deathEase === "number"
        ? { deathEase: extras[k]?.deathEase as number }
        : {}),
      ...(typeof extras?.[k]?.texture === "string"
        ? { texture: extras[k]?.texture as string }
        : {}),
    };
  });
  Object.assign(game, {
    players,
    legPhase: anim?.legPhase ?? 0,
    isFlameVisible: anim?.isFlameVisible ?? false,
    isFlickerRectVisible: false,
    playerHeightScale: anim?.playerHeightScale ?? 1,
    isHurtFlash: anim?.isHurtFlash ?? false,
    gaitBlend: anim?.gaitBlend ?? 0,
    airBlend: anim?.airBlend ?? anim?.crouchWeight ?? 0,
    crouchWeight: anim?.crouchWeight ?? anim?.airBlend ?? 0,
    aimSmoothed: anim?.aimSmoothed ?? 0,
    landSquash: anim?.landSquash ?? anim?.scaleY ?? 1,
    scaleY: anim?.scaleY ?? anim?.landSquash ?? 1,
    spawnEase: anim?.spawnEase ?? 1,
    deathEase: anim?.deathEase ?? 1,
    spritePartCount: PART_NAMES.length,
    // Locker accent rides the menu/match soldier: the local probe
    // color follows the equipped palette (team cyan when unset) so
    // the in-match helmet assertion reads the locker pick.
    localPlayerColor: soldierAccentFor(0),
    firstEnemyColor: teamCss(1),
    playerBounds: {
      w: CHARACTER_W,
      h: CHARACTER_H,
      width: CHARACTER_W,
      height: CHARACTER_H,
    },
    muzzle: { x: muzzle.x, y: muzzle.y },
    weaponTip: { x: weaponTip.x, y: weaponTip.y },
    muzzleX: muzzle.x,
    muzzleY: muzzle.y,
    weaponTipX: weaponTip.x,
    weaponTipY: weaponTip.y,
  });
}
