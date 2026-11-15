// Cohesion mirror drift-pin (#205): the plain-ESM DECLARED_LAYERS
// mirror (scripts/cohesion-check.mjs) must equal the TypeScript source
// of truth THEME_BACKDROP_LAYERS, including the tolerant
// declaredLayersFor/themeBackdropLayers contract (kilima fallback,
// fresh copies) and the `city` ban on every set.
import { describe, expect, it } from "vitest";
import { THEME_BACKDROP_LAYERS, themeBackdropLayers } from "../src/view/theme";
import {
  DECLARED_LAYERS,
  declaredLayersFor,
} from "../../../scripts/cohesion-check.mjs";

describe("cohesion mirror", () => {
  it("mirrors THEME_BACKDROP_LAYERS exactly", () => {
    expect(DECLARED_LAYERS).toEqual(THEME_BACKDROP_LAYERS);
    for (const theme of ["kilima", "dune", "frostbite"] as const) {
      expect([...DECLARED_LAYERS[theme]]).toEqual([
        ...THEME_BACKDROP_LAYERS[theme],
      ]);
    }
  });

  it("declaredLayersFor matches themeBackdropLayers, tolerantly", () => {
    for (const name of [
      "kilima",
      "dune",
      "frostbite",
      "DUNE",
      " bogus ",
      undefined,
      null,
      42,
    ]) {
      expect(declaredLayersFor(name)).toEqual(themeBackdropLayers(name));
    }
  });

  it("returns fresh copies that callers can mutate safely", () => {
    const first = declaredLayersFor("dune");
    const second = declaredLayersFor("dune");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    first.push("city");
    expect(declaredLayersFor("dune")).not.toContain("city");
  });

  it("bans city from every declared set", () => {
    for (const layers of Object.values(DECLARED_LAYERS)) {
      expect(layers).not.toContain("city");
    }
  });
});
