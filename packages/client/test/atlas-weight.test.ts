// Atlas weight-gate tests (issue #261): the committed vendor atlas under
// packages/client/assets/atlas/ carries the acceptance frame names, covers
// every renderer frame reference, stays within the 6 MB budget, and no
// runtime source imports vendor art directly. The reference scan reuses the
// build's own helpers so the gate and the test can never drift apart.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import buildAtlas from "../../../tools/build-atlas.js";
import { isAtlasManifest, manifestFrame } from "../src/atlas";

const { pngSize, collectRendererRefs, findMissingRefs, BUDGET_BYTES } = buildAtlas as {
  pngSize: (buf: Buffer) => { w: number; h: number };
  collectRendererRefs: (dir: string) => { file: string; ref: string }[];
  findMissingRefs: (
    refs: { file: string; ref: string }[],
    manifest: unknown,
  ) => { file: string; ref: string }[];
  BUDGET_BYTES: number;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const ATLAS_DIR = path.join(ROOT, "packages", "client", "assets", "atlas");
const SRC_DIR = path.join(ROOT, "packages", "client", "src");

function readManifest(): Record<string, { file: string; atlas: string; w: number; h: number }> {
  const raw = fs.readFileSync(path.join(ATLAS_DIR, "manifest.json"), "utf8");
  return JSON.parse(raw) as Record<string, { file: string; atlas: string; w: number; h: number }>;
}

function sizeBytesRecursive(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sizeBytesRecursive(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("atlas-weight", () => {
  it("pins the gate to the 6 MB acceptance cap", () => {
    expect(BUDGET_BYTES).toBe(6291456);
  });

  it("manifest exists with the acceptance frame names and on-disk art", () => {
    const manifest = readManifest();
    expect(isAtlasManifest(manifest)).toBe(true);
    for (const name of ["soldier.run.3", "tile.kilima.solid", "fx.smoke.2"]) {
      const entry = manifestFrame(manifest, name);
      expect(entry).not.toBeNull();
      expect(Number.isFinite(entry?.w ?? NaN)).toBe(true);
      expect(Number.isFinite(entry?.h ?? NaN)).toBe(true);
      expect((entry?.w ?? 0) > 0 && (entry?.h ?? 0) > 0).toBe(true);
      expect(fs.existsSync(path.join(ATLAS_DIR, entry?.file ?? ""))).toBe(true);
    }
  });

  it("manifest boxes match the PNG IHDR headers on disk", () => {
    const manifest = readManifest();
    for (const [name, entry] of Object.entries(manifest)) {
      // Muzzle points (issue #264) are data-only {x, y} offsets with
      // no image file; the muzzle test below validates them instead.
      if (name.endsWith(".muzzle")) {
        continue;
      }
      const buf = fs.readFileSync(path.join(ATLAS_DIR, entry.file));
      expect(pngSize(buf), name).toEqual({ w: entry.w, h: entry.h });
    }
  });

  it("manifest carries all six weapon.<id>.muzzle offsets as {x, y} numerics", () => {
    const manifest = readManifest() as unknown as Record<string, unknown>;
    for (const id of ["pistol", "smg", "rifle", "shotgun", "sniper", "rocket"]) {
      const name = `weapon.${id}.muzzle`;
      const entry = manifest[name] as { x?: unknown; y?: unknown } | undefined;
      expect(entry, name).toBeDefined();
      expect(typeof entry?.x, `${name}.x`).toBe("number");
      expect(Number.isFinite(entry?.x as number), `${name}.x`).toBe(true);
      expect(typeof entry?.y, `${name}.y`).toBe("number");
      expect(Number.isFinite(entry?.y as number), `${name}.y`).toBe(true);
    }
  });

  it("every renderer frame reference resolves to a manifest key", () => {
    const manifest = readManifest();
    const refs = collectRendererRefs(SRC_DIR);
    expect(refs.length).toBeGreaterThan(0);
    expect(findMissingRefs(refs, manifest)).toEqual([]);
  });

  it("atlas weight stays within the 6 MB budget", () => {
    const bytes = sizeBytesRecursive(ATLAS_DIR);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(BUDGET_BYTES);
    console.log("atlas-weight green");
  });

  it("no runtime source imports vendor art directly", () => {
    const offenders = tsFiles(SRC_DIR).filter((file) =>
      fs.readFileSync(file, "utf8").includes("vendor/"),
    );
    expect(offenders).toEqual([]);
  });
});
