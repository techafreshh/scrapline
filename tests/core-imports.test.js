// Core purity regression test: packages/core/src import statements must stay
// free of render/DOM APIs (pixi, dom, webaudio, window, document) and must
// only reference relative modules (mirrors the eslint no-restricted-imports
// block for packages/core). Scoped to import, export ... from re-export, and
// require( lines only — comments may still mention those tokens descriptively.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CORE_SRC = path.join(__dirname, "..", "packages", "core", "src");
const BANNED_IMPORT_TOKEN = /pixi|^dom\b|webaudio|window|document/i;

function tsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function specifiersOf(line) {
  // import ... from "spec", side-effect import "spec", require("spec").
  const specs = [];
  for (const re of [/from\s*["']([^"']+)["']/g, /require\(\s*["']([^"']+)["']\s*\)/g]) {
    let m;
    while ((m = re.exec(line)) !== null) {
      specs.push(m[1]);
    }
  }
  return specs;
}

test("core imports reference no render/DOM APIs", () => {
  const files = tsFiles(CORE_SRC);
  assert.ok(files.length > 0, "expected core sources under packages/core/src");
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      const isImport =
        /^\s*import\b/.test(line) ||
        /^\s*export\b.*\bfrom\b/.test(line) ||
        line.includes("require(");
      if (!isImport) {
        continue;
      }
      assert.doesNotMatch(
        line,
        BANNED_IMPORT_TOKEN,
        `${path.relative(CORE_SRC, file)}: banned token on import line: ${line.trim()}`,
      );
      for (const spec of specifiersOf(line)) {
        assert.ok(
          spec.startsWith("."),
          `${path.relative(CORE_SRC, file)}: non-relative import ${spec}`,
        );
      }
    }
  }
});
