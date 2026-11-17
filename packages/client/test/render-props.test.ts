// Props and pickups as pack sprites with states retained (issue #267):
// pack wiring, crack/explode key states, pad keys, glow pulse, and the
// atlas manifest wiring. DOM-free.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BARREL_HP, CRATE_HP } from "../../core/src/constants";
import {
  BARREL_SPRITE_KEYS,
  CRATE_SPRITE_KEYS,
  PAD_GLOW_MAX,
  PAD_GLOW_MIN,
  PAD_GLOW_PERIOD_MS,
  PAD_SPRITE_KEYS,
  PROP_CRACK_FRACTION,
  PROP_PACK,
  bouncePadSpriteKey,
  isPropCracked,
  normalizePadKind,
  normalizePropKind,
  padGlowAlphaAt,
  padSpriteFile,
  padSpriteKey,
  propFramesFor,
  propHpFraction,
  propSpriteFile,
  propSpriteKey,
} from "../src/render/props";
import { isAtlasManifest, manifestFrame } from "../src/atlas";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATLAS_DIR = path.resolve(HERE, "..", "assets", "atlas");

function readManifest(): Record<string, { file: string; atlas: string; w: number; h: number }> {
  const raw = fs.readFileSync(path.join(ATLAS_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw) as Record<string, { file: string; atlas: string; w: number; h: number }>;
}

describe("prop pack wiring", () => {
  it("names the simplified pack in the module", () => {
    expect(PROP_PACK).toBe("simplified-platformer-pack");
    const source = readFileSync(
      join(__dirname, "..", "src", "render", "props.ts"),
      "utf8",
    );
    expect(source).toContain("simplified-platformer-pack");
    expect(source).toContain("particle-pack");
  });

  it("never references vendor art directly", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "render", "props.ts"),
      "utf8",
    );
    expect(source.includes("vendor/")).toBe(false);
  });

  it("keeps the crack fraction at 50% with intact defaults", () => {
    expect(PROP_CRACK_FRACTION).toBe(0.5);
    expect(normalizePropKind("barrel")).toBe("barrel");
    expect(normalizePropKind("BARREL")).toBe("barrel");
    expect(normalizePropKind("crate")).toBe("crate");
    expect(normalizePropKind("bogus")).toBe("crate");
    expect(normalizePropKind(null)).toBe("crate");
    expect(propHpFraction("barrel", NaN)).toBe(1);
    expect(propHpFraction("crate", undefined)).toBe(1);
  });
});

describe("prop state keys", () => {
  it("resolves intact and cracked keys per kind", () => {
    expect(propSpriteKey("crate", CRATE_HP)).toBe("prop.crate.intact");
    expect(propSpriteKey("barrel", BARREL_HP)).toBe("prop.barrel.intact");
    expect(propSpriteKey("crate", CRATE_HP / 2)).toBe("prop.crate.crack");
    expect(propSpriteKey("barrel", BARREL_HP / 2)).toBe("prop.barrel.crack");
    expect(isPropCracked("crate", CRATE_HP / 2)).toBe(true);
    expect(isPropCracked("barrel", BARREL_HP)).toBe(false);
  });

  it("damaged crate key differs from intact and contains crack", () => {
    const intact = propSpriteKey("crate", CRATE_HP);
    const damaged = propSpriteKey("crate", CRATE_HP / 2);
    expect(damaged).not.toBe(intact);
    expect(damaged).toContain("crack");
    expect(intact).toBe(CRATE_SPRITE_KEYS.intact);
    expect(damaged).toBe(CRATE_SPRITE_KEYS.crack);
  });

  it("destroyed barrel reads the explode key (squash/explode band)", () => {
    const intact = propSpriteKey("barrel", BARREL_HP);
    const cracked = propSpriteKey("barrel", BARREL_HP / 2);
    const destroyed = propSpriteKey("barrel", 0);
    expect(cracked).not.toBe(intact);
    expect(cracked).toContain("crack");
    expect(destroyed).toBe(BARREL_SPRITE_KEYS.explode);
    expect(destroyed).toMatch(/squash|explode/);
  });

  it("stays consistent with the view crack model", () => {
    expect(propHpFraction("barrel", BARREL_HP)).toBe(1);
    expect(propHpFraction("barrel", 0)).toBe(0);
    expect(propHpFraction("crate", CRATE_HP)).toBe(1);
  });
});

describe("pad keys", () => {
  it("resolves weapon/health/grenade/bounce pads with the pad prefix", () => {
    expect(padSpriteKey("weapon")).toBe("pad.weapon");
    expect(padSpriteKey("health")).toBe("pad.health");
    expect(padSpriteKey("grenades")).toBe("pad.grenades");
    expect(padSpriteKey("grenade")).toBe("pad.grenades");
    expect(padSpriteKey("bounce")).toBe("pad.bounce");
    expect(normalizePadKind("HEALTH")).toBe("health");
    expect(normalizePadKind("Grenade")).toBe("grenades");
    expect(normalizePadKind("bogus")).toBe("weapon");
    // Every pad key carries the pad prefix.
    for (const key of Object.values(PAD_SPRITE_KEYS)) {
      expect(key.startsWith("pad.")).toBe(true);
      expect(key).not.toContain("vector");
    }
    for (const key of Object.values({ ...CRATE_SPRITE_KEYS, ...BARREL_SPRITE_KEYS })) {
      expect(key.startsWith("prop.")).toBe(true);
      expect(key).not.toContain("vector");
    }
  });

  it("bounce squash animates through a distinct squash key", () => {
    expect(bouncePadSpriteKey(1)).toBe("pad.bounce");
    expect(bouncePadSpriteKey(0.6)).toBe("pad.bounce.squash");
    expect(padSpriteKey("bounce", 1)).toBe("pad.bounce");
    expect(padSpriteKey("bounce", 0.6)).toBe("pad.bounce.squash");
    expect(PAD_SPRITE_KEYS.bounceSquash).toContain("squash");
  });

  it("resolves staged files for every key", () => {
    for (const key of [
      "prop.crate.intact",
      "prop.crate.crack",
      "prop.barrel.intact",
      "prop.barrel.crack",
      "prop.barrel.explode",
      "pad.weapon",
      "pad.health",
      "pad.grenades",
      "pad.bounce",
      "pad.bounce.squash",
    ]) {
      expect(propSpriteFile(key) ?? padSpriteFile(key)).not.toBeNull();
    }
    expect(propSpriteFile("bogus")).toBeNull();
    expect(padSpriteFile("bogus")).toBeNull();
  });
});

