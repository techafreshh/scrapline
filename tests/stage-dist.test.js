// Regression tests for issue #62: the staged bundle must not ship TypeScript
// compiler byproducts (declarations, tsbuildinfo) from the client tsc project.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("client tsc outDir differs from Vite outDir", () => {
  const tsconfig = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "packages", "client", "tsconfig.json"),
      "utf8",
    ),
  );
  const viteConfig = fs.readFileSync(
    path.join(__dirname, "..", "packages", "client", "vite.config.ts"),
    "utf8",
  );
  const outDir = tsconfig.compilerOptions.outDir;
  assert.notEqual(path.basename(outDir), "dist");
  assert.match(viteConfig, /outDir:\s*["']dist["']/);
});

test("stage filter drops compiler byproducts", () => {
  const { shouldStageFile } = require("../tools/stage-dist.js");
  for (const name of ["index.html", "main.js", "assets/app.js"]) {
    assert.equal(shouldStageFile(name), true, `${name} is staged`);
  }
  for (const name of ["src/main.d.ts", "main.d.ts", "tsconfig.tsbuildinfo"]) {
    assert.equal(shouldStageFile(name), false, `${name} is dropped`);
  }
});
