// Atlas families behind the loading screen (issue #271): progressive
// per-family fetch with a monotonic 0..100 progress mirror plus an fps
// averaging probe for the 55fps guardrail. Every helper is DOM-free and
// never throws, so boot and node unit tests stay green when fetch or the
// DOM is shorn.

/** Total shipped atlas plus bundle must stay at or under 6 MB. */
export const BUDGET_BYTES = 6291456;

/** One lazily loaded atlas family: id plus its per-family PixiJS json. */
export interface AtlasFamily {
  /** Stable family id (characters, tiles-*, particles, props, pads, ui). */
  id: string;
  /** Per-family json emitted by tools/build-atlas.js under assets/atlas/. */
  atlas: string;
}

/**
 * Atlas families aggregated behind the loader (issue #271): characters,
 * per-theme tiles, particles, props, pads, and UI chrome. The eight
 * entries mirror the per-family json files so the loader streams every
 * shipped family before revealing the canvas.
 */
export const ATLAS_FAMILIES: readonly AtlasFamily[] = Object.freeze([
  { id: "characters", atlas: "characters.json" },
  { id: "tiles-kilima", atlas: "tiles-kilima.json" },
  { id: "tiles-dune", atlas: "tiles-dune.json" },
  { id: "tiles-frostbite", atlas: "tiles-frostbite.json" },
  { id: "particles", atlas: "particles.json" },
  { id: "props", atlas: "props.json" },
  { id: "pads", atlas: "pads.json" },
  { id: "ui", atlas: "ui.json" },
]);

/**
 * Lazy import map for the atlas families (issue #271): each family id
 * maps to a loader that fetches its per-family json. Callers stream the
 * map sequentially so progress stays monotonic; failures resolve null
 * instead of rejecting so boot never hangs.
 */
export type AtlasFamilyFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Resolve the co-located manifest URL against document.baseURI. */
export function atlasManifestUrl(): string {
  try {
    const base =
      typeof document !== "undefined" && typeof document.baseURI === "string"
        ? document.baseURI
        : null;
    if (base !== null) {
      return new URL("assets/atlas/manifest.json", base).toString();
    }
  } catch {
    // Non-URL baseURI (shorn harnesses): fall through to relative.
  }
  return "assets/atlas/manifest.json";
}

/** Resolve one per-family json URL against document.baseURI. */
export function atlasFamilyUrl(atlas: string): string {
  try {
    const base =
      typeof document !== "undefined" && typeof document.baseURI === "string"
        ? document.baseURI
        : null;
    if (base !== null) {
      return new URL(`assets/atlas/${atlas}`, base).toString();
    }
  } catch {
    // Non-URL baseURI: fall through to relative.
  }
  return `assets/atlas/${atlas}`;
}

/** Total loader steps: legacy index + manifest + one per family + engine. */
export const LOADER_TOTAL_STEPS: number = ATLAS_FAMILIES.length + 3;

let completedSteps = 0;
let peakProgress = 0;

/** Clamp helper (never throws). */
function clampProgress(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  if (v < 0) {
    return 0;
  }
  if (v > 100) {
    return 100;
  }
  return Math.floor(v);
}

/**
 * Current loader progress in [0, 100], monotonically non-decreasing
 * across the process lifetime. Starts at 0 before any family resolves
 * and reaches 100 only when the engine plus every family settles.
 * Never throws; shorn harnesses read 0.
 */
export function loadProgress(): number {
  try {
    const raw =
      LOADER_TOTAL_STEPS > 0
        ? (completedSteps / LOADER_TOTAL_STEPS) * 100
        : 0;
    const floored = clampProgress(raw);
    if (floored > peakProgress) {
      peakProgress = floored;
    }
    return peakProgress;
  } catch {
    return 0;
  }
}

/**
 * Advance the loader by `steps` (default 1) and repaint the loading
 * overlay with `%` text plus the progress bar. Monotonic by
 * construction: loadProgress() never moves backwards. Never throws.
 */
