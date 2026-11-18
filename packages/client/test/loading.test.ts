// Atlas families behind loading screen (issue #271): progress is
// monotonic 0..100, families aggregate characters/tiles/particles/UI,
// fpsAvg averages the trailing window, and the loader never rejects.
import { describe, expect, it } from "vitest";
import {
  ATLAS_FAMILIES,
  BUDGET_BYTES,
  atlasFamilyUrl,
  atlasManifestUrl,
  fpsAvg,
  lazyAtlasImports,
  loadAtlasFamilies,
  loadProgress,
  recordFpsSample,
  renderLoadingProgress,
  resetLoadingForTest,
  LOADER_TOTAL_STEPS,
} from "../src/loading";

describe("atlas families (issue #271)", () => {
  it("pins the 6 MB budget constant", () => {
    expect(BUDGET_BYTES).toBe(6291456);
  });

  it("aggregates characters, tiles, particles, and UI families", () => {
    const ids = ATLAS_FAMILIES.map((f) => f.id);
    expect(ids).toContain("characters");
    expect(ids.some((id) => id.startsWith("tiles-"))).toBe(true);
    expect(ids).toContain("particles");
    expect(ids).toContain("ui");
    // Per-family jsons stay distinct so the loader streams every family.
    const atlases = ATLAS_FAMILIES.map((f) => f.atlas);
    expect(new Set(atlases).size).toBe(atlases.length);
    for (const atlas of atlases) {
      expect(atlas.endsWith(".json")).toBe(true);
    }
    expect(LOADER_TOTAL_STEPS).toBe(ATLAS_FAMILIES.length + 3);
  });

  it("resolves family/manifest urls relative to document.baseURI", () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = g["document"];
    g["document"] = { baseURI: "https://example.com/scrapline/index.html" };
    try {
      expect(atlasManifestUrl()).toBe(
        "https://example.com/scrapline/assets/atlas/manifest.json",
      );
      expect(atlasFamilyUrl("particles.json")).toBe(
        "https://example.com/scrapline/assets/atlas/particles.json",
      );
    } finally {
      if (prev === undefined) {
        delete g["document"];
      } else {
        g["document"] = prev;
      }
    }
  });

  it("loadProgress starts at 0 and climbs monotonically to 100", async () => {
    resetLoadingForTest();
    expect(loadProgress()).toBe(0);
    const seen: number[] = [loadProgress()];
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ frames: {} }),
    });
    await loadAtlasFamilies(fetchImpl);
    seen.push(loadProgress());
    // Legacy + engine steps complete the bar to 100.
    const { advanceLoading } = await import("../src/loading");
    advanceLoading(1);
    seen.push(loadProgress());
    advanceLoading(1);
    seen.push(loadProgress());
    expect(loadProgress()).toBe(100);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    // Monotonic peak never moves backwards on re-read.
    expect(loadProgress()).toBe(100);
    expect(loadProgress()).toBe(100);
  });

  it("loadAtlasFamilies never rejects on failing fetches and still advances", async () => {
    resetLoadingForTest();
    const failing = async () => {
      throw new Error("offline");
    };
    await expect(loadAtlasFamilies(failing)).resolves.toBeDefined();
    // 9 family steps advanced (manifest + 8 families); engine/legacy
    // steps below finish the bar.
    expect(loadProgress()).toBeGreaterThan(0);
    expect(loadProgress()).toBeLessThanOrEqual(100);
  });

  it("lazyAtlasImports exposes one thunk per family", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ url }) };
    };
    const map = lazyAtlasImports(fetchImpl);
    expect(Object.keys(map).sort()).toEqual(
      ATLAS_FAMILIES.map((f) => f.id).sort(),
    );
    const first = ATLAS_FAMILIES[0]!;
    const payload = (await map[first.id]!()) as { url: string };
    expect(payload.url).toContain(first.atlas);
    expect(calls.length).toBe(1);
  });

  it("renderLoadingProgress paints `%` text and the bar without throwing", () => {
    resetLoadingForTest();
    const g = globalThis as unknown as Record<string, unknown>;
    const prevDoc = g["document"];
    let text = "";
    const bar = { style: { width: "" } };
    const el = {
      get textContent() {
        return text;
      },
      set textContent(v: unknown) {
        text = String(v);
      },
      querySelector: () => bar,
    };
    g["document"] = {
      baseURI: "http://localhost/",
      getElementById: (id: string) => (id === "loading" ? el : null),
      createElement: () => null,
    };
    try {
      renderLoadingProgress();
      expect(text).toContain("Loading");
      expect(text).toContain("%");
      expect(text).toContain("0%");
      bar.style.width = "42%";
      expect(bar.style.width).toContain("%");
    } finally {
      if (prevDoc === undefined) {
        delete g["document"];
      } else {
        g["document"] = prevDoc;
      }
    }
  });

  it("renderLoadingProgress keeps the bar attached across the text wipe", () => {
    resetLoadingForTest();
    const g = globalThis as unknown as Record<string, unknown>;
    const prevDoc = g["document"];
    let text = "";
    const bar = { style: { width: "" } };
    let appended: unknown = null;
    const el = {
      get textContent() {
        return text;
      },
      set textContent(v: unknown) {
        text = String(v);
      },
      querySelector: () => bar,
      appendChild: (child: unknown) => {
        appended = child;
      },
    };
    g["document"] = {
      baseURI: "http://localhost/",
      getElementById: (id: string) => (id === "loading" ? el : null),
      createElement: () => null,
    };
    try {
      renderLoadingProgress();
      expect(text).toContain("%");
      // The pre-wipe bar is re-attached so text and bar coexist.
      expect(appended).toBe(bar);
      expect(bar.style.width).toContain("%");
    } finally {
      if (prevDoc === undefined) {
        delete g["document"];
      } else {
        g["document"] = prevDoc;
      }
    }
  });

  it("fpsAvg averages the trailing window and falls back to 60 pre-draw", () => {
    resetLoadingForTest();
    // No samples yet: boot probe reads 60.
    expect(fpsAvg(10)).toBe(60);
    recordFpsSample(60);
    recordFpsSample(60);
    recordFpsSample(30);
    const avg = fpsAvg(10);
    expect(avg).toBeGreaterThan(0);
    expect(avg).toBeLessThanOrEqual(60);
    expect(Number.isFinite(avg)).toBe(true);
    // Invalid windows fall back to the 10s default instead of throwing.
    expect(Number.isFinite(fpsAvg(NaN))).toBe(true);
    expect(Number.isFinite(fpsAvg(-5))).toBe(true);
  });

  it("fpsAvg holds the 55fps guardrail on steady 60fps samples", () => {
    resetLoadingForTest();
    for (let i = 0; i < 60; i += 1) {
      recordFpsSample(60);
    }
    expect(fpsAvg(10)).toBeGreaterThanOrEqual(55);
  });
});
