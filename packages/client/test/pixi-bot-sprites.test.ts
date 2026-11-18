// Pixi backend bot silhouette cards (issue #286): every bot index
// materializes its own pack card on the WebGL backend through the shared
// textureKeyForPlayer resolver, mirroring the canvas2d drawCharacter2D
// path. Headless-safe: structural Pixi fakes plus stubbed
// document/Image drive the tinted-card upload without pixels.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCamera } from "../src/renderer/camera";
import {
  syncFramePlayers,
  syncPlayerSpriteTextures,
  textureKeyForPlayer,
  type Frame,
} from "../src/renderer/index";
import type { AnimPose } from "../src/view/anim";
import { CHARACTER_H, CHARACTER_W } from "../src/view/character";
import {
  buildPlayerNode,
  type GraphicsLike,
  type PixiFactory,
  type PlayerNode,
  type SpriteLike,
} from "../src/view/playerView";

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
  clear(): unknown {
    return undefined;
  }
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

function makeBotFrame(): Frame {
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
        h: CHARACTER_H,
        aim: 0.5,
        alive: true,
        onGround: true,
        jetting: false,
        protected: false,
        fuelRatio: 1,
        vx: 120,
        vy: 0,
        crouching: false,
        hurtAt: null,
        hp: 100,
        weapon: "pistol",
        barrel: { x: 210, y: 100 },
      },
      {
        index: 2,
        x: 300,
        y: 100,
        w: CHARACTER_W,
        h: CHARACTER_H,
        aim: -0.3,
        alive: true,
        onGround: true,
        jetting: false,
        protected: false,
        fuelRatio: 1,
        vx: 120,
        vy: 0,
        crouching: false,
        hurtAt: null,
        hp: 100,
        weapon: "pistol",
        barrel: { x: 310, y: 100 },
      },
      {
        index: 3,
        x: 400,
        y: 100,
        w: CHARACTER_W,
        h: CHARACTER_H,
        aim: 0.2,
        alive: true,
        onGround: true,
        jetting: false,
        protected: false,
        fuelRatio: 1,
        vx: 120,
        vy: 0,
        crouching: false,
        hurtAt: null,
        hp: 100,
        weapon: "pistol",
        barrel: { x: 410, y: 100 },
      },
    ],
    projectiles: [],
    pickups: [],
    props: [],
    arena: { width: 800, height: 600 },
  };
}

function makeBotAnims(): AnimPose[] {
  return [
    makeAnim({ legPhase: 0, swing: 0, aimSmoothed: 0 }),
    makeAnim({ legPhase: 1, swing: 4, aimSmoothed: 0.5 }),
    makeAnim({ legPhase: 2, swing: 4, aimSmoothed: -0.3 }),
    makeAnim({ legPhase: 3, swing: 4, aimSmoothed: 0.2 }),
  ];
}

function makeCardContext(): {
  drawImage: (...args: unknown[]) => void;
  getImageData: (
    x: number,
    y: number,
    w: number,
    h: number,
  ) => { data: Uint8ClampedArray; width: number; height: number };
  putImageData: (...args: unknown[]) => void;
} {
  return {
    drawImage: (): void => undefined,
    getImageData: (x: number, y: number, w: number, h: number) => {
      void x;
      void y;
      const count = Math.max(0, Math.floor(w)) * Math.max(0, Math.floor(h));
      const data = new Uint8ClampedArray(count * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
      return { data, width: w, height: h };
    },
    putImageData: (): void => undefined,
  };
}

function installCardDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g["document"] = {
    baseURI: "http://localhost/",
    createElement: (tag: string) => {
      if (tag !== "canvas") {
        return null;
      }
      const ctx = makeCardContext();
      return {
        width: 0,
        height: 0,
        getContext: (kind: string) =>
          kind === "2d" ? ctx : null,
      };
    },
  };
  class FakeImage {
    src = "";
    decoding = "async";
    crossOrigin = "anonymous";
    complete = true;
    naturalWidth = 80;
    naturalHeight = 110;
    width = 80;
    height = 110;
    addEventListener(): void {
    }
  }
  g["Image"] = FakeImage;
}

function removeCardDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g["document"];
  delete g["Image"];
}

