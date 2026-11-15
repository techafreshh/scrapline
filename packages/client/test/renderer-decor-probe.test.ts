// Source-text regression test: the `__game.decorations` probe mirror must
// publish a fresh snapshot copy, never the live per-(theme, seed)
// `decorCache` reference aliased as `allDecors` in `trackDraw`, so harness
// writes (push, length-truncate, element-field mutation) cannot poison the
// renderer cache. Reads renderer/index.ts as text only (never imports it —
// renderer pulls DOM/Pixi side effects).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RENDERER_TS = join(__dirname, "..", "src", "renderer", "index.ts");

function rendererSource(): string {
  return readFileSync(RENDERER_TS, "utf8");
}

describe("renderer decor probe", () => {
  it("publishes a snapshot copy of the decoration cache on the __game mirror", () => {
    const source = rendererSource();
    expect(
      source,
      "renderer/index.ts must publish `decorations: snapshotDecorations(allDecors)` — " +
        "a fresh array of fresh elements per frame",
    ).toContain("decorations: snapshotDecorations(allDecors)");
    const bareAlias = source.replace(
      /decorations:\s*snapshotDecorations\(allDecors\)/g,
      "",
    );
    expect(
      bareAlias,
      "renderer/index.ts must not publish the live `decorations: allDecors` cache reference",
    ).not.toMatch(/decorations:\s*allDecors\b/);
  });
});
