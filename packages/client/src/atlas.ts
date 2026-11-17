// CC0 sprite-atlas loader: resolves the built atlas.json URL and fetches
// its multi-sprite index behind the loading screen. The renderer keeps
// painting composed vectors (the atlas is preloaded and indexed only),
// and a missing atlas never breaks boot: loadAtlas logs and returns null,
// leaving window.__scraplineAtlas null for the probe mirror.

/** One indexed sprite frame: the co-located file plus its box in px. */
export interface AtlasFrame {
  file: string;
  w: number;
  h: number;
}

/** Parsed atlas.json index: app tag plus per-sprite frames. */
export interface AtlasIndex {
  meta: { app: string; version: number };
  frames: Record<string, AtlasFrame>;
}

/**
 * One vendor-atlas manifest entry: the co-located PNG under
 * packages/client/assets/atlas/ plus its per-family frame map.
 */
export interface AtlasManifestEntry {
  /** Atlas-relative PNG path (e.g. characters/soldier_walk1.png). */
  file: string;
  /** Per-family PixiJS frame map holding this frame. */
  atlas: string;
  /** Frame width in px (from the PNG IHDR header). */
  w: number;
  /** Frame height in px (from the PNG IHDR header). */
  h: number;
}

/**
 * Pivot-relative muzzle offset for one weapon id (`weapon.<id>.muzzle`):
 * data-only `{x, y}` in world px at rest aim, no image file (issue #264).
 */
export interface WeaponMuzzleOffset {
  /** Muzzle distance from the arm pivot in local px. */
  x: number;
  /** Rest-pose vertical offset (0: the gun rides the aim axis). */
  y: number;
}

/** Built vendor atlas manifest: logical dot-name to frame entry. */
export type AtlasManifest = Record<string, AtlasManifestEntry>;

/** Fetch surface for loadAtlas (defaults to the global fetch). */
export type AtlasFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Atlas URL resolved against document.baseURI, so file://, served-at-/,
 * and subpath hosts all land on the co-located assets/atlas.json
 * (consistent with the base: "./" contract in vite.config.ts).
 */
export function atlasUrl(): string {
  try {
    const base =
      typeof document !== "undefined" && typeof document.baseURI === "string"
        ? document.baseURI
        : null;
    if (base !== null) {
      return new URL("assets/atlas.json", base).toString();
    }
  } catch {
    // Non-URL baseURI (shorn harnesses): fall through to relative.
  }
  return "assets/atlas.json";
}

/** True when the value parses as one AtlasFrame entry. */
export function isAtlasFrame(value: unknown): value is AtlasFrame {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const frame = value as Record<string, unknown>;
  return (
    typeof frame["file"] === "string" &&
    (frame["file"] as string).length > 0 &&
    typeof frame["w"] === "number" &&
    Number.isFinite(frame["w"] as number) &&
    typeof frame["h"] === "number" &&
    Number.isFinite(frame["h"] as number)
  );
}

/** True when the value parses as a usable atlas index (frames present). */
export function isAtlasIndex(value: unknown): value is AtlasIndex {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const frames = (value as Record<string, unknown>)["frames"];
  if (frames === null || typeof frames !== "object") {
    return false;
  }
  for (const entry of Object.values(frames as Record<string, unknown>)) {
    if (!isAtlasFrame(entry)) {
      return false;
    }
  }
  return true;
}

/** True when the value parses as one manifest entry (file/atlas/w/h). */
export function isAtlasManifestEntry(value: unknown): value is AtlasManifestEntry {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["file"] === "string" &&
    (entry["file"] as string).length > 0 &&
    typeof entry["atlas"] === "string" &&
    (entry["atlas"] as string).length > 0 &&
    typeof entry["w"] === "number" &&
    Number.isFinite(entry["w"] as number) &&
    typeof entry["h"] === "number" &&
    Number.isFinite(entry["h"] as number)
  );
}

/** True when the value parses as one muzzle offset (`{x, y}` numerics). */
export function isWeaponMuzzleOffset(value: unknown): value is WeaponMuzzleOffset {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["x"] === "number" &&
    Number.isFinite(entry["x"] as number) &&
    typeof entry["y"] === "number" &&
    Number.isFinite(entry["y"] as number)
  );
}

/** True when the value parses as a usable vendor manifest (entries present). */
export function isAtlasManifest(value: unknown): value is AtlasManifest {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec);
  if (keys.length === 0) {
    return false;
  }
  for (const key of keys) {
    if (!isAtlasManifestEntry(rec[key]) && !isWeaponMuzzleOffset(rec[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Look up one logical frame (soldier.run.3, tile.kilima.solid, fx.smoke.2)
 * in a parsed manifest. Null when absent or unusable. Never throws.
 */
export function manifestFrame(manifest: unknown, name: unknown): AtlasManifestEntry | null {
  try {
    if (manifest === null || typeof manifest !== "object") {
      return null;
    }
    if (typeof name !== "string" || name.length === 0) {
      return null;
    }
    const entry = (manifest as Record<string, unknown>)[name];
    return isAtlasManifestEntry(entry) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Look up one weapon muzzle offset (`weapon.<id>.muzzle`) in a parsed
 * manifest. Null when absent or unusable. Never throws.
 */
export function manifestMuzzle(manifest: unknown, name: unknown): WeaponMuzzleOffset | null {
  try {
    if (manifest === null || typeof manifest !== "object") {
      return null;
    }
    if (typeof name !== "string" || name.length === 0) {
      return null;
    }
    const entry = (manifest as Record<string, unknown>)[name];
    if (!isWeaponMuzzleOffset(entry)) {
      return null;
    }
    return { x: entry.x, y: entry.y };
  } catch {
    return null;
  }
}

/** Publish the parsed index (or null) on the probe mirror. */
function publishAtlas(index: AtlasIndex | null): void {
  try {
    if (typeof window !== "undefined") {
      window.__scraplineAtlas = index;
    }
  } catch {
    // Shorn harnesses without a settable window: the return value carries it.
  }
}

/**
 * Fetch and validate the built atlas index, publishing it on
 * window.__scraplineAtlas. Never throws: missing or malformed input
 * logs and resolves null so boot always proceeds to revealCanvas().
 */
export async function loadAtlas(fetchImpl?: AtlasFetch): Promise<AtlasIndex | null> {
  try {
    const fetchFn =
      fetchImpl ??
      (typeof fetch !== "undefined"
        ? (fetch as unknown as AtlasFetch)
        : null);
    if (fetchFn === null) {
      return null;
    }
    const res = await fetchFn(atlasUrl());
    if (!res.ok) {
      return null;
    }
    const parsed: unknown = await res.json();
    if (!isAtlasIndex(parsed)) {
      return null;
    }
    publishAtlas(parsed);
    return parsed;
  } catch (err) {
    try {
      console.warn("scrapline: atlas unavailable, continuing with vector paint", err);
    } catch {
      // Console-shorn harnesses: still resolve null below.
    }
    return null;
  }
}
