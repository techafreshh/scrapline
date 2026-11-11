// The sim is sacred: packages/core must stay free of DOM, Pixi, Node, and
// nondeterministic clocks (Math.random, Date, performance). Rules below are
// scoped to packages/core/** only so server/client may keep their globals.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/*.tsbuildinfo"] },
  js.configs.recommended,
  // Scope the TS recommended rules to TS files: unscoped, they would flag
  // legitimate CommonJS require() calls and catch bindings in *.js.
  ...tseslint.configs.recommended.map((c) =>
    c.files ? c : { ...c, files: ["**/*.ts"] },
  ),
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    // server.js/tests use `catch (err)` without reading err; keep the
    // pre-ESLint-9 default for plain JS so the clean tree lints green.
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  {
    files: ["packages/client/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
    },
  },
  {
    files: ["packages/core/**/*.{js,ts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.es2021 },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "location",
        "fetch",
        "WebSocket",
        "XMLHttpRequest",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "self",
        "top",
        "process",
        "Buffer",
        "__dirname",
        "__filename",
        "global",
        "require",
        "module",
        "exports",
        "Date",
        "performance",
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "core sim must use the seeded PRNG (mulberry32), never Math.random.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: "core sim must not use Date (nondeterministic clock).",
        },
        {
          selector: 'MemberExpression[object.name="Date"]',
          message: "core sim must not use Date.* (nondeterministic clock).",
        },
        {
          selector: 'Identifier[name="performance"]',
          message: "core sim must not use performance (nondeterministic clock).",
        },
        {
          selector: 'CallExpression[callee.name="require"]',
          message: "core sim must not use require(); use ESM import of relative modules only.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            "fs",
            "fs/promises",
            "path",
            "os",
            "child_process",
            "worker_threads",
            "net",
            "http",
            "https",
            "pixi.js",
          ],
          patterns: ["node:*", "pixi.js*", "@pixi/*"],
        },
      ],
    },
  },
];
