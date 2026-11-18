// Atlas loader unit tests: URL resolution stays same-origin/relative and
// the index validators accept the built shape while rejecting malformed
// input (no DOM beyond document.baseURI, no network).
import { afterEach, describe, expect, it } from "vitest";
import {
  atlasUrl,
  isAtlasFrame,
  isAtlasIndex,
  isAtlasManifest,
  isAtlasManifestEntry,
  loadAtlas,
  manifestFrame,
  manifestMuzzle,
} from "../src/atlas";
import type { AtlasManifest } from "../src/atlas";

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)["document"];
  delete (globalThis as unknown as Record<string, unknown>)["window"];
});

describe("atlasUrl", () => {
  it("resolves assets/atlas.json against document.baseURI", () => {
    (globalThis as unknown as Record<string, unknown>)["document"] = {
      baseURI: "http://localhost:3000/",
    };
    expect(atlasUrl()).toBe("http://localhost:3000/assets/atlas.json");
  });

  it("follows subpath hosts without escaping origin", () => {
    (globalThis as unknown as Record<string, unknown>)["document"] = {
      baseURI: "https://example.com/scrapline/index.html",
    };
    const url = new URL(atlasUrl());
    expect(url.origin).toBe("https://example.com");
    expect(url.pathname).toBe("/scrapline/assets/atlas.json");
  });

  it("falls back to a relative path without a document", () => {
    expect(atlasUrl()).toBe("assets/atlas.json");
  });
});

describe("index validation", () => {
  it("accepts the built atlas shape", () => {
    expect(
      isAtlasIndex({
        meta: { app: "scrapline", version: 1 },
        frames: {
          "soldier-idle": { file: "soldier-idle.svg", w: 26, h: 58 },
          "tile-kilima": { file: "tile-kilima.svg", w: 32, h: 32 },
        },
      }),
    ).toBe(true);
  });

  it("rejects a missing frames map", () => {
    expect(isAtlasIndex({ meta: { app: "scrapline", version: 1 } })).toBe(false);
    expect(isAtlasIndex(null)).toBe(false);
    expect(isAtlasIndex({ frames: null })).toBe(false);
  });

  it("rejects frames pointing at unusable entries", () => {
    expect(isAtlasFrame({ file: "a.svg", w: 26, h: 58 })).toBe(true);
    expect(isAtlasFrame({ file: "", w: 26, h: 58 })).toBe(false);
    expect(isAtlasFrame({ file: "a.svg", w: NaN, h: 58 })).toBe(false);
    expect(isAtlasFrame({ file: "a.svg" })).toBe(false);
    expect(isAtlasFrame(null)).toBe(false);
  });
});

describe("manifest validation", () => {
  it("accepts the built vendor manifest shape", () => {
    expect(
      isAtlasManifest({
        "soldier.run.3": { file: "characters/soldier_skid.png", atlas: "characters.json", w: 80, h: 110 },
        "tile.kilima.solid": {
          file: "tiles/tile-kilima-solid.png",
          atlas: "tiles-kilima.json",
          w: 18,
          h: 18,
        },
      }),
    ).toBe(true);
  });

  it("rejects a missing or empty entries map", () => {
    expect(isAtlasManifest({})).toBe(false);
    expect(isAtlasManifest(null)).toBe(false);
    expect(isAtlasManifest({ frames: {} })).toBe(false);
  });

  it("rejects entries pointing at unusable values", () => {
    expect(
      isAtlasManifestEntry({ file: "a.png", atlas: "characters.json", w: 80, h: 110 }),
    ).toBe(true);
    expect(isAtlasManifestEntry({ file: "", atlas: "characters.json", w: 80, h: 110 })).toBe(
      false,
    );
    expect(isAtlasManifestEntry({ file: "a.png", atlas: "", w: 80, h: 110 })).toBe(false);
    expect(isAtlasManifestEntry({ file: "a.png", atlas: "characters.json", w: NaN, h: 110 })).toBe(
      false,
    );
    expect(isAtlasManifestEntry({ file: "a.png", atlas: "characters.json" })).toBe(false);
    expect(isAtlasManifestEntry(null)).toBe(false);
    expect(
      isAtlasManifest({
        valid: { file: "a.png", atlas: "characters.json", w: 1, h: 1 },
        broken: { file: "b.png", atlas: "characters.json", w: 1 },
      }),
    ).toBe(false);
  });

  it("accepts a mixed frame-plus-muzzle manifest", () => {
    const mixed = {
      "soldier.run.3": {
        file: "characters/soldier_skid.png",
        atlas: "characters.json",
        w: 80,
        h: 110,
      },
      "weapon.rifle.muzzle": { x: 14, y: 0 },
    };
    const typed: AtlasManifest = mixed;
    expect(isAtlasManifest(typed)).toBe(true);
    expect(manifestFrame(typed, "soldier.run.3")).toEqual({
      file: "characters/soldier_skid.png",
      atlas: "characters.json",
      w: 80,
      h: 110,
    });
    expect(manifestFrame(typed, "weapon.rifle.muzzle")).toBeNull();
    expect(manifestMuzzle(typed, "weapon.rifle.muzzle")).toEqual({ x: 14, y: 0 });
    expect(manifestMuzzle(typed, "soldier.run.3")).toBeNull();
  });

  it("manifestFrame resolves logical names without throwing", () => {
    const manifest = {
      "soldier.run.3": { file: "characters/soldier_skid.png", atlas: "characters.json", w: 80, h: 110 },
    };
    expect(manifestFrame(manifest, "soldier.run.3")).toEqual({
      file: "characters/soldier_skid.png",
      atlas: "characters.json",
      w: 80,
      h: 110,
    });
    expect(manifestFrame(manifest, "no.such.key")).toBeNull();
    expect(manifestFrame(manifest, "")).toBeNull();
    expect(manifestFrame(null, "soldier.run.3")).toBeNull();
    expect(manifestFrame(manifest, null)).toBeNull();
  });
});

describe("loadAtlas", () => {
  it("publishes the parsed index on window.__scraplineAtlas", async () => {
    const index = {
      meta: { app: "scrapline", version: 1 },
      frames: { "tile-kilima": { file: "tile-kilima.svg", w: 32, h: 32 } },
    };
    (globalThis as unknown as Record<string, unknown>)["window"] = {};
    const seen = await loadAtlas(async () => ({
      ok: true,
      status: 200,
      json: async () => index,
    }));
    expect(seen).toEqual(index);
    expect(
      (
        (globalThis as unknown as Record<string, unknown>)["window"] as Record<
          string,
          unknown
        >
      )["__scraplineAtlas"],
    ).toEqual(index);
  });

  it("resolves null on non-ok or malformed input instead of throwing", async () => {
    await expect(
      loadAtlas(async () => ({
        ok: false,
        status: 404,
        json: async () => null,
      })),
    ).resolves.toBeNull();
    await expect(
      loadAtlas(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ frames: null }),
      })),
    ).resolves.toBeNull();
    await expect(loadAtlas(async () => {
      throw new Error("offline");
    })).resolves.toBeNull();
  });
});
