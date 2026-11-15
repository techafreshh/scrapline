// Storage-free frame-loop regression test (issue #184): `frame()` runs at
// 60 Hz, so the persisted name-tag flag must be cached (refreshed only on
// toggle/match-start) instead of hitting synchronous storage every frame.
// Reads main.ts as text only (never imports it — load-time DOM side
// effects), mirroring main-order.test.ts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAIN_TS = join(__dirname, "..", "src", "main.ts");

function mainSource(): string {
  return readFileSync(MAIN_TS, "utf8");
}

/** Source slice between two anchor markers (end anchor exclusive). */
function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from === -1 ? 0 : from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("main.ts name-tag flag cache (issue #184)", () => {
  it("performs no storage read inside `function frame`", () => {
    const source = mainSource();
    const frameBody = sliceBetween(
      source,
      "function frame(now: number): void {",
      "function showEndScreen(): void {",
    );
    expect(frameBody).not.toContain("loadShowNameTags");
    expect(frameBody).not.toContain("storage.getItem");
  });

  it("feeds `updateNametags` from a cached flag", () => {
    const source = mainSource();
    expect(source).toContain("cachedShowNameTags");
    const frameBody = sliceBetween(
      source,
      "function frame(now: number): void {",
      "function showEndScreen(): void {",
    );
    expect(frameBody).toContain("show: cachedShowNameTags");
  });

  it("refreshes the cache on the `#btn-nametags` toggle path", () => {
    const source = mainSource();
    expect(source).toContain("function refreshShowNameTags()");
    expect(source).toContain('getElementById("btn-nametags")');
    const toggleWiring = sliceBetween(
      source,
      'getElementById("btn-nametags")',
      "if (volumeSlider instanceof HTMLInputElement)",
    );
    expect(toggleWiring).toContain("refreshShowNameTags()");
  });

  it("re-seeds the cache in `startMatch` as a match-start backstop", () => {
    const source = mainSource();
    const startMatchBody = sliceBetween(
      source,
      "function startMatch(",
      "const storage = browserStorage();",
    );
    expect(startMatchBody).toContain("refreshShowNameTags()");
  });
});
