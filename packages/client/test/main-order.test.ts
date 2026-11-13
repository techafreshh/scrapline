// Source-order regression test: `applyResponsiveSize` reads `renderer`, so
// the `let renderer` declaration must precede it textually; otherwise a
// future early call would throw a TDZ ReferenceError. Reads main.ts as
// text only (never imports it — load-time DOM side effects).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAIN_TS = join(__dirname, "..", "src", "main.ts");

function mainSource(): string {
  return readFileSync(MAIN_TS, "utf8");
}

describe("main.ts declaration order", () => {
  it("declares `let renderer` exactly once before `function applyResponsiveSize`", () => {
    const source = mainSource();
    const rendererDecls = source.match(/^let renderer: Renderer \| null = null;/gm) ?? [];
    expect(rendererDecls).toHaveLength(1);
    const helperDefs = source.match(/^function applyResponsiveSize\(\)/gm) ?? [];
    expect(helperDefs).toHaveLength(1);
    const declIndex = source.indexOf("let renderer: Renderer | null = null;");
    const helperIndex = source.indexOf("function applyResponsiveSize()");
    expect(declIndex).toBeGreaterThanOrEqual(0);
    expect(helperIndex).toBeGreaterThanOrEqual(0);
    expect(declIndex).toBeLessThan(helperIndex);
  });
});