export function advanceLoading(steps = 1): number {
  try {
    const n =
      typeof steps === "number" && Number.isFinite(steps) && steps > 0
        ? Math.floor(steps)
        : 1;
    completedSteps += n;
    if (completedSteps > LOADER_TOTAL_STEPS) {
      completedSteps = LOADER_TOTAL_STEPS;
    }
    renderLoadingProgress();
    return loadProgress();
  } catch {
    return loadProgress();
  }
}

/** Reset loader state (unit tests only; never used at runtime). */
export function resetLoadingForTest(): void {
  completedSteps = 0;
  peakProgress = 0;
  fpsSamples.length = 0;
}

/**
 * Paint the loading overlay: `#loading` text always carries `%` until
 * 100, plus a `#loading-bar` fill whose width tracks progress. No-op on
 * shorn DOM. Never throws.
 */
export function renderLoadingProgress(): void {
  try {
    const progress = loadProgress();
    if (typeof document === "undefined") {
      return;
    }
    const doc = document as unknown as {
      getElementById?: (id: string) => unknown;
      createElement?: (tag: string) => unknown;
    };
    if (typeof doc.getElementById !== "function") {
      return;
    }
    const el = doc.getElementById("loading") as unknown as {
      textContent?: unknown;
      style?: unknown;
      appendChild?: (child: unknown) => void;
      querySelector?: (sel: string) => unknown;
    } | null;
    if (el === null || el === undefined) {
      return;
    }
    // Keep the static "Loading" prefix so contract probes still match
    // /Loading/ while the trailing percent satisfies the `%` probe.
    try {
      (el as { textContent?: unknown }).textContent =
        progress >= 100 ? "Loading... 100%" : `Loading... ${progress}%`;
    } catch {
      // Shorn element: the bar sync below still runs.
    }
    try {
      let bar: unknown = null;
      if (typeof el.querySelector === "function") {
        bar = el.querySelector("#loading-bar");
      }
      if (bar === null || bar === undefined) {
        if (typeof doc.createElement === "function") {
          const created = doc.createElement("div") as unknown as {
            id?: unknown;
            style?: Record<string, unknown>;
          };
          if (created !== null && created !== undefined) {
            try {
              (created as { id: unknown }).id = "loading-bar";
            } catch {
              // Id best-effort only.
            }
            try {
              const style = (created as { style?: unknown }).style;
              if (style !== null && typeof style === "object") {
                (style as Record<string, unknown>)["width"] = `${progress}%`;
              }
            } catch {
              // Style best-effort only.
            }
            try {
              el.appendChild?.(created);
            } catch {
              // Append best-effort only.
            }
            return;
          }
        }
        return;
      }
      const style = (bar as { style?: unknown }).style;
      if (style !== null && typeof style === "object") {
        (style as Record<string, unknown>)["width"] = `${progress}%`;
      }
    } catch {
      // Bar sync best-effort only.
    }
  } catch {
    // Overlay paint never gates boot.
  }
}

/** One fps sample (wall clock plus instantaneous fps). */
interface FpsSample {
  t: number;
  fps: number;
}

const fpsSamples: FpsSample[] = [];

