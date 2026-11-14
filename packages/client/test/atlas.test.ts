// Atlas loader unit tests: URL resolution stays same-origin/relative and
// the index validators accept the built shape while rejecting malformed
// input (no DOM beyond document.baseURI, no network).
import { afterEach, describe, expect, it } from "vitest";
import {
  atlasUrl,
  isAtlasFrame,
  isAtlasIndex,
  loadAtlas,
} from "../src/atlas";

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
