// Pre-match setup model: pure config parse/clamp/load/save plus a thin
// DOM binder for the setup overlay. The sim stays untouched: parsing is
// DOM-free (unit-testable under node) and the binder mirrors the hud.ts
// pattern (null-safe byId lookup, missing elements are no-ops).

import {
  loadCosmetics,
  parseCosmetics,
  saveCosmetics,
  type Cosmetics,
} from "./cosmetics";

/** Bot-count stepper bounds: 1–7 bots plus the local player. */
export const SETUP_BOTS_MIN = 1;
export const SETUP_BOTS_MAX = 7;

/** Difficulty tiers in menu order. */
export const TIER_LIST = ["easy", "normal", "hard", "elite"] as const;

/** Difficulty tier union. */
export type SetupTier = (typeof TIER_LIST)[number];

/** Arenas in menu order. */
export const MAP_LIST = ["kilima", "dune", "frostbite"] as const;

/** Arena union. */
export type SetupMap = (typeof MAP_LIST)[number];

/** localStorage keys for the persisted setup selections. */
export const SETUP_KEYS = {
  bots: "scrapline.setup.bots",
  tier: "scrapline.setup.tier",
  map: "scrapline.setup.map",
} as const;

/** Pre-match selections: bot count, difficulty tier, arena. */
export interface SetupConfig {
  bots: number;
  tier: SetupTier;
  map: SetupMap;
}

/** First-visit (and corrupt-storage) defaults: fight 3 normal bots. */
export const DEFAULT_SETUP: SetupConfig = {
  bots: 3,
  tier: "normal",
  map: "kilima",
};

/** Minimal storage surface so tests can pass a fake (no DOM needed). */
export interface SetupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Floor to an int, falling back when missing or non-finite. */
function intOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  return fallback;
}

/** Clamp an int field into [lo, hi], falling back when missing. */
function clampInt(
  value: unknown,
  lo: number,
  hi: number,
  fallback: number,
): number {
  const n = intOr(value, fallback);
  if (n < lo) {
    return lo;
  }
  if (n > hi) {
    return hi;
  }
  return n;
}

/** Resolve a tier name tolerantly; unknown values fall back to normal. */
function parseTier(value: unknown): SetupTier {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if ((TIER_LIST as readonly string[]).includes(key)) {
      return key as SetupTier;
    }
  }
  return DEFAULT_SETUP.tier;
}

/** Resolve a map name tolerantly; unknown values fall back to kilima. */
function parseMap(value: unknown): SetupMap {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if ((MAP_LIST as readonly string[]).includes(key)) {
      return key as SetupMap;
    }
  }
  return DEFAULT_SETUP.map;
}

/**
 * Tolerantly normalize an unknown value into a setup config: bot counts
 * clamp into the stepper range, unknown tier/map strings fall back.
 */
export function parseSetup(value: unknown): SetupConfig {
  const rec =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return {
    bots: clampInt(
      rec["bots"],
      SETUP_BOTS_MIN,
      SETUP_BOTS_MAX,
      DEFAULT_SETUP.bots,
    ),
    tier: parseTier(rec["tier"]),
    map: parseMap(rec["map"]),
  };
}

