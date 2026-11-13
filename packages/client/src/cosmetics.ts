// Cosmetics model: persisted helmet/visor/palette picks plus a seeded
// enemy generator so bots stop looking identical. Parsing is DOM-free
// (unit-testable under node like setup.ts); the setup overlay owns the
// DOM wiring, this module only moves JSON-tolerant model data.
import type { SetupStorage } from "./setup";

/** localStorage key for the persisted cosmetics JSON object. */
export const COSMETICS_KEY = "scrapline.cosmetics.v1";

/** Helmet ids in menu order. */
export const HELMET_LIST = ["cap", "beret", "hood", "bandana"] as const;

/** Helmet id union. */
export type HelmetId = (typeof HELMET_LIST)[number];

/** Visor ids in menu order. */
export const VISOR_LIST = ["slit", "round", "shade"] as const;

/** Visor id union. */
export type VisorId = (typeof VISOR_LIST)[number];

/** Accent palettes in menu order (cyan, orange-red, lime, violet). */
export const PALETTE_LIST = [
  "#00E5FF",
  "#FF6B35",
  "#A3E635",
  "#C084FC",
] as const;

/** One persisted cosmetic pick: helmet + visor + accent palette. */
export interface Cosmetics {
  helmet: HelmetId;
  visor: VisorId;
  palette: string;
}

/** First-visit (and corrupt-storage) defaults. */
export const DEFAULT_COSMETICS: Cosmetics = {
  helmet: "cap",
  visor: "slit",
  palette: "#00E5FF",
};

/** Resolve a helmet id tolerantly; unknown values fall back to cap. */
function parseHelmet(value: unknown): HelmetId {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if ((HELMET_LIST as readonly string[]).includes(key)) {
      return key as HelmetId;
    }
  }
  return DEFAULT_COSMETICS.helmet;
}

/** Resolve a visor id tolerantly; unknown values fall back to slit. */
function parseVisor(value: unknown): VisorId {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if ((VISOR_LIST as readonly string[]).includes(key)) {
      return key as VisorId;
    }
  }
  return DEFAULT_COSMETICS.visor;
}

/** Resolve a palette hex tolerantly; unknown values fall back to cyan. */
function parsePalette(value: unknown): string {
  if (typeof value === "string") {
    const key = value.trim().toUpperCase();
    for (const entry of PALETTE_LIST) {
      if (entry.toUpperCase() === key) {
        return entry;
      }
    }
  }
  return DEFAULT_COSMETICS.palette;
}

/**
 * Tolerantly normalize an unknown value into a cosmetic pick: each
 * corrupt field falls back independently (the parseSetup idiom).
 */
export function parseCosmetics(value: unknown): Cosmetics {
  const rec =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    helmet: parseHelmet(rec["helmet"]),
    visor: parseVisor(rec["visor"]),
    palette: parsePalette(rec["palette"]),
  };
}

/** Null-safe read: storage errors (or absence) yield null. */
function safeGet(
  storage: SetupStorage | null | undefined,
  key: string,
): string | null {
  if (storage === null || storage === undefined) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Load the persisted cosmetic pick; missing, corrupt, or unreadable
 * values fall back to DEFAULT_COSMETICS per field. Invalid JSON is a
 * plain fallback (never throws), so Setup still renders.
 */
export function loadCosmetics(
  storage: SetupStorage | null | undefined,
): Cosmetics {
  const raw = safeGet(storage, COSMETICS_KEY);
  if (raw === null || raw.trim() === "") {
    return { ...DEFAULT_COSMETICS };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ...DEFAULT_COSMETICS };
  }
  return parseCosmetics(parsed);
}

/**
 * Persist the (normalized) cosmetic pick as one JSON object;
 * storage errors are swallowed.
 */
export function saveCosmetics(
  storage: SetupStorage | null | undefined,
  pick: Cosmetics,
): void {
  if (storage === null || storage === undefined) {
    return;
  }
  const parsed = parseCosmetics(pick);
  try {
    storage.setItem(COSMETICS_KEY, JSON.stringify(parsed));
  } catch {
    // Private-mode storage: the match still starts, just not persisted.
  }
}

/**
 * Deterministic PRNG (mulberry32): seeded enemy draws reproduce a
 * match from its seed, unlike Math.random().
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw one list entry from the PRNG stream. */
function drawFrom<T>(rand: () => number, list: readonly T[], fallback: T): T {
  const index = Math.floor(rand() * list.length);
  const entry = list[index];
  return entry === undefined ? fallback : entry;
}

/**
 * Seeded enemy cosmetics: one pick per bot drawn over the
 * helmet x visor x palette product space. When the first two bots
 * collide on helmet+visor, bot 1's helmet advances one step so a
 * 3-bot match always shows at least two distinct helmet+visor combos.
 */
export function enemyCosmeticsFor(seed: number, count: number): Cosmetics[] {
  const total =
    typeof count === "number" && Number.isFinite(count)
      ? Math.max(0, Math.floor(count))
      : 0;
  const rand = mulberry32(seed);
  const picks: Cosmetics[] = [];
  for (let i = 0; i < total; i += 1) {
    picks.push({
      helmet: drawFrom(rand, HELMET_LIST, DEFAULT_COSMETICS.helmet),
      visor: drawFrom(rand, VISOR_LIST, DEFAULT_COSMETICS.visor),
      palette: drawFrom(rand, PALETTE_LIST, DEFAULT_COSMETICS.palette),
    });
  }
  const first = picks[0];
  const second = picks[1];
  if (
    first !== undefined &&
    second !== undefined &&
    first.helmet === second.helmet &&
    first.visor === second.visor
  ) {
    const at = (HELMET_LIST as readonly string[]).indexOf(second.helmet);
    const next = HELMET_LIST[(at + 1) % HELMET_LIST.length];
    second.helmet = next ?? DEFAULT_COSMETICS.helmet;
  }
  return picks;
}