afterEach(() => {
  removeCardDom();
});

describe("pixi bot cards hit path (issue #286)", () => {
  it("materializes distinct bot cards and hides vectors under them", () => {
    installCardDom();
    try {
      const store: PlayerNode[] = [
        buildPlayerNode(spritePixi(), 0),
        buildPlayerNode(spritePixi(), 1),
        buildPlayerNode(spritePixi(), 2),
        buildPlayerNode(spritePixi(), 3),
      ];
      const frame = makeBotFrame();
      const anims = makeBotAnims();
      const cam = createCamera(frame.arena.width, frame.arena.height);
      syncFramePlayers(store, frame, cam, 800, 600, new Map(), anims);
      for (let i = 1; i <= 3; i += 1) {
        const p = frame.players[i];
        const anim = anims[i];
        if (p === undefined || anim === undefined) {
          throw new Error("expected a bot player and pose");
        }
        expect(textureKeyForPlayer(p, anim)).toBe(
          spriteOf(store[i] as PlayerNode).textureKey,
        );
      }
      const botKeys = [1, 2, 3].map(
        (i) => spriteOf(store[i] as PlayerNode).textureKey as string,
      );
      expect(botKeys[0]).toContain("adventurer");
      expect(botKeys[1]).toContain("zombie");
      expect(botKeys[2]).toContain("female");
      expect(new Set(botKeys).size).toBe(3);
      for (const key of botKeys) {
        expect(key.startsWith("soldier.")).toBe(false);
      }
      const pixiMod = { Texture: { from: (src: unknown) => ({ source: src }) } };
      syncPlayerSpriteTextures(pixiMod, store, frame, anims);
      for (let i = 1; i <= 3; i += 1) {
        const sprite = spriteOf(store[i] as PlayerNode);
        expect(sprite.textureKey).not.toBeNull();
        expect(sprite.visible).toBe(true);
        const texture = (sprite as unknown as Record<string, unknown>)[
          "texture"
        ];
        expect(texture).toBeDefined();
        expect(texture).not.toBeNull();
        expect(typeof texture).toBe("object");
        expect(sprite.width).toBe(CHARACTER_W);
        expect(sprite.height).toBe(CHARACTER_H);
        const anim = anims[i];
        if (anim === undefined) {
          throw new Error("expected a bot pose");
        }
        for (const part of graphicsOf(store[i] as PlayerNode)) {
          if (part.label === "armL" || part.label === "armR") {
            expect(part.visible).toBe(true);
            expect(part.rotation).toBe(anim.aimSmoothed);
          } else {
            expect(part.visible).toBe(false);
          }
        }
      }
    } finally {
      removeCardDom();
    }
  });

  it("keeps the hurt card distinct from the tint card for one bot key", () => {
    installCardDom();
    try {
      const frame = makeBotFrame();
      const anims = makeBotAnims();
      const p = frame.players[1];
      const anim = anims[1];
      if (p === undefined || anim === undefined) {
        throw new Error("expected a bot player and pose");
      }
      const tintKey = textureKeyForPlayer(p, { ...anim, hurtFlash: false });
      const hurtKey = textureKeyForPlayer(p, { ...anim, hurtFlash: true });
      expect(tintKey).toContain("adventurer");
      expect(hurtKey).toContain("adventurer");
      expect(hurtKey).toContain("fall");
      expect(hurtKey).not.toBe(tintKey);
    } finally {
      removeCardDom();
    }
  });
});