/** Null-safe read: storage errors (or absence) yield null. */
function safeGet(storage: SetupStorage | null | undefined, key: string): string | null {
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
 * Load the persisted selections; missing, corrupt, or unreadable values
 * fall back to DEFAULT_SETUP per field.
 */
export function loadSetup(
  storage: SetupStorage | null | undefined,
): SetupConfig {
  const botsRaw = safeGet(storage, SETUP_KEYS.bots);
  const bots = botsRaw === null || botsRaw.trim() === "" ? undefined : Number(botsRaw);
  return parseSetup({
    bots: typeof bots === "number" && Number.isFinite(bots) ? bots : undefined,
    tier: safeGet(storage, SETUP_KEYS.tier),
    map: safeGet(storage, SETUP_KEYS.map),
  });
}

/** Persist the (normalized) selections; storage errors are swallowed. */
export function saveSetup(
  storage: SetupStorage | null | undefined,
  config: SetupConfig,
): void {
  if (storage === null || storage === undefined) {
    return;
  }
  const parsed = parseSetup(config);
  try {
    storage.setItem(SETUP_KEYS.bots, String(parsed.bots));
    storage.setItem(SETUP_KEYS.tier, parsed.tier);
    storage.setItem(SETUP_KEYS.map, parsed.map);
  } catch {
    // Private-mode storage: the match still starts, just not persisted.
  }
}

/** Canonical `bots=5&tier=hard&map=dune` query fragment for the config. */
export function setupSearchParams(config: SetupConfig): string {
  const parsed = parseSetup(config);
  return `bots=${parsed.bots}&tier=${parsed.tier}&map=${parsed.map}`;
}

/** Live binder state returned by bindSetup. */
export interface SetupBinder {
  /** Current selections (updated by the stepper and option buttons). */
  config: SetupConfig;
  /** Current cosmetic pick (updated by the helmet/visor/palette selects). */
  cosmetics: Cosmetics;
  /** Reveal the overlay, prefilling from storage (or `initial`). */
  show(initial?: SetupConfig): void;
  /** Hide the overlay. */
  hide(): void;
}

/** Minimal clickable surface; real buttons satisfy it. */
interface Clickable {
  addEventListener(type: string, listener: () => void): void;
}

/** Minimal attribute surface for aria-pressed and preview data-*. */
interface AttrTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Minimal text surface for the bots readout and preview swatch. */
interface TextTarget {
  textContent: string | null;
}

/** Minimal select surface; real HTMLSelectElements satisfy it. */
interface SelectTarget {
  value: string;
  addEventListener(type: string, listener: () => void): void;
}

/** Narrow an unknown handle to the clickable surface; else null. */
function asClickable(el: unknown): Clickable | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const candidate = el as { addEventListener?: unknown };
  if (typeof candidate.addEventListener !== "function") {
    return null;
  }
  return candidate as Clickable;
}

/** Narrow an unknown handle to the attribute surface; else null. */
function asAttr(el: unknown): AttrTarget | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const candidate = el as {
    setAttribute?: unknown;
    removeAttribute?: unknown;
  };
  if (
    typeof candidate.setAttribute !== "function" ||
    typeof candidate.removeAttribute !== "function"
  ) {
    return null;
  }
  return candidate as AttrTarget;
}

/** Narrow an unknown handle to the text surface; else null (no-op). */
function asText(el: unknown): TextTarget | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  if (!("textContent" in el)) {
    return null;
  }
  return el as TextTarget;
}

/** Narrow an unknown handle to the select surface; else null (no-op). */
function asSelect(el: unknown): SelectTarget | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const candidate = el as {
    value?: unknown;
    addEventListener?: unknown;
  };
  if (typeof candidate.value !== "string") {
    return null;
  }
  if (typeof candidate.addEventListener !== "function") {
    return null;
  }
  return candidate as SelectTarget;
}

/** Assign display on an unknown handle when it carries a style bag. */
function setDisplay(el: unknown, display: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  const style = (el as { style?: unknown }).style;
  if (typeof style !== "object" || style === null) {
    return;
  }
  (style as Record<string, unknown>)["display"] = display;
}

/** Refresh the readout and the pressed states of the option buttons. */
function render(
  doc: Document,
  config: SetupConfig,
  cosmetics: Cosmetics,
): void {
  const value = asText(doc.getElementById("bots-value"));
  if (value !== null) {
    value.textContent = String(config.bots);
  }
  for (const tier of TIER_LIST) {
    const button = asAttr(doc.querySelector(`[data-tier="${tier}"]`));
    if (button !== null) {
      const active = tier === config.tier;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      if (active) {
        button.setAttribute("data-active", "true");
      } else {
        button.removeAttribute("data-active");
      }
    }
  }
  for (const map of MAP_LIST) {
    const button = asAttr(doc.querySelector(`[data-map="${map}"]`));
    if (button !== null) {
      const active = map === config.map;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      if (active) {
        button.setAttribute("data-active", "true");
      } else {
        button.removeAttribute("data-active");
      }
    }
  }
  renderCosmetics(doc, cosmetics);
}

/**
 * Prefill the cosmetics selects and the preview swatch: select values
 * follow the pick and the preview carries data-helmet/data-visor/
 * data-palette next to Start. Missing nodes are no-ops.
 */
function renderCosmetics(doc: Document, pick: Cosmetics): void {
  const helmet = asSelect(doc.getElementById("cos-helmet"));
  if (helmet !== null) {
    helmet.value = pick.helmet;
  }
  const visor = asSelect(doc.getElementById("cos-visor"));
  if (visor !== null) {
    visor.value = pick.visor;
  }
  const palette = asSelect(doc.getElementById("cos-palette"));
  if (palette !== null) {
    palette.value = pick.palette;
  }
  const preview = asAttr(doc.getElementById("cosmetics-preview"));
  if (preview !== null) {
    preview.setAttribute("data-helmet", pick.helmet);
    preview.setAttribute("data-visor", pick.visor);
    preview.setAttribute("data-palette", pick.palette);
    const text = asText(doc.getElementById("cosmetics-preview"));
    if (text !== null) {
      text.textContent = `${pick.helmet} ${pick.visor} ${pick.palette}`;
    }
  }
}

