// Theme audit backstop (issue #268): static contract scan of
// packages/client/src/render/palette.ts — it must export applyThemeGrade
// and branch on all three theme literals (kilima/dune/frostbite), so the
// single palette/grade pass retints tiles and props per theme. Node-only:
// no TS import, no build; read the source as text like the cohesion
// checklist. Logs `audit green` on success.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PALETTE = path.join(
  __dirname,
  "..",
  "packages",
  "client",
  "src",
  "render",
  "palette.ts",
);

test("palette.ts exports applyThemeGrade with per-theme branches", () => {
  assert.ok(fs.existsSync(PALETTE), "palette.ts must exist");
  const source = fs.readFileSync(PALETTE, "utf8");
  assert.ok(
    source.includes("applyThemeGrade"),
    "palette.ts must export applyThemeGrade",
  );
  assert.ok(
    /export\s+(function|const)\s+applyThemeGrade/.test(source),
    "applyThemeGrade must be an exported binding",
  );
  for (const theme of ["kilima", "dune", "frostbite"]) {
    assert.ok(
      source.includes(`"${theme}"`) || source.includes(`'${theme}'`),
      `palette.ts must branch on "${theme}"`,
    );
  }
  assert.ok(
    source.includes("THEME_GRADES") && source.includes("gradeLutFor"),
    "palette.ts must carry the parametric grade LUT (THEME_GRADES/gradeLutFor)",
  );
  console.log("audit green");
});
