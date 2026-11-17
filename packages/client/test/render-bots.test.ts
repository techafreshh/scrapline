// Bot silhouette variety (issue #265): distinct `platformer-characters`
// sets per bot index, roster tinting with dark outlines, and the atlas
// manifest wiring. DOM-free.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADVENTURER_RUN_KEYS,
  BOT_PACK,
  BOT_SETS,
  BOT_SPRITE_FILES,
  FEMALE_RUN_KEYS,
  PLAYER_RUN_KEYS,
  ZOMBIE_RUN_KEYS,
  botRunKey,
  botSetForPlayer,
  botSetForSlot,
  botSpriteFile,
  botSpriteKey,
  type BotSet,
} from "../src/render/bots";
import {
  rgbToHsl,
  soldierTintHue,
  tintSoldierPixel,
} from "../src/render/soldier";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATLAS_DIR = path.resolve(HERE, "..", "assets", "atlas");

function readManifest(): Record<string, { file: string; atlas: string; w: number; h: number }> {
  const raw = fs.readFileSync(path.join(ATLAS_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw) as Record<string, { file: string; atlas: string; w: number; h: number }>;
}

describe("bot silhouette sets", () => {
  it("names the platformer-characters pack", () => {
    expect(BOT_PACK).toBe("platformer-characters");
    const botsFile = readFileSync(
      join(__dirname, "..", "src", "render", "bots.ts"),
      "utf8",
    );
    expect(botsFile).toContain("platformer-characters");
  });

  it("maps consecutive bot indices to distinct sets", () => {
    expect([...BOT_SETS]).toEqual([
      "adventurer",
      "zombie",
      "female",
      "player",
    ]);
    expect(botSetForPlayer(1)).toBe("adventurer");
    expect(botSetForPlayer(2)).toBe("zombie");
    expect(botSetForPlayer(3)).toBe("female");
    expect(botSetForPlayer(4)).toBe("player");
    // The roster order wraps without ever aliasing neighbors.
    expect(botSetForPlayer(5)).toBe("adventurer");
    expect(botSetForSlot(0)).toBe("adventurer");
    expect(botSetForSlot(-1)).toBe("player");
    expect(botSetForPlayer(0)).toBe("adventurer");
  });

  it("gives 3 bots pairwise-distinct keys each naming its set", () => {
    const keys = [1, 2, 3].map((index) =>
      botSpriteKey({ swing: 4, legPhase: index }, index),
    );
    expect(new Set(keys).size).toBe(3);
    const families: BotSet[] = ["adventurer", "zombie", "female", "player"];
    for (const key of keys) {
      expect(families.some((family) => key.includes(family))).toBe(true);
    }
    expect(keys[0]).toContain("adventurer");
    expect(keys[1]).toContain("zombie");
    expect(keys[2]).toContain("female");
  });
});

describe("bot run cycle and poses", () => {
  it("exposes a 4-frame run cycle per set through the atlas file table", () => {
    for (const runKeys of [
      ADVENTURER_RUN_KEYS,
      ZOMBIE_RUN_KEYS,
      FEMALE_RUN_KEYS,
      PLAYER_RUN_KEYS,
    ]) {
      expect(runKeys).toHaveLength(4);
      for (const key of runKeys) {
        expect(key).toContain(".run.");
        expect(botSpriteFile(key)).not.toBeNull();
      }
      const seen = new Set(
        [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((phase) =>
          botRunKey(
            runKeys[0].split(".")[0] as BotSet,
            phase,
          ),
        ),
      );
      expect(seen.size).toBe(4);
    }
  });

  it("resolves idle, jet, crouch, hurt, and death textures per set", () => {
    for (const index of [1, 2, 3, 4]) {
      expect(botSpriteKey({}, index)).toContain(".idle");
      expect(botSpriteKey({ tuck: true }, index)).toContain(".jet");
      expect(botSpriteKey({ crouching: true }, index)).toContain(".crouch");
      expect(botSpriteKey({ heightScale: 0.7 }, index)).toContain(".crouch");
      expect(botSpriteKey({ deadPose: true }, index)).toContain(".dead");
      expect(botSpriteKey({ hurtFlash: true }, index)).toContain(".fall");
      expect(botSpriteKey({ swing: 4, legPhase: 0 }, index)).toContain(
        ".run.",
      );
    }
  });

  it("keeps every bot texture key inside its own set family", () => {
    for (const index of [1, 2, 3, 4]) {
      const set = botSetForPlayer(index);
      for (const pose of [
        {},
        { tuck: true },
        { crouching: true },
        { deadPose: true },
        { hurtFlash: true },
        { swing: 4, legPhase: 1 },
      ]) {
        expect(botSpriteKey(pose, index).startsWith(`${set}.`)).toBe(true);
      }
    }
  });
});

describe("bot roster tinting", () => {
  it("targets warm hues for every bot index", () => {
    for (const index of [1, 2, 3, 4, 5, 6]) {
      const hue = soldierTintHue(index);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(50);
    }
  });

  it("shifts bot torsos warm while outlines stay dark", () => {
    // Near-black outline pixels pass through untouched.
    expect(tintSoldierPixel(20, 20, 20, 255, 16)).toEqual([
      20, 20, 20, 255,
    ]);
    for (const index of [1, 2, 3]) {
      const hue = soldierTintHue(index);
      const [r, g, b] = tintSoldierPixel(149, 117, 68, 255, hue);
      const sampled = rgbToHsl(r, g, b).h;
      expect(sampled).toBeGreaterThanOrEqual(0);
      expect(sampled).toBeLessThanOrEqual(50);
    }
  });
});

describe("bot atlas manifest", () => {
  it("stages every bot texture key with on-disk art", () => {
    const manifest = readManifest();
    const keys = Object.keys(BOT_SPRITE_FILES);
    expect(keys.length).toBe(36);
    for (const key of keys) {
      const entry = manifest[key];
      expect(entry, `${key} is in the manifest`).toBeDefined();
      expect(entry?.file).toBe(BOT_SPRITE_FILES[key]);
      expect(entry?.atlas).toBe("characters.json");
      expect(fs.existsSync(path.join(ATLAS_DIR, entry?.file ?? ""))).toBe(
        true,
      );
    }
  });
});
