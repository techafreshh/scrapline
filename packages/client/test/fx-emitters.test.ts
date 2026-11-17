// Particle-pack emitters on existing spawn events (issue #269): wall-hit
// orphan shots, surface-tinted impacts, and the cumulative emitterCounts
// probe shape. Pure helpers only (no DOM, no Pixi), so vitest drives
// them under node like renderer/index.ts.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DamageDetail, ShotDetail } from "../../core/src/events";
import { TILE_SIZE } from "../../core/src/map";
import {
  buildEmitterCounts,
  isWallEndpoint,
  shotHasNearbyDamage,
  wallHitShots,
} from "../src/renderer/index";
import {
  FX_EMITTER_TEXTURES,
  FX_MANIFEST_FRAMES,
  fxManifestFrame,
} from "../src/fx/particles-config";
import { themeFor } from "../src/view/theme";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATLAS_DIR = path.resolve(HERE, "..", "assets", "atlas");

function readManifest(): Record<string, { file: string; atlas: string; w: number; h: number }> {
  const raw = fs.readFileSync(path.join(ATLAS_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw) as Record<string, { file: string; atlas: string; w: number; h: number }>;
}

function shotAt(x: number, y: number, shooter = 0): ShotDetail {
  return { ox: 0, oy: 0, x, y, weapon: "rifle", shooterId: 0, shooter, tick: 0 };
}

function damageAt(x: number, y: number): DamageDetail {
  return { victim: -1, victimId: -1, x, y, shooter: 0, shooterId: 0 };
}

/** Rec.709-ish hue in degrees for a #rrggbb string (probe comparison). */
function hueOfCss(css: string): number {
  const h = css.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) {
    return 0;
  }
  let hue: number;
  if (mx === r) {
    hue = ((g - b) / d) % 6;
  } else if (mx === g) {
    hue = (b - r) / d + 2;
  } else {
    hue = (r - g) / d + 4;
  }
  return ((hue * 60) % 360 + 360) % 360;
}

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe("shotHasNearbyDamage", () => {
  it("matches damage within 12px and ignores distant damage", () => {
    const shot = shotAt(100, 100);
    expect(shotHasNearbyDamage(shot, [damageAt(105, 104)])).toBe(true);
    expect(shotHasNearbyDamage(shot, [damageAt(200, 200)])).toBe(false);
    expect(shotHasNearbyDamage(shot, [])).toBe(false);
  });
});

describe("isWallEndpoint", () => {
  it("counts orphan shots as wall hits without a tile query", () => {
    expect(isWallEndpoint(100, 100, null)).toBe(true);
    expect(isWallEndpoint(100, 100, undefined)).toBe(true);
  });

  it("requires a solid neighbor when a tile query exists", () => {
    const solid = { isSolidTile: () => true };
    const empty = { isSolidTile: () => false };
    expect(isWallEndpoint(100, 100, solid)).toBe(true);
    expect(isWallEndpoint(100, 100, empty)).toBe(false);
  });

  it("detects the wall tile under the endpoint", () => {
    const map = {
      isSolidTile: (tx: number, ty: number) => tx === 3 && ty === 2,
    };
    expect(isWallEndpoint(3 * TILE_SIZE + 1, 2 * TILE_SIZE + 1, map)).toBe(true);
    expect(isWallEndpoint(9 * TILE_SIZE, 9 * TILE_SIZE, map)).toBe(false);
  });
});

describe("wallHitShots", () => {
  it("returns orphan wall shots and skips damage-covered endpoints", () => {
    const wall = shotAt(100, 100);
    const flesh = shotAt(200, 200);
    const damages = [damageAt(200, 200)];
    const out = wallHitShots([wall, flesh], damages, null);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(wall);
  });

  it("skips sky misses with no solid neighbor", () => {
    const empty = { isSolidTile: () => false };
    expect(wallHitShots([shotAt(100, 100)], [], empty)).toHaveLength(0);
  });

  it("keeps five wall shots for the five-shot probe", () => {
    const solid = { isSolidTile: () => true };
    const shots = [0, 1, 2, 3, 4].map((k) => shotAt(100 + k, 100));
    expect(wallHitShots(shots, [], solid)).toHaveLength(5);
  });
});

describe("buildEmitterCounts", () => {
  it("exposes muzzle, impact, explosionFlash, explosionSmoke, and debris", () => {
    const counts = buildEmitterCounts({
      muzzle: 30,
      impact: 30,
      explosionFlash: 1,
      explosionSmoke: 6,
      debris: 12,
      trail: 9,
      death: 12,
      pickup: 8,
      impactTintHex: 0xa87b4f,
      impactCss: "#a87b4f",
    });
    expect(counts["muzzle"]).toBe(30);
    expect(counts["impact"]).toBe(30);
    expect(counts["explosionFlash"]).toBe(1);
    expect(counts["explosionSmoke"]).toBe(6);
    expect(counts["debris"]).toBe(12);
    expect(counts["trail"]).toBe(9);
  });

  it("keeps explosion smoke and debris at probe floors for one blast", () => {
    const counts = buildEmitterCounts({
      explosionFlash: 1,
      explosionSmoke: 6,
      debris: 12,
    });
    expect(Number(counts["explosionFlash"])).toBeGreaterThanOrEqual(1);
    expect(Number(counts["explosionSmoke"])).toBeGreaterThanOrEqual(3);
    expect(Number(counts["debris"])).toBeGreaterThanOrEqual(3);
  });

  it("defaults to zeros with the hot impact tint", () => {
    const counts = buildEmitterCounts({});
    expect(counts["muzzle"]).toBe(0);
    expect(counts["impact"]).toBe(0);
    expect(counts["impactCss"]).toBe("#fef08a");
  });
});

describe("impact tint follows the wall surface", () => {
  it("wall base tint matches the surface within 20 hue degrees", () => {
    for (const name of ["kilima", "dune", "frostbite"] as const) {
      const theme = themeFor(name);
      const counts = buildEmitterCounts({
        impactTintHex: theme.baseHex,
        impactCss: theme.base,
      });
      const delta = hueDelta(hueOfCss(theme.base), hueOfCss(counts["impactCss"] as string));
      expect(delta).toBeLessThanOrEqual(20);
    }
  });
});

describe("particle-pack manifest frames", () => {
  it("manifest carries the six acceptance keys with on-disk art", () => {
    const manifest = readManifest();
    for (const key of [
      "fx.muzzle.1",
      "fx.spark.1",
      "fx.smoke.2",
      "fx.flash.1",
      "fx.trail.1",
      "fx.sparkle.1",
    ]) {
      expect(manifest[key]).toBeDefined();
      expect(manifest[key].w).toBeGreaterThan(0);
      expect(manifest[key].h).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(ATLAS_DIR, manifest[key].file))).toBe(true);
    }
  });

  it("emitter families resolve through fxManifestFrame", () => {
    expect(FX_MANIFEST_FRAMES["flash"]).toContain("fx.flash.1");
    expect(FX_MANIFEST_FRAMES["trail"]).toContain("fx.trail.1");
    expect(FX_MANIFEST_FRAMES["sparkle"]).toContain("fx.sparkle.1");
    expect(fxManifestFrame("flash", 1)).toBe("fx.flash.1");
    expect(fxManifestFrame("trail", 1)).toBe("fx.trail.1");
    expect(fxManifestFrame("sparkle", 1)).toBe("fx.sparkle.1");
    expect(FX_EMITTER_TEXTURES.jet).toBe("fx.trail.1");
    expect(FX_EMITTER_TEXTURES.pickup).toBe("fx.sparkle.1");
  });
});