/**
 * Wire the setup overlay: stepper, tier/map buttons, cosmetics
 * selects with a live preview, and Start. Missing elements are
 * no-ops (same tolerance as buildHud); listeners attach once.
 * Start hides the overlay and delivers a copy of the current selections.
 */
export function bindSetup(
  doc: Document,
  storage: SetupStorage | null | undefined,
  onStart: (config: SetupConfig) => void,
): SetupBinder {
  const binder: SetupBinder = {
    config: loadSetup(storage),
    cosmetics: loadCosmetics(storage),
    show(initial?: SetupConfig): void {
      binder.config = initial !== undefined ? parseSetup(initial) : loadSetup(storage);
      // Cosmetic picks always re-read from storage: corrupt JSON falls
      // back per field, so Setup still renders and Start stays live.
      binder.cosmetics = loadCosmetics(storage);
      setDisplay(doc.getElementById("setup"), "");
      render(doc, binder.config, binder.cosmetics);
    },
    hide(): void {
      setDisplay(doc.getElementById("setup"), "none");
    },
  };

  /** Persist the current cosmetic pick immediately on select change. */
  const persistCosmetics = (): void => {
    saveCosmetics(storage, binder.cosmetics);
    renderCosmetics(doc, binder.cosmetics);
  };

  const minus = asClickable(doc.getElementById("bots-minus"));
  if (minus !== null) {
    minus.addEventListener("click", () => {
      binder.config.bots = clampInt(
        binder.config.bots - 1,
        SETUP_BOTS_MIN,
        SETUP_BOTS_MAX,
        DEFAULT_SETUP.bots,
      );
      render(doc, binder.config, binder.cosmetics);
    });
  }
  const plus = asClickable(doc.getElementById("bots-plus"));
  if (plus !== null) {
    plus.addEventListener("click", () => {
      binder.config.bots = clampInt(
        binder.config.bots + 1,
        SETUP_BOTS_MIN,
        SETUP_BOTS_MAX,
        DEFAULT_SETUP.bots,
      );
      render(doc, binder.config, binder.cosmetics);
    });
  }
  for (const tier of TIER_LIST) {
    const button = asClickable(doc.querySelector(`[data-tier="${tier}"]`));
    if (button !== null) {
      button.addEventListener("click", () => {
        binder.config.tier = tier;
        render(doc, binder.config, binder.cosmetics);
      });
    }
  }
  for (const map of MAP_LIST) {
    const button = asClickable(doc.querySelector(`[data-map="${map}"]`));
    if (button !== null) {
      button.addEventListener("click", () => {
        binder.config.map = map;
        render(doc, binder.config, binder.cosmetics);
      });
    }
  }
  const helmetSelect = asSelect(doc.getElementById("cos-helmet"));
  if (helmetSelect !== null) {
    helmetSelect.addEventListener("change", () => {
      binder.cosmetics = parseCosmetics({
        ...binder.cosmetics,
        helmet: helmetSelect.value,
      });
      persistCosmetics();
    });
  }
  const visorSelect = asSelect(doc.getElementById("cos-visor"));
  if (visorSelect !== null) {
    visorSelect.addEventListener("change", () => {
      binder.cosmetics = parseCosmetics({
        ...binder.cosmetics,
        visor: visorSelect.value,
      });
      persistCosmetics();
    });
  }
  const paletteSelect = asSelect(doc.getElementById("cos-palette"));
  if (paletteSelect !== null) {
    paletteSelect.addEventListener("change", () => {
      binder.cosmetics = parseCosmetics({
        ...binder.cosmetics,
        palette: paletteSelect.value,
      });
      persistCosmetics();
    });
  }
  // Canonical Start is #btn-start; the legacy #start id keeps working.
  const start =
    asClickable(doc.getElementById("btn-start")) ??
    asClickable(doc.getElementById("start"));
  if (start !== null) {
    start.addEventListener("click", () => {
      binder.hide();
      onStart({ ...binder.config });
    });
  }

  render(doc, binder.config, binder.cosmetics);
  return binder;
}