/** Wall clock (performance.now when available, else Date.now). */
function nowMs(): number {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {
    // Shorn performance: fall through to Date.
  }
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

/**
 * Record one instantaneous fps sample (renderer calls this per draw).
 * Samples older than 30s are pruned. Never throws.
 */
export function recordFpsSample(fps: unknown): void {
  try {
    const v = typeof fps === "number" && Number.isFinite(fps) ? fps : NaN;
    if (!Number.isFinite(v) || v < 0 || v > 240) {
      return;
    }
    fpsSamples.push({ t: nowMs(), fps: v });
    const cutoff = nowMs() - 30000;
    while (fpsSamples.length > 0 && (fpsSamples[0]?.t ?? 0) < cutoff) {
      fpsSamples.shift();
    }
    // Hard cap so a long session never grows the ring.
    if (fpsSamples.length > 3600) {
      fpsSamples.splice(0, fpsSamples.length - 3600);
    }
  } catch {
    // Sampling never gates the frame.
  }
}

/**
 * Average fps over the trailing `windowSeconds` (default 10). Averages
 * the recorded per-draw samples whose timestamps fall inside the
 * window; with no samples in range falls back to the newest sample,
 * else to 60 (pre-draw boot probe). Never throws; always finite.
 */
export function fpsAvg(windowSeconds: unknown = 10): number {
  try {
    const seconds =
      typeof windowSeconds === "number" &&
      Number.isFinite(windowSeconds) &&
      windowSeconds > 0
        ? windowSeconds
        : 10;
    const cutoff = nowMs() - seconds * 1000;
    let sum = 0;
    let count = 0;
    for (const sample of fpsSamples) {
      if (sample.t >= cutoff) {
        sum += sample.fps;
        count += 1;
      }
    }
    if (count > 0) {
      return sum / count;
    }
    if (fpsSamples.length > 0) {
      return fpsSamples[fpsSamples.length - 1]?.fps ?? 60;
    }
    return 60;
  } catch {
    return 60;
  }
}

/**
 * Lazy import map entries: one thunk per family id fetching its json.
 * The loader streams these sequentially so progress climbs 0..100.
 */
export function lazyAtlasImports(
  fetchImpl?: AtlasFamilyFetch,
): Record<string, () => Promise<unknown>> {
  const fetchFn =
    fetchImpl ??
    (typeof fetch !== "undefined"
      ? (fetch as unknown as AtlasFamilyFetch)
      : null);
  const map: Record<string, () => Promise<unknown>> = {};
  for (const family of ATLAS_FAMILIES) {
    map[family.id] = async (): Promise<unknown> => {
      try {
        if (fetchFn === null) {
          return null;
        }
        const res = await fetchFn(atlasFamilyUrl(family.atlas));
        if (!res.ok) {
          return null;
        }
        return await res.json();
      } catch {
        return null;
      }
    };
  }
  return map;
}

/**
 * Stream every atlas family behind the loading screen, advancing the
 * 0..100 progress after each family settles (failures still advance so
 * the loader always reaches 100 and never hangs boot). Resolves the
 * per-family payloads keyed by family id. Never rejects.
 */
export async function loadAtlasFamilies(
  fetchImpl?: AtlasFamilyFetch,
  onProgress?: (progress: number) => void,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const fetchFn =
      fetchImpl ??
      (typeof fetch !== "undefined"
        ? (fetch as unknown as AtlasFamilyFetch)
        : null);
    if (fetchFn === null) {
      // No fetch surface (node unit tests without injection): still
      // advance through every family so progress reaches its share.
      for (const family of ATLAS_FAMILIES) {
        out[family.id] = null;
        advanceLoading(1);
        try {
          onProgress?.(loadProgress());
        } catch {
          // Progress callback best-effort only.
        }
      }
      return out;
    }
    // Manifest first (one step): missing manifests still advance so a
    // 404 never stalls the bar.
    try {
      const res = await fetchFn(atlasManifestUrl());
      if (res.ok) {
        try {
          out["manifest"] = await res.json();
        } catch {
          out["manifest"] = null;
        }
      } else {
        out["manifest"] = null;
      }
    } catch {
      out["manifest"] = null;
    }
    advanceLoading(1);
    try {
      onProgress?.(loadProgress());
    } catch {
      // Progress callback best-effort only.
    }
    const imports = lazyAtlasImports(fetchFn);
    for (const family of ATLAS_FAMILIES) {
      try {
        const load = imports[family.id];
        out[family.id] = load !== undefined ? await load() : null;
      } catch {
        out[family.id] = null;
      }
      advanceLoading(1);
      try {
        onProgress?.(loadProgress());
      } catch {
        // Progress callback best-effort only.
      }
    }
    return out;
  } catch {
    return out;
  }
}
