// PRD docs reference guard: no markdown may point at the deleted
// docs/benchmark/ directory, and every backticked docs/... path referenced
// in markdown must exist on disk (so stale prose cannot silently return).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function markdownFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "artifacts") {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function docsRefsIn(text) {
  const refs = [];
  for (const match of text.matchAll(/`((?:\.\/)?docs\/[^`]*)`/g)) {
    refs.push(match[1]);
  }
  return refs;
}

test("no markdown references the deleted docs/benchmark/ path", () => {
  const files = markdownFiles(ROOT);
  assert.ok(files.length > 0, "expected markdown files under the repo");
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (text.includes("docs/benchmark")) {
      hits.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(hits, [], `stale docs/benchmark reference in: ${hits.join(", ")}`);
});

test("every backticked docs/... path referenced in markdown exists on disk", () => {
  const missing = [];
  for (const file of markdownFiles(ROOT)) {
    const text = fs.readFileSync(file, "utf8");
    for (const ref of docsRefsIn(text)) {
      const cleaned = ref.replace(/\/+$/, "");
      if (!fs.existsSync(path.join(ROOT, cleaned))) {
        missing.push(`${path.relative(ROOT, file)}: \`${ref}\``);
      }
    }
  }
  assert.deepEqual(missing, [], `dangling docs/ reference: ${missing.join("; ")}`);
});
