// Composed vector character sprite: pure part geometry in the 26x58
// frame, team palettes, muzzle coincidence with the barrel tip, and the
// window.__game probe shape published for both renderer backends.
// World-driven fixtures, no DOM (window is stubbed for the probe case).
import { afterEach, describe, expect, it } from "vitest";
import {
  ARM_PIVOT,
  CHARACTER_H,
  CHARACTER_W,
  CROUCH_SQUASH,
  ENEMY_A_CSS,
  ENEMY_A_HEX,
  ENEMY_B_CSS,
  ENEMY_B_HEX,
  LOCAL_CSS,
  LOCAL_HEX,
  PART_NAMES,
  VISOR_CSS,
  characterMuzzle,
  characterParts,
  gunMuzzle,
  teamColor,
  teamCss,
} from "../src/view/character";
import {
  buildPlayerNode,
  publishGameProbes,
  syncPlayerNode,
  type GraphicsLike,
  type PixiFactory,
  type PlayerNode,
} from "../src/view/playerView";
import { BARREL_LENGTH, barrelEndpoint } from "../src/renderer/index";
import { PLAYER_CROUCH_HEIGHT } from "../../core/src/constants";
import { createCamera, projectCamera, updateCamera } from "../src/renderer/camera";

function installWindow(): void {
  (globalThis as unknown as Record<string, unknown>)["window"] = {
    __game: {},
  };
}

function readGame(): Record<string, unknown> {
  const w = (globalThis as unknown as Record<string, unknown>)[
    "window"
  ] as Record<string, unknown>;
  return w["__game"] as Record<string, unknown>;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["window"];
});