describe("glow pulse", () => {
  it("oscillates between samples 400ms apart", () => {
    expect(PAD_GLOW_PERIOD_MS).toBe(800);
    expect(PAD_GLOW_MIN).toBeLessThan(PAD_GLOW_MAX);
    const a = padGlowAlphaAt(0);
    const b = padGlowAlphaAt(400);
    expect(Math.abs(a - b)).toBeGreaterThan(0.2);
    // Full period returns to the same phase.
    expect(padGlowAlphaAt(800)).toBeCloseTo(a, 5);
    // Midpoint hold on non-finite input.
    expect(padGlowAlphaAt(NaN)).toBeCloseTo((PAD_GLOW_MIN + PAD_GLOW_MAX) / 2, 5);
    // Stays inside the band at every quarter phase.
    for (const t of [0, 200, 400, 600]) {
      const v = padGlowAlphaAt(t);
      expect(v).toBeGreaterThanOrEqual(PAD_GLOW_MIN - 1e-9);
      expect(v).toBeLessThanOrEqual(PAD_GLOW_MAX + 1e-9);
    }
  });
});

describe("propFrames probe", () => {
  it("lists 5 entries each with prop./pad. and zero with vector", () => {
    const frames = propFramesFor(
      [
        { kind: "crate", hp: CRATE_HP },
        { kind: "barrel", hp: BARREL_HP },
      ],
      [
        { kind: "weapon", active: true },
        { kind: "health", active: true },
      ],
      1,
    );
    expect(frames).toHaveLength(5);
    for (const key of frames) {
      expect(key.startsWith("prop.") || key.startsWith("pad.")).toBe(true);
      expect(key).not.toContain("vector");
    }
  });

  it("tracks crack and explode transitions", () => {
    const intact = propFramesFor(
      [{ kind: "crate", hp: CRATE_HP }],
      [{ kind: "weapon", active: true }],
      1,
    );
    const damaged = propFramesFor(
      [{ kind: "crate", hp: CRATE_HP / 2 }],
      [{ kind: "weapon", active: true }],
      1,
    );
    expect(damaged[0]).not.toBe(intact[0]);
    expect(damaged[0]).toContain("crack");
    const exploded = propFramesFor(
      [{ kind: "barrel", hp: 0 }],
      [{ kind: "weapon", active: true }],
      1,
    );
    expect(exploded[1]).toMatch(/squash|explode/);
  });

  it("falls back to intact/idle keys with no live rows", () => {
    const frames = propFramesFor(null, null, 1);
    expect(frames).toHaveLength(5);
    expect(frames[0]).toBe("prop.crate.intact");
    expect(frames[1]).toBe("prop.barrel.intact");
    expect(frames[2]).toBe("pad.weapon");
    expect(frames[3]).toBe("pad.health");
    expect(frames[4]).toBe("pad.bounce");
  });

  it("bounce entry squashes while the cycle is active", () => {
    const idle = propFramesFor([], [], 1);
    const peak = propFramesFor([], [], 0.6);
    expect(idle[4]).toBe("pad.bounce");
    expect(peak[4]).toBe("pad.bounce.squash");
  });
});

describe("prop/pad atlas manifest wiring", () => {
  it("ships all ten prop/pad frames with on-disk art", () => {
    const manifest = readManifest();
    expect(isAtlasManifest(manifest)).toBe(true);
    for (const name of [
      "prop.crate.intact",
      "prop.crate.crack",
      "prop.barrel.intact",
      "prop.barrel.crack",
      "prop.barrel.explode",
      "pad.weapon",
      "pad.health",
      "pad.grenades",
      "pad.bounce",
      "pad.bounce.squash",
    ]) {
      const entry = manifestFrame(manifest, name);
      expect(entry, name).not.toBeNull();
      expect(fs.existsSync(path.join(ATLAS_DIR, entry?.file ?? ""))).toBe(true);
    }
  });

  it("keeps every staged prop/pad file byte-distinct", () => {
    const manifest = readManifest();
    const seen = new Map<string, string>();
    for (const name of Object.keys(manifest).filter(
      (k) => k.startsWith("prop.") || k.startsWith("pad."),
    )) {
      const entry = manifest[name] as { file: string };
      const buf = fs.readFileSync(path.join(ATLAS_DIR, entry.file));
      const hex = buf.toString("hex");
      expect(seen.has(hex), `${name} duplicates staged art`).toBe(false);
      seen.set(hex, name);
    }
  });
});
