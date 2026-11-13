// Per-player composed-sprite nodes plus the window.__game probe
// publisher. Headless-safe: Pixi is consumed through a structural
// interface (never imported), so node unit tests drive the plain-object
// stub branch while the live Pixi backend gets real Containers with one
// Graphics child per named part.
import {
  DEAD_LIFT_PX,
  DEAD_SPLAY_PX,
  TUCK_IN_PX,
  TUCK_UP_PX,
} from "./anim";
import {
  ARM_PIVOT,
  CHARACTER_H,
  CHARACTER_W,
  LOCAL_CSS,
  PART_NAMES,
  VISOR_HEX,
  characterParts,
  gunBarrel,
  gunMuzzle,
  teamCss,
  type PartName,
} from "./character";

/** Minimal 2D point with a Pixi-style set method. */
export interface PointLike {
  set(x: number, y: number): void;
}

/** Structural Pixi Graphics surface (mirrors the renderer paint style). */
export interface GraphicsLike {
  label: string;
  position: PointLike;
  rotation: number;
  tint: number | string;
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
  children: GraphicsLike[];
  addChild(child: GraphicsLike): void;
}

/** Structural Pixi module surface (Container + Graphics constructors). */
export interface PixiFactory {
  Container: new () => ContainerLike;
  Graphics: new () => GraphicsLike;
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
function drawPartInto(graphics: GraphicsLike, partName: PartName): void {
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
      // weapon: a stock segment plus the barrel ending in the muzzle dot
      // at exactly BARREL_LENGTH from the pivot.
      graphics.moveTo(part.x1, part.y1);
      graphics.lineTo(part.x2, part.y2);
      graphics.stroke({ width: part.width, color: 0xffffff });
      if (partName === "armR") {
        const barrel = gunBarrel();
        const dot = gunMuzzle();
        graphics.moveTo(barrel.x1, barrel.y1);
        graphics.lineTo(barrel.x2, barrel.y2);
        graphics.stroke({ width: barrel.width, color: 0xffffff });
        graphics.circle(dot.x, dot.y, dot.r);
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
  /** Tucked legs while jetting (both up and toward center). */
  tuck?: boolean;
  /** White hurt flash (overrides the team/victim tint). */
  hurtFlash?: boolean;
  /** Burst pose while dead (legs splayed outward). */
  deadPose?: boolean;
}

/**
 * Pose one node for the frame: position/scale the container, rotate only
 * the arm children toward aim (the body stays upright), tint the
 * white-baked parts, and apply spawn-blink alpha. Run-cycle leg swing
 * offsets the leg children in opposition, jetting tucks both legs up and
 * toward the center, hurt flashes every non-visor child white, and death
 * splays the legs into the burst pose. Stubs record nothing
 * pose-specific (their shape is the probe contract).
 */
export function syncPlayerNode(node: PlayerNode, pose: SyncPose): void {
  if (!("children" in node) || !("position" in node)) {
    return;
  }
  const container = node;
  container.position.set(pose.x, pose.y);
  container.scale.set(pose.scale, pose.scale * pose.squash);
  container.alpha = pose.alpha;
  container.visible = pose.visible;
  const swing = pose.legSwing ?? 0;
  const tuck = pose.tuck === true;
  const dead = pose.deadPose === true;
  const tint = pose.hurtFlash === true ? 0xffffff : pose.colorHex;
  for (const child of container.children) {
    if (child.label === "legL" || child.label === "legR") {
      const side = child.label === "legL" ? -1 : 1;
      if (dead) {
        child.position.set(side * DEAD_SPLAY_PX, -DEAD_LIFT_PX);
      } else if (tuck) {
        child.position.set(side * -TUCK_IN_PX, -TUCK_UP_PX);
      } else {
        child.position.set(0, side * swing);
      }
      child.tint = tint;
    } else if (child.label === "armL" || child.label === "armR") {
      child.rotation = pose.aim;
      child.tint = tint;
    } else if (child.label === "visor") {
      child.tint = 0xffffff;
    } else {
      child.tint = tint;
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
}

export function publishGameProbes(
  nodes: readonly PlayerNode[],
  indices: readonly number[],
  colors: readonly { color: number; colorCss: string }[],
  muzzle: { x: number; y: number },
  weaponTip: { x: number; y: number },
  anim?: AnimProbes,
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
    };
  });
  Object.assign(game, {
    players,
    legPhase: anim?.legPhase ?? 0,
    isFlameVisible: anim?.isFlameVisible ?? false,
    isFlickerRectVisible: false,
    playerHeightScale: anim?.playerHeightScale ?? 1,
    isHurtFlash: anim?.isHurtFlash ?? false,
    spritePartCount: PART_NAMES.length,
    localPlayerColor: LOCAL_CSS,
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