describe("character frame geometry", () => {
  it("exposes seven named parts in a 26x58 authored frame", () => {
    expect(CHARACTER_W).toBe(26);
    expect(CHARACTER_H).toBe(58);
    expect([...PART_NAMES]).toEqual([
      "legL",
      "legR",
      "body",
      "head",
      "visor",
      "armL",
      "armR",
    ]);
    const parts = characterParts(false);
    expect(parts).toHaveLength(7);
    expect(parts.map((p) => p.name)).toEqual([...PART_NAMES]);
  });

  it("keeps every standing part inside the frame with features >= 3px", () => {
    for (const part of characterParts(false)) {
      if (part.kind === "rect") {
        expect(part.x).toBeGreaterThanOrEqual(0);
        expect(part.y).toBeGreaterThanOrEqual(0);
        expect(part.x + part.w).toBeLessThanOrEqual(26);
        expect(part.y + part.h).toBeLessThanOrEqual(58);
        expect(Math.min(part.w, part.h)).toBeGreaterThanOrEqual(3);
      } else if (part.kind === "circle") {
        expect(part.cx - part.r).toBeGreaterThanOrEqual(0);
        expect(part.cx + part.r).toBeLessThanOrEqual(26);
        expect(part.cy - part.r).toBeGreaterThanOrEqual(0);
        expect(part.cy + part.r).toBeLessThanOrEqual(58);
        expect(part.r * 2).toBeGreaterThanOrEqual(3);
      } else {
        expect(part.width).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("contrasts the dark visor against the team-colored head", () => {
    expect(VISOR_CSS).not.toBe(LOCAL_CSS);
    expect(VISOR_CSS).not.toBe(ENEMY_A_CSS);
    expect(VISOR_CSS).not.toBe(ENEMY_B_CSS);
  });

  it("squashes the crouch pose toward the 40px crouch height", () => {
    expect(CHARACTER_H * CROUCH_SQUASH).toBeCloseTo(PLAYER_CROUCH_HEIGHT, 10);
    let maxY = 0;
    for (const part of characterParts(true)) {
      if (part.kind === "rect") {
        maxY = Math.max(maxY, part.y + part.h);
      } else if (part.kind === "circle") {
        maxY = Math.max(maxY, part.cy + part.r);
      }
    }
    expect(maxY).toBeLessThanOrEqual(PLAYER_CROUCH_HEIGHT + 8);
    expect(maxY).toBeGreaterThan(PLAYER_CROUCH_HEIGHT - 16);
  });
});

describe("team palettes", () => {
  it("paints the local player cyan", () => {
    expect(teamCss(0)).toBe("#00E5FF");
    expect(teamCss(0)).toBe(LOCAL_CSS);
    expect(teamColor(0)).toBe(0x00e5ff);
    expect(teamColor(0)).toBe(LOCAL_HEX);
  });

  it("alternates enemies between vivid orange-red and warm amber", () => {
    expect(teamCss(1)).toBe("#FF6B35");
    expect(teamColor(1)).toBe(0xff6b35);
    expect(teamColor(1)).toBe(ENEMY_A_HEX);
    expect(teamCss(2)).toBe("#FFB347");
    expect(teamColor(2)).toBe(0xffb347);
    expect(teamColor(2)).toBe(ENEMY_B_HEX);
    expect(teamCss(3)).toBe("#FF6B35");
    expect(teamCss(1)).toMatch(/^#FF(6B35|B347)$/);
    expect(teamCss(2)).toMatch(/^#FF(6B35|B347)$/);
  });
});

describe("weapon muzzle coincidence", () => {
  it("delegates characterMuzzle to the shared barrel tip on cardinal aims", () => {
    expect(BARREL_LENGTH).toBe(8);
    for (const aim of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      expect(characterMuzzle(100, 100, aim)).toEqual(
        barrelEndpoint(100, 100, aim),
      );
      const tip = characterMuzzle(100, 100, aim);
      expect(Math.hypot(tip.x - 100, tip.y - 100)).toBeCloseTo(8, 10);
    }
  });

  it("places the pivot-relative muzzle dot at BARREL_LENGTH from the pivot", () => {
    const dot = gunMuzzle();
    expect(Math.hypot(dot.x, dot.y)).toBeCloseTo(BARREL_LENGTH, 10);
    // Rotating the rest-pose muzzle by aim around the pivot must land on
    // the live barrel tip for every aim (the sync rotation contract).
    for (const aim of [0, 0.7, Math.PI, -2.1]) {
      const rotated = {
        x: ARM_PIVOT.x + dot.x * Math.cos(aim),
        y: ARM_PIVOT.y + dot.x * Math.sin(aim),
      };
      const tip = characterMuzzle(ARM_PIVOT.x, ARM_PIVOT.y, aim);
      expect(rotated.x).toBeCloseTo(tip.x, 10);
      expect(rotated.y).toBeCloseTo(tip.y, 10);
    }
  });
});

describe("player node build and sync", () => {
  it("builds a stub node with seven named children headless", () => {
    const node = buildPlayerNode(null, 0);
    if (!("children" in node) || !("name" in node)) {
      throw new Error("expected a stub node");
    }
    expect(node.name).toBe("player0");
    expect(node.children.length).toBeGreaterThanOrEqual(5);
    const names = node.children.map((c) => c.name);
    for (const required of ["body", "head", "visor", "armL", "armR"]) {
      expect(names).toContain(required);
    }
    expect(node.children.every((c) => c.label === c.name)).toBe(true);
  });

  it("builds real Pixi containers with tinted parts and aim-only arms", () => {
    const calls: string[] = [];
    class FakePoint {
      x = 0;
      y = 0;
      set(x: number, y: number): void {
        this.x = x;
        this.y = y;
      }
    }
    class FakeGraphics implements GraphicsLike {
      label = "";
      position = new FakePoint();
      rotation = 0;
      tint: number | string = 0xffffff;
      rect(): unknown {
        calls.push(`rect:${this.label}`);
        return undefined;
      }
      circle(): unknown {
        calls.push(`circle:${this.label}`);
        return undefined;
      }
      moveTo(): unknown {
        return undefined;
      }
      lineTo(): unknown {
        return undefined;
      }
      stroke(): unknown {
        calls.push(`stroke:${this.label}`);
        return undefined;
      }
      fill(): unknown {
        calls.push(`fill:${this.label}`);
        return undefined;
      }
    }
    class FakeContainer {
      label = "";
      alpha = 1;
      visible = true;
      position = new FakePoint();
      scale = new FakePoint();
      children: FakeGraphics[] = [];
      addChild(child: FakeGraphics): FakeGraphics {
        this.children.push(child);
        return child;
      }
    }
    const fakePixi: PixiFactory = {
      Container: FakeContainer,
      Graphics: FakeGraphics,
    };
    const node = buildPlayerNode(fakePixi, 1);
    if (!("position" in node)) {
      throw new Error("expected a real container node");
    }
    expect(node.children).toHaveLength(7);
    expect(node.children.map((c) => c.label)).toEqual([...PART_NAMES]);
    syncPlayerNode(node, {
      x: 100,
      y: 50,
      scale: 2,
      aim: 0.5,
      colorHex: teamColor(1),
      alpha: 0.25,
      squash: CROUCH_SQUASH,
      visible: true,
    });
    expect(node.position.x).toBe(100);
    expect(node.position.y).toBe(50);
    expect(node.scale.x).toBe(2);
    expect(node.scale.y).toBeCloseTo(2 * CROUCH_SQUASH, 10);
    expect(node.alpha).toBe(0.25);
    for (const child of node.children) {
      if (child.label === "armL" || child.label === "armR") {
        expect(child.rotation).toBe(0.5);
        expect(child.tint).toBe(teamColor(1));
      } else if (child.label === "visor") {
        expect(child.rotation).toBe(0);
        expect(child.tint).toBe(0xffffff);
      } else {
        expect(child.rotation).toBe(0);
        expect(child.tint).toBe(teamColor(1));
      }
    }
    expect(calls.length).toBeGreaterThan(7);
  });

  it("ignores sync for stub nodes without throwing", () => {
    const stub: PlayerNode = buildPlayerNode(null, 2);
    expect(() =>
      syncPlayerNode(stub, {
        x: 0,
        y: 0,
        scale: 1,
        aim: 0,
        colorHex: teamColor(2),
        alpha: 1,
        squash: 1,
        visible: true,
      }),
    ).not.toThrow();
  });
});

describe("window.__game probe surface", () => {
  it("publishes players, colors, bounds, and coincident muzzle/weaponTip", () => {
    installWindow();
    const nodes: PlayerNode[] = [buildPlayerNode(null, 0), buildPlayerNode(null, 1)];
    // Live-camera projection at the 0.64 zoom level.
    const cam = createCamera(1280, 640);
    cam.targetZoom = 0.64;
    for (let i = 0; i < 600; i += 1) {
      updateCamera(cam, 640, 320, 1280, 640);
    }
    const tip = characterMuzzle(640, 320, 0.3);
    const muzzle = projectCamera(cam, 640, 360, tip.x, tip.y);
    const weaponTip = projectCamera(cam, 640, 360, tip.x, tip.y);
    publishGameProbes(
      nodes,
      [0, 1],
      [
        { color: teamColor(0), colorCss: teamCss(0) },
        { color: teamColor(1), colorCss: teamCss(1) },
      ],
      muzzle,
      weaponTip,
    );
    const game = readGame();
    const players = game["players"] as {
      index: number;
      node: { children: { name: string }[] };
      color: number;
      colorCss: string;
    }[];
    expect(players[0]?.node.children.length).toBeGreaterThanOrEqual(5);
    expect(game["spritePartCount"]).toBeGreaterThanOrEqual(6);
    expect(
      (game["localPlayerColor"] as string).toLowerCase(),
    ).toBe("#00e5ff");
    expect(game["firstEnemyColor"] as string).toMatch(/^#FF(6B35|B347)/);
    const bounds = game["playerBounds"] as {
      w: number;
      h: number;
      width: number;
      height: number;
    };
    expect(bounds.w).toBeGreaterThanOrEqual(20);
    expect(bounds.w).toBeLessThanOrEqual(32);
    expect(bounds.h).toBeGreaterThanOrEqual(50);
    expect(bounds.h).toBeLessThanOrEqual(66);
    expect(bounds.width).toBe(bounds.w);
    expect(bounds.height).toBe(bounds.h);
    const dist = Math.hypot(
      (game["muzzleX"] as number) - (game["weaponTipX"] as number),
      (game["muzzleY"] as number) - (game["weaponTipY"] as number),
    );
    expect(dist).toBeLessThan(4);
  });

  it("merges without replacing the object owned by main.ts", () => {
    installWindow();
    const game = readGame();
    game["tick"] = 41;
    game["state"] = "playing";
    publishGameProbes([], [], [], { x: 1, y: 2 }, { x: 1, y: 2 });
    const after = readGame();
    expect(after["tick"]).toBe(41);
    expect(after["state"]).toBe("playing");
    expect(after["spritePartCount"]).toBe(PART_NAMES.length);
  });
});
