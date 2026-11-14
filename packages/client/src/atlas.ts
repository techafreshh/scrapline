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
