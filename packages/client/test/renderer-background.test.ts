// Source-text regression test: the Pixi clear color is dead paint —
// `paintFramePixi` repaints the full canvas with `paintSkyPixi` every frame,
// so `createRenderer` must not pass a `background` option to `app.init`.
// Reads renderer/index.ts as text only (never imports it — renderer pulls
// DOM/Pixi side effects).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RENDERER_TS = join(__dirname, "..", "src", "renderer", "index.ts");

function rendererSource(): string {
  return readFileSync(RENDERER_TS, "utf8");
}

describe("renderer init background", () => {
  it("passes no `background` clear color to `app.init` (sky painters own the background)", () => {
    const source = rendererSource();
    expect(
      source,
      "renderer/index.ts must not pass `background:` to app.init — " +
        "paintSkyPixi/paintSky2D cover the full canvas every frame",
    ).not.toMatch(/background\s*:/);
    expect(
      source,
      "renderer/index.ts must not contain the stale #05070f clear color — " +
        "paintSkyPixi/paintSky2D own the background",
    ).not.toContain("#05070f");
  });
});