describe("pixi bot victim flash (issue #286)", () => {
  it("nulls the flashed bot card and keeps live cards elsewhere", () => {
    installCardDom();
    try {
      const store: PlayerNode[] = [
        buildPlayerNode(spritePixi(), 0),
        buildPlayerNode(spritePixi(), 1),
        buildPlayerNode(spritePixi(), 2),
        buildPlayerNode(spritePixi(), 3),
      ];
      const frame = makeBotFrame();
      const anims = makeBotAnims();
      const cam = createCamera(frame.arena.width, frame.arena.height);
      syncFramePlayers(
        store,
        frame,
        cam,
        800,
        600,
        new Map<number, number>([[2, 12]]),
        anims,
      );
      const flashed = spriteOf(store[2] as PlayerNode);
      expect(flashed.textureKey).toBeNull();
      expect(flashed.visible).toBe(false);
      for (const part of graphicsOf(store[2] as PlayerNode)) {
        expect(part.visible).toBe(true);
      }
      const pixiMod = { Texture: { from: () => ({}) } };
      syncPlayerSpriteTextures(pixiMod, store, frame, anims);
      expect(spriteOf(store[2] as PlayerNode).textureKey).toBeNull();
      expect(spriteOf(store[2] as PlayerNode).visible).toBe(false);
      for (const part of graphicsOf(store[2] as PlayerNode)) {
        expect(part.visible).toBe(true);
      }
      for (const i of [1, 3]) {
        const sprite = spriteOf(store[i] as PlayerNode);
        expect(sprite.textureKey).not.toBeNull();
        expect(sprite.visible).toBe(true);
        for (const part of graphicsOf(store[i] as PlayerNode)) {
          if (part.label === "armL" || part.label === "armR") {
            expect(part.visible).toBe(true);
          } else {
            expect(part.visible).toBe(false);
          }
        }
      }
    } finally {
      removeCardDom();
    }
  });
});

describe("pixi bot decode-miss fallback (issue #286)", () => {
  it("restores vectors when no card decodes", () => {
    removeCardDom();
    expect(typeof document).toBe("undefined");
    const store: PlayerNode[] = [
      buildPlayerNode(spritePixi(), 0),
      buildPlayerNode(spritePixi(), 1),
      buildPlayerNode(spritePixi(), 2),
      buildPlayerNode(spritePixi(), 3),
    ];
    const frame = makeBotFrame();
    const anims = [makeAnim(), makeAnim(), makeAnim(), makeAnim()];
    const cam = createCamera(frame.arena.width, frame.arena.height);
    syncFramePlayers(store, frame, cam, 800, 600, new Map(), anims);
    for (const node of store) {
      expect(spriteOf(node).textureKey).not.toBeNull();
    }
    syncPlayerSpriteTextures({}, store, frame, anims);
    for (let i = 1; i <= 3; i += 1) {
      expect(spriteOf(store[i] as PlayerNode).visible).toBe(false);
      for (const part of graphicsOf(store[i] as PlayerNode)) {
        expect(part.visible).toBe(true);
      }
    }
  });
});

describe("pixi bot card wiring (source)", () => {
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

  it("resolves pack textures in the node sync", () => {
    const resolver = bodyOf("textureKeyForPlayer");
    expect(resolver).toContain("liveSoldierTexture");
    expect(resolver).toContain("liveBotTexture");
    expect(rendererSrc).toContain("export function textureKeyForPlayer");
    const syncBody = bodyOf("syncFramePlayers");
    expect(syncBody).toContain("textureKeyForPlayer");
    expect(syncBody).toContain("soldierImageFor");
    expect(syncBody).toContain("tintedSoldierFor");
  });

  it("warms the same art in the immediate pass", () => {
    const pixiBody = bodyOf("paintFramePixi");
    expect(pixiBody).toContain("textureKeyForPlayer");
    expect(pixiBody).toContain("tintedSoldierFor");
    expect(rendererSrc).toContain(
      "syncPlayerSpriteTextures(mod, playerNodes, frame, anims)",
    );
  });

  it("restores vectors on a miss and sizes the card to the authored box", () => {
    const body = bodyOf("syncPlayerSpriteTextures");
    expect(body).toContain("setVectorBodyVisible(children, false)");
    expect(body).toContain("setVectorBodyVisible(children, true)");
    expect(body).toContain("CHARACTER_W");
    expect(body).toContain("CHARACTER_H");
    expect(body).toContain('"hurt"');
    expect(body).toContain('"tint"');
  });

  it("routes bots through the shared resolver", () => {
    expect(rendererSrc).toContain("liveBotTexture");
    expect(rendererSrc).toContain("botSprites");
    expect(rendererSrc).toContain("textureKeyForPlayer");
    const probeBody = bodyOf("publishSoldierSpriteProbes");
    expect(probeBody).toContain("liveBotTexture");
    expect(probeBody).toContain("botSprites");
  });
});
