import { configDefaults, defineConfig } from "vitest/config";

// Harness split (see package.json scripts.test): vitest owns the
// packages/* suites, while node --test owns the tests/*.test.js contract
// probes. Without an explicit include, bare `vitest run` falls back to the
// default `**/*.{test,spec}.*` glob and collects the node:test files as
// failed suites ("No test suite found"). Scope the include to packages so
// stray *.test.* files elsewhere stay out; the tests/** exclude is
// belt-and-braces on top of the vitest defaults.
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "tests/**"],
  },
});
