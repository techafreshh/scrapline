// Pixi backend soldier sprite swap (issue #281): the WebGL backend paints
// the same `platformer-characters` pack art the canvas2d backend draws in
// drawCharacter2D, instead of lingering on vector paint. Headless-safe:
// the tests drive structural Pixi fakes (never pixi.js) plus source
// wiring assertions over renderer/index.ts.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCamera } from "../src/renderer/camera";
import {
  syncFramePlayers,
  syncPlayerSpriteTextures,
  type Frame,
} from "../src/renderer/index";
import type { AnimPose } from "../src/view/anim";
import { CHARACTER_H, CHARACTER_W } from "../src/view/character";
import {
  buildPlayerNode,
  publishGameProbes,
  syncPlayerNode,
  type GraphicsLike,
  type PixiFactory,
  type PlayerNode,
  type SpriteLike,
} from "../src/view/playerView";
import { PART_NAMES, teamColor } from "../src/view/character";

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
  visible = true;
  rect(): unknown {
    return undefined;
  }
  circle(): unknown {
    return undefined;
  }
  moveTo(): unknown {
    return undefined;
  }
  lineTo(): unknown {
    return undefined;
  }
  stroke(): unknown {
    return undefined;
  }
  fill(): unknown {
    return undefined;
  }
  clear(): unknown {
    return undefined;
  }
}

class FakeSprite implements SpriteLike {
  label = "soldierSprite";
  position = new FakePoint();
  tint: number | string = 0xffffff;
  visible = false;
  textureKey: string | null = null;
  width = 0;
  height = 0;
  texture: unknown = null;
}

class FakeContainer {
  label = "";
  alpha = 1;
  visible = true;
  position = new FakePoint();
  scale = new FakePoint();
  children: Array<FakeGraphics | FakeSprite> = [];
  addChild(child: FakeGraphics | FakeSprite): FakeGraphics | FakeSprite {
    // Pixi move semantics: re-adding an attached child moves it to the
    // top (arms above the card), instead of duplicating it.
    const at = this.children.indexOf(child);
    if (at >= 0) {
      this.children.splice(at, 1);
    }
    this.children.push(child);
    return child;
  }
}

function spritePixi(): PixiFactory {
  return {
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Sprite: FakeSprite,
  };
}

function graphicsOnlyPixi(): PixiFactory {
  return {
    Container: FakeContainer,
    Graphics: FakeGraphics,
  };
}

function spriteOf(node: PlayerNode): FakeSprite {
  if (!("position" in node)) {
    throw new Error("expected a real container node");
  }
  const found = node.children.find(
    (child) => child.label === "soldierSprite",
  );
  if (found === undefined || !("textureKey" in found)) {
    throw new Error("expected a soldierSprite overlay child");
  }
  return found as unknown as FakeSprite;
}

function graphicsOf(node: PlayerNode): FakeGraphics[] {
  if (!("position" in node)) {
    throw new Error("expected a real container node");
  }
  return node.children.filter(
    (child): child is FakeGraphics => child.label !== "soldierSprite",
  ) as unknown as FakeGraphics[];
}

describe("pixi soldier-card overlay", () => {
  it("adds the card only when the factory supports sprites", () => {
    const legacy = buildPlayerNode(graphicsOnlyPixi(), 0);
    if (!("position" in legacy)) {
      throw new Error("expected a real container node");
    }
    expect(legacy.children.map((c) => c.label)).toEqual([...PART_NAMES]);

    const node = buildPlayerNode(spritePixi(), 0);
    if (!("position" in node)) {
      throw new Error("expected a real container node");
    }
    expect(node.children).toHaveLength(PART_NAMES.length + 1);
    const sprite = spriteOf(node);
    expect(sprite.visible).toBe(false);
    expect(sprite.textureKey).toBeNull();

    const stub = buildPlayerNode(null, 2);
    if (!("children" in stub) || !("name" in stub)) {
      throw new Error("expected a stub node");
    }
    expect(stub.children).toHaveLength(PART_NAMES.length);
  });

  it("poses the live card and hides the vector body, keeping the arms", () => {
    const node = buildPlayerNode(spritePixi(), 0);
    syncPlayerNode(node, {
      x: 100,
      y: 50,
      scale: 2,
      aim: 0.2,
      aimSmoothed: 0.5,
      colorHex: teamColor(0),
      alpha: 1,
      squash: 1,
      visible: true,
      legSwing: 4,
      legPhase: Math.PI / 2,
      weapon: "rifle",
      frame: "run-a",
      textureKey: "soldier.run.0",
    });
    const sprite = spriteOf(node);
    expect(sprite.textureKey).toBe("soldier.run.0");
    expect(sprite.visible).toBe(true);
    expect(sprite.tint).toBe(0xffffff);
    const parts = graphicsOf(node);
    for (const part of parts) {
      if (part.label === "armL" || part.label === "armR") {
        expect(part.visible).toBe(true);
        expect(part.rotation).toBe(0.5);
      } else {
        expect(part.visible).toBe(false);
      }
    }
    // Arms repaint above the card, mirroring the canvas2d
    // gun-over-sprite order.
    const order = (node as unknown as { children: { label: string }[] })
      .children.map((c) => c.label);
    expect(order.indexOf("armL")).toBeGreaterThan(order.indexOf("soldierSprite"));
    expect(order.indexOf("armR")).toBeGreaterThan(order.indexOf("soldierSprite"));
  });

  it("restores the vector body when the key clears (victim-flash red path)", () => {
    const node = buildPlayerNode(spritePixi(), 1);
    syncPlayerNode(node, {
      x: 0,
      y: 0,
      scale: 1,
      aim: 0,
      colorHex: teamColor(1),
      alpha: 1,
      squash: 1,
      visible: true,
      textureKey: "adventurer.run.1",
    });
    expect(spriteOf(node).visible).toBe(true);
    syncPlayerNode(node, {
      x: 0,
      y: 0,
      scale: 1,
      aim: 0,
      colorHex: 0xff0000,
      alpha: 1,
      squash: 1,
      visible: true,
      textureKey: null,
    });
    const sprite = spriteOf(node);
    expect(sprite.textureKey).toBeNull();
    expect(sprite.visible).toBe(false);
    for (const part of graphicsOf(node)) {
      expect(part.visible).toBe(true);
      if (part.label !== "visor") {
        expect(part.tint).toBe(0xff0000);
      }
    }
  });

  it("leaves the legacy vector path untouched without a key", () => {
    const node = buildPlayerNode(graphicsOnlyPixi(), 1);
    syncPlayerNode(node, {
      x: 10,
      y: 20,
      scale: 2,
      aim: 0.5,
      colorHex: teamColor(1),
      alpha: 0.5,
      squash: 1,
      visible: true,
    });
    if (!("position" in node)) {
      throw new Error("expected a real container node");
    }
    expect(node.children).toHaveLength(7);
    for (const child of node.children) {
      if (child.label === "armL" || child.label === "armR") {
        expect(child.rotation).toBe(0.5);
      }
      if (child.label === "visor") {
        expect(child.tint).toBe(0xffffff);
      } else {
        expect(child.tint).toBe(teamColor(1));
      }
    }
  });
});

describe("pixi decode-miss fallback (issue #281)", () => {
  function makeAnim(over: Partial<AnimPose> = {}): AnimPose {
    return {
      legPhase: 0,
      swing: 0,
      tuck: false,
      heightScale: 1,
      hurtFlash: false,
      spawnAlpha: 1,
      deadPose: false,
      flame: false,
      gaitBlend: 1,
      airBlend: 0,
      crouchWeight: 0,
      aimSmoothed: 0,
      landSquash: 1,
      spawnEase: 1,
      deathEase: 1,
      ...over,
    };
  }

  function makeFrame(): Frame {
    return {
      tick: 7,
      players: [
        {
          index: 0,
          x: 100,
          y: 100,
          w: CHARACTER_W,
          h: CHARACTER_H,
          aim: 0,
          alive: true,
          onGround: true,
          jetting: false,
          protected: false,
          fuelRatio: 1,
          vx: 0,
          vy: 0,
          crouching: false,
          hurtAt: null,
          hp: 100,
          weapon: "pistol",
          barrel: { x: 110, y: 100 },
        },
        {
          index: 1,
          x: 200,
          y: 100,
          w: CHARACTER_W,
          h: 40,
          aim: 0,
          alive: true,
          onGround: true,
          jetting: false,
          protected: false,
          fuelRatio: 1,
          vx: 0,
          vy: 0,
          crouching: true,
          hurtAt: null,
          hp: 100,
          weapon: "pistol",
          barrel: { x: 210, y: 100 },
        },
      ],
      projectiles: [],
      pickups: [],
      props: [],
      arena: { width: 800, height: 600 },
    };
  }

  it("restores the vector body when the card never decodes", () => {
    // Node has no document, so tintedSoldierFor resolves null for every
    // key: the exact first-frame/cache-miss path where canvas2d keeps
    // vector paint. The intent-hide in syncPlayerNode must not survive
    // the miss, or the frame shows floating arms over a hidden overlay.
    expect(typeof document).toBe("undefined");
    const store: PlayerNode[] = [
      buildPlayerNode(spritePixi(), 0),
      buildPlayerNode(spritePixi(), 1),
    ];
    const frame = makeFrame();
    const anims = [makeAnim(), makeAnim({ heightScale: 40 / CHARACTER_H })];
    const cam = createCamera(frame.arena.width, frame.arena.height);
    syncFramePlayers(store, frame, cam, 800, 600, new Map<number, number>(), anims);
    // Intent posed on both nodes (keys resolved, overlay flagged).
    for (const node of store) {
      expect(spriteOf(node).textureKey).not.toBeNull();
    }
    // No Texture surface either: covers the upload-miss shape too.
    syncPlayerSpriteTextures({}, store, frame, anims);
    for (const node of store) {
      expect(spriteOf(node).visible).toBe(false);
      for (const part of graphicsOf(node)) {
        expect(part.visible).toBe(true);
      }
    }
  });
});

describe("pixi sprite probe surface", () => {
  it("publishes one live texture per player", () => {
    installWindow();
    const nodes: PlayerNode[] = [buildPlayerNode(null, 0), buildPlayerNode(null, 1)];
    publishGameProbes(
      nodes,
      [0, 1],
      [
        { color: teamColor(0), colorCss: "#00E5FF" },
        { color: teamColor(1), colorCss: "#FF6B35" },
      ],
      { x: 1, y: 2 },
      { x: 1, y: 2 },
      {
        legPhase: 0,
        isFlameVisible: false,
        playerHeightScale: 1,
        isHurtFlash: false,
      },
      [
        { frame: "run-a", weapon: "rifle", texture: "soldier.run.1" },
        { frame: "idle", weapon: "pistol", texture: "adventurer.idle" },
      ],
    );
    const players = readGame()["players"] as Record<string, unknown>[];
    expect(players[0]).toMatchObject({ texture: "soldier.run.1" });
    expect(players[1]).toMatchObject({ texture: "adventurer.idle" });
  });

  it("keeps the texture field additive (absent without extras)", () => {
    installWindow();
    const nodes: PlayerNode[] = [buildPlayerNode(null, 0)];
    publishGameProbes(
      nodes,
      [0],
      [{ color: teamColor(0), colorCss: "#00E5FF" }],
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );
    const players = readGame()["players"] as Record<string, unknown>[];
    expect("texture" in (players[0] ?? {})).toBe(false);
  });
});

describe("pixi backend sprite wiring (source)", () => {
  const rendererSrc = readFileSync(
    join(__dirname, "..", "src", "renderer", "index.ts"),
    "utf8",
  );

  function bodyOf(name: string): string {
    const start = rendererSrc.indexOf(`function ${name}(`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = rendererSrc.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    return rendererSrc.slice(start, end);
  }

  it("resolves pack textures in the node sync (liveSoldier/liveBot + tint warm)", () => {
    // textureKeyForPlayer is the single resolver both backends share:
    // the local soldier via liveSoldierTexture, bots via liveBotTexture.
    const resolver = bodyOf("textureKeyForPlayer");
    expect(resolver).toContain("liveSoldierTexture");
    expect(resolver).toContain("liveBotTexture");
    const syncBody = bodyOf("syncFramePlayers");
    expect(syncBody).toContain("textureKeyForPlayer");
    expect(syncBody).toContain("soldierImageFor");
    expect(syncBody).toContain("tintedSoldierFor");
  });

  it("warms the same art in the immediate pass and uploads cards to the stage", () => {
    const pixiBody = bodyOf("paintFramePixi");
    expect(pixiBody).toContain("textureKeyForPlayer");
    expect(pixiBody).toContain("tintedSoldierFor");
    expect(rendererSrc).toContain(
      "syncPlayerSpriteTextures(mod, playerNodes, frame, anims)",
    );
  });

  it("restores vectors on a miss and sizes the card to the authored box", () => {
    const body = bodyOf("syncPlayerSpriteTextures");
    // Miss paths restore the vector body instead of leaving floating arms.
    expect(body).toContain("setVectorBodyVisible(children, false)");
    // A confirmed upload re-hides the body under the card (idempotent
    // across repeat runs after a miss restore).
    expect(body).toContain("setVectorBodyVisible(children, true)");
    // Unsquashed authored box: the container squash applies the crouch.
    expect(body).toContain("CHARACTER_W");
    expect(body).toContain("CHARACTER_H");
    expect(body).not.toContain('sprite["width"] = p.w');
    expect(body).not.toContain('sprite["height"] = p.h');
  });

  it("carries the card key on the node overlay", () => {
    const viewSrc = readFileSync(
      join(__dirname, "..", "src", "view", "playerView.ts"),
      "utf8",
    );
    expect(viewSrc).toContain("soldierSprite");
    expect(viewSrc).toContain("textureKey");
  });
});
