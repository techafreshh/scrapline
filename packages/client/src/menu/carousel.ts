// Map carousel with live headless thumbnails. One card per MAP_LIST
// entry lives inside #menu; each card carries a <canvas> painted
// synchronously at boot from core ASCII rows (mapRowsFor) through a
// tiny dedicated tile painter (sky fill from skyGradeFor plus scaled
// tile rects colored by themeFor/tileKindAt). Card selection persists
// via saveSetup so the untouched Quick Play path
// (startMatch(loadSetup(storage))) loads the selected map. Arrow
// buttons, page dots, and Left/Right keys cycle the same selection
// while the menu is visible (issue #348); the menu theme follows the
// selection for the per-theme scrim veil. Pure
// helpers stay DOM-free for node tests; the binder mirrors the
// scene.ts idiom (null-safe lookups, missing parents are no-ops,
// listeners attach once).

import { TileMap } from "../../../core/src/map";
import { mapRowsFor } from "../maps";
import { skyGradeFor, themeFor } from "../view/theme";
import { tileKindAt, tilePaintFor } from "../view/tiles";
import {
  DEFAULT_SETUP,
  MAP_LIST,
  loadSetup,
  parseSetup,
  saveSetup,
  type SetupConfig,
  type SetupMap,
  type SetupStorage,
} from "../setup";
import { isMenuVisible } from "./scene";

/** Carousel container element id (child of #menu). */
export const CAROUSEL_ID = "map-carousel";
/** Thumbnail backing-store width in px (2:1 arena aspect, >= 120). */
export const THUMB_W = 192;
/** Thumbnail backing-store height in px. */
export const THUMB_H = 96;
/** One card per shipped arena, in setup menu order. */
export const CAROUSEL_MAPS: readonly SetupMap[] = MAP_LIST;
/** Card selector attribute (never `data-map`: setup.ts keeps owning that). */
export const CARD_ATTR = "data-map-card";
/** Previous-arena button id (flanks #map-carousel). */
export const CAROUSEL_PREV_ID = "carousel-prev";
/** Next-arena button id (flanks #map-carousel). */
export const CAROUSEL_NEXT_ID = "carousel-next";
/** Page-dots container id (beneath #map-carousel). */
export const CAROUSEL_DOTS_ID = "carousel-dots";
/** Page-dot selector attribute (one per arena, mirrors CARD_ATTR). */
export const DOT_ATTR = "data-carousel-dot";

/** Minimal 2D-context surface the thumbnail painter needs. */
export interface ThumbnailContext {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** Narrow an unknown handle to the thumbnail-context surface. */
function asThumbnailContext(value: unknown): ThumbnailContext | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as {
    fillStyle?: unknown;
    fillRect?: unknown;
  };
  if (typeof candidate.fillRect !== "function") {
    return null;
  }
  return candidate as ThumbnailContext;
}

/**
 * Resolve a map name tolerantly; unknown values fall back to kilima
 * (the menu default), mirroring setup.ts parseMap.
 */
export function parseCarouselMap(value: unknown): SetupMap {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if ((MAP_LIST as readonly string[]).includes(key)) {
      return key as SetupMap;
    }
  }
  return DEFAULT_SETUP.map;
}

/** localStorage keys for the per-map best (max local kills). */
export const BEST_KEYS = {
  /** Canonical sparse JSON object (`{ kilima, dune, frostbite }`). */
  canonical: "scrapline.best.v1",
  /** Legacy JSON object tolerated on read (never written). */
  legacy: "scrapline.best",
  /** Per-map numeric-string fallback tolerated on read. */
  perMap: (map: SetupMap): string => `scrapline.best.${map}`,
} as const;

/**
 * Normalize an unknown best-score value: finite numbers (and numeric
 * strings) floor to a non-negative int; anything else reads null so
 * corrupt storage falls back to an absent best line. Never throws.
 */
export function parseBestScore(value: unknown): number | null {
  try {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return null;
      }
      const floored = Math.floor(value);
      return floored >= 0 ? floored : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") {
        return null;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      const floored = Math.floor(parsed);
      return floored >= 0 ? floored : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Null-safe storage read for the best-score keys. */
function bestStorageGet(
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

/** Tolerantly merge one JSON best object, keeping valid per-map ints. */
function readBestJson(
  raw: string | null,
  into: Record<SetupMap, number | null>,
): void {
  if (raw === null || raw.trim() === "") {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }
    const record = parsed as Record<string, unknown>;
    for (const map of MAP_LIST) {
      const candidate = parseBestScore(record[map]);
      if (candidate !== null) {
        into[map] = candidate;
      }
    }
  } catch {
    // Corrupt JSON: previously merged sources stand.
  }
}

/**
 * Load every map's best (max local kills): canonical JSON first, then
 * the legacy JSON object, then per-map numeric strings (later valid
 * sources win). Missing or corrupt values read null. Never throws.
 */
export function loadBestScores(
  storage: SetupStorage | null | undefined,
): Record<SetupMap, number | null> {
  const bests: Record<SetupMap, number | null> = {
    kilima: null,
    dune: null,
    frostbite: null,
  };
  try {
    readBestJson(bestStorageGet(storage, BEST_KEYS.canonical), bests);
    readBestJson(bestStorageGet(storage, BEST_KEYS.legacy), bests);
    for (const map of MAP_LIST) {
      const raw = bestStorageGet(storage, BEST_KEYS.perMap(map));
      if (raw === null) {
        continue;
      }
      const candidate = parseBestScore(raw);
      if (candidate !== null) {
        bests[map] = candidate;
      }
    }
  } catch {
    // Storage unreadable: absent bests stand.
  }
  return bests;
}

/**
 * Load one map's best; unknown maps read null (never the kilima
 * fallback: an unreadable map must not borrow another arena's best).
 */
export function loadBestScore(
  storage: SetupStorage | null | undefined,
  map: unknown,
): number | null {
  try {
    if (typeof map !== "string") {
      return null;
    }
    const key = map.trim().toLowerCase();
    if (!(MAP_LIST as readonly string[]).includes(key)) {
      return null;
    }
    return loadBestScores(storage)[key as SetupMap] ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a local-kill best, keeping the max across calls and persisting
 * the sparse canonical JSON. Corrupt scores and unknown maps are
 * no-ops returning the current best (or null). Never throws.
 */
export function recordBestScore(
  storage: SetupStorage | null | undefined,
  map: unknown,
  score: unknown,
): number | null {
  try {
    if (typeof map !== "string") {
      return null;
    }
    const key = map.trim().toLowerCase();
    if (!(MAP_LIST as readonly string[]).includes(key)) {
      return null;
    }
    const normalized = key as SetupMap;
    const next = parseBestScore(score);
    const current = loadBestScore(storage, normalized);
    if (next === null) {
      return current;
    }
    const best = current === null ? next : Math.max(current, next);
    if (storage === null || storage === undefined) {
      return best;
    }
    try {
      const merged = loadBestScores(storage);
      merged[normalized] = best;
      const sparse: Record<string, number> = {};
      for (const name of MAP_LIST) {
        const value = merged[name];
        if (value !== null) {
          sparse[name] = value;
        }
      }
      try {
        storage.setItem(BEST_KEYS.canonical, JSON.stringify(sparse));
      } catch {
        // Private-mode storage: the returned best still stands.
      }
    } catch {
      // Merge/write best-effort only.
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Exact card best line: `Best: N` for a valid score, empty when absent
 * (the card keeps a reserved empty line so heights stay equal).
 */
export function formatBestLine(score: unknown): string {
  const parsed = parseBestScore(score);
  return parsed === null ? "" : `Best: ${parsed}`;
}

/**
 * Live carousel config: the pressed card wins, otherwise the stored
 * setup. Tolerantly normalized, never throws.
 */
export function carouselConfigFor(
  doc: Document,
  storage: SetupStorage | null | undefined,
): SetupConfig {
  const stored = loadSetup(storage);
  try {
    const query = (doc as unknown as { querySelector?: unknown }).querySelector;
    if (typeof query === "function") {
      const q = query as (sel: string) => unknown;
      for (const map of CAROUSEL_MAPS) {
        const node = q.call(doc, `[${CARD_ATTR}="${map}"]`) as {
          getAttribute(name: string): string | null;
        } | null;
        if (node !== null && typeof node === "object") {
          try {
            if (node.getAttribute("aria-pressed") === "true") {
              return parseSetup({ ...stored, map });
            }
          } catch {
              // Unreadable card: keep scanning.
          }
        }
      }
    }
  } catch {
    // Shorn querySelector: storage stands.
  }
  return stored;
}

/**
 * Paint a headless map thumbnail: sky fill from the theme sky grade,
 * then one scaled rect per non-empty tile (solids in the theme base,
 * one-way planks and bounce pads in the tilePaintFor hazard-base fill,
 * backwalls in the dimmed quad). Unknown maps fall back to kilima; non-finite
 * dims are no-ops. Deterministic: no RNG, clock, DOM, or Pixi.
 */
export function paintMapThumbnail(
  ctx: unknown,
  mapName: unknown,
  w: number,
  h: number,
): void {
  try {
    const target = asThumbnailContext(ctx);
    if (target === null) {
      return;
    }
    if (
      typeof w !== "number" ||
      typeof h !== "number" ||
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      w <= 0 ||
      h <= 0
    ) {
      return;
    }
    const key = parseCarouselMap(mapName);
    const rows = mapRowsFor(key) ?? mapRowsFor(DEFAULT_SETUP.map);
    if (rows === null) {
      return;
    }
    const map = new TileMap(rows);
    if (map.widthTiles <= 0 || map.heightTiles <= 0) {
      return;
    }
    const theme = themeFor(key);
    const sky = skyGradeFor(key);
    const sx = w / map.widthPixels;
    const sy = h / map.heightPixels;
    target.fillStyle = sky.top;
    target.fillRect(0, 0, w, h);
    for (let ty = 0; ty < map.heightTiles; ty += 1) {
      for (let tx = 0; tx < map.widthTiles; tx += 1) {
        const kind = tileKindAt(map, tx, ty);
        if (kind === "empty") {
          continue;
        }
        if (kind === "solid") {
          target.fillStyle = theme.base;
          target.fillRect(
            tx * 32 * sx,
            ty * 32 * sy,
            32 * sx,
            32 * sy,
          );
        } else if (kind === "backwall") {
          target.fillStyle = theme.backwall;
          target.fillRect(
            tx * 32 * sx,
            ty * 32 * sy,
            32 * sx,
            32 * sy,
          );
        } else if (kind === "oneway") {
          target.fillStyle = tilePaintFor("oneway", theme).baseCss;
          target.fillRect(
            tx * 32 * sx,
            (ty * 32 + 24) * sy,
            32 * sx,
            8 * sy,
          );
        } else {
          target.fillStyle = tilePaintFor("bounce", theme).baseCss;
          target.fillRect(
            tx * 32 * sx,
            (ty * 32 + 24) * sy,
            32 * sx,
            8 * sy,
          );
        }
      }
    }
  } catch {
    // Headless/shorn context: the card stays sky-filled, boot continues.
  }
}

/** Narrow an unknown handle to a settable-attribute surface. */
function asAttr(el: unknown): {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
} | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const candidate = el as {
    getAttribute?: unknown;
    setAttribute?: unknown;
    removeAttribute?: unknown;
  };
  if (
    typeof candidate.getAttribute !== "function" ||
    typeof candidate.setAttribute !== "function" ||
    typeof candidate.removeAttribute !== "function"
  ) {
    return null;
  }
  return candidate as {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  };
}

/** Collect every carousel card in DOM order (possibly empty). */
function carouselCards(doc: Document): unknown[] {
  try {
    const all = (doc as unknown as { querySelectorAll?: unknown })
      .querySelectorAll;
    if (typeof all === "function") {
      const nodes = (all as (sel: string) => unknown).call(
        doc,
        `[${CARD_ATTR}]`,
      ) as { length?: unknown; item?: unknown } | ArrayLike<unknown> | null;
      if (nodes !== null && typeof nodes === "object") {
        if (Array.isArray(nodes)) {
          return nodes.slice();
        }
        if (typeof nodes.length === "number") {
          const out: unknown[] = [];
          for (let i = 0; i < nodes.length; i += 1) {
            out.push((nodes as ArrayLike<unknown>)[i]);
          }
          return out;
        }
      }
    }
  } catch {
    // querySelectorAll shorn: fall through to per-map lookup.
  }
  const out: unknown[] = [];
  try {
    const query = (doc as unknown as { querySelector?: unknown }).querySelector;
    if (typeof query !== "function") {
      return out;
    }
    const q = query as (sel: string) => unknown;
    for (const map of CAROUSEL_MAPS) {
      const node = q.call(doc, `[${CARD_ATTR}="${map}"]`);
      if (node !== null && typeof node === "object") {
        out.push(node);
      }
    }
  } catch {
    // Shorn document: no cards.
  }
  return out;
}

/** Read the card's map name from its data attribute (null when unreadable). */
function cardMap(card: unknown): SetupMap | null {
  try {
    const attr = asAttr(card);
    if (attr === null) {
      return null;
    }
    const raw = attr.getAttribute(CARD_ATTR);
    if (typeof raw !== "string") {
      return null;
    }
    const key = raw.trim().toLowerCase();
    if ((MAP_LIST as readonly string[]).includes(key)) {
      return key as SetupMap;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sync the `selected` class tolerant of fake-doc surfaces: real buttons
 * take the classList path while shorn docs fall back to the `class`
 * attribute (backfilling `map-card` so heights stay stable). Never throws.
 */
function syncCardSelected(card: unknown, active: boolean): void {
  try {
    const list = (card as { classList?: unknown }).classList as
      | { add?: unknown; remove?: unknown }
      | undefined;
    if (
      list !== undefined &&
      list !== null &&
      typeof list.add === "function" &&
      typeof list.remove === "function"
    ) {
      try {
        if (active) {
          (list.add as (name: string) => void).call(list, "selected");
        } else {
          (list.remove as (name: string) => void).call(list, "selected");
        }
      } catch {
        // classList best-effort: the attribute fallback below lands.
      }
    }
  } catch {
    // Shorn classList: the attribute fallback below lands.
  }
  try {
    const attr = asAttr(card);
    if (attr === null) {
      return;
    }
    let current: string | null = null;
    try {
      current = attr.getAttribute("class");
    } catch {
      current = null;
    }
    const parts =
      typeof current === "string" && current.length > 0
        ? current.split(/\s+/).filter((part) => part.length > 0)
        : [];
    if (!parts.includes("map-card")) {
      parts.unshift("map-card");
    }
    const has = parts.includes("selected");
    if (active && !has) {
      parts.push("selected");
    } else if (!active && has) {
      const kept = parts.filter((part) => part !== "selected");
      parts.length = 0;
      for (const part of kept) {
        parts.push(part);
      }
    }
    const text = parts.join(" ");
    try {
      if (text !== (current ?? "")) {
        attr.setAttribute("class", text);
      } else if (typeof current !== "string") {
        attr.setAttribute("class", text);
      }
    } catch {
      // Class sync best-effort only.
    }
  } catch {
    // Class-attribute sync best-effort only.
  }
}

/** Find the card's `.map-best` line (null when absent). */
function findBestSpan(card: unknown): unknown | null {
  if (typeof card !== "object" || card === null) {
    return null;
  }
  try {
    const query = (card as { querySelector?: unknown }).querySelector;
    if (typeof query === "function") {
      try {
        const found = (query as (sel: string) => unknown).call(
          card,
          ".map-best",
        );
        if (found !== null && typeof found === "object") {
          return found;
        }
      } catch {
        // Selector shorn: scan children below.
      }
    }
  } catch {
    // querySelector shorn: scan children below.
  }
  try {
    const kids = (card as { children?: unknown }).children;
    if (kids !== null && typeof kids === "object") {
      const list = kids as ArrayLike<unknown>;
      if (typeof list.length === "number") {
        for (let i = 0; i < list.length; i += 1) {
          const kid = list[i];
          if (typeof kid !== "object" || kid === null) {
            continue;
          }
          try {
            const get = (kid as { getAttribute?: unknown }).getAttribute;
            if (typeof get === "function") {
              const cls = (get as (name: string) => unknown).call(
                kid,
                "class",
              );
              if (
                typeof cls === "string" &&
                cls.split(/\s+/).includes("map-best")
              ) {
                return kid;
              }
            }
          } catch {
            // Unreadable child: keep scanning.
          }
          try {
            const name = (kid as { className?: unknown }).className;
            if (
              typeof name === "string" &&
              name.split(/\s+/).includes("map-best")
            ) {
              return kid;
            }
          } catch {
            // Unreadable child: keep scanning.
          }
        }
      }
    }
  } catch {
    // Children unreadable: no best line.
  }
  return null;
}

/**
 * Repaint every card's `.map-best` line from storage (`Best: N` or empty
 * when absent), creating missing lines best-effort so static skeletons
 * without the span still converge. Never throws.
 */
export function refreshBestLines(
  doc: Document,
  storage: SetupStorage | null | undefined,
): void {
  try {
    const bests = loadBestScores(storage);
    for (const card of carouselCards(doc)) {
      try {
        const map = cardMap(card);
        if (map === null) {
          continue;
        }
        const text = formatBestLine(bests[map]);
        const span = findBestSpan(card);
        if (span !== null && typeof span === "object") {
          try {
            if ("textContent" in (span as object)) {
              (span as { textContent?: unknown }).textContent = text;
            }
          } catch {
            // One unreadable line never blocks the rest.
          }
          continue;
        }
        try {
          const api = doc as unknown as { createElement?: unknown };
          if (typeof api.createElement !== "function") {
            continue;
          }
          const made = (api.createElement as (tag: string) => unknown).call(
            doc,
            "span",
          );
          if (made === null || typeof made !== "object") {
            continue;
          }
          try {
            const setAttr = (
              made as { setAttribute?: (name: string, value: string) => void }
            ).setAttribute;
            if (typeof setAttr === "function") {
              setAttr.call(made, "class", "map-best");
            }
          } catch {
            // Best-line class best-effort only.
          }
          if ("textContent" in made) {
            (made as { textContent?: unknown }).textContent = text;
          }
          try {
            const appender = (card as { appendChild?: unknown }).appendChild;
            if (typeof appender === "function") {
              (appender as (kid: unknown) => void).call(card, made);
            }
          } catch {
            // Best line optional: the name still selects.
          }
        } catch {
          // Missing-line backfill best-effort only.
        }
      } catch {
        // One bad card never blocks the rest.
      }
    }
  } catch {
    // Shorn document: boot continues without best lines.
  }
}

/**
 * Ensure the carousel container exists inside #menu with one card per
 * arena. Each card is a `<button class="map-card" data-map-card>`
 * holding a `<canvas class="map-thumb" width height>` plus a
 * `<span class="map-name">`. Idempotent; missing #menu or shorn
 * documents read null instead of throwing.
 */
export function ensureCarousel(doc: Document): unknown {
  try {
    const api = doc as unknown as {
      getElementById?: unknown;
      createElement?: unknown;
    };
    if (
      typeof api.getElementById !== "function" ||
      typeof api.createElement !== "function"
    ) {
      return null;
    }
    const get = api.getElementById as (id: string) => unknown;
    const make = api.createElement as (tag: string) => unknown;
    const existing = get.call(doc, CAROUSEL_ID);
    if (existing !== null && typeof existing === "object") {
      return existing;
    }
    const menu = get.call(doc, "menu");
    if (menu === null || typeof menu !== "object") {
      return null;
    }
    const container = make.call(doc, "div");
    if (container === null || typeof container !== "object") {
      return null;
    }
    try {
      const setAttr = (
        container as { setAttribute?: (name: string, value: string) => void }
      ).setAttribute;
      if (typeof setAttr === "function") {
        setAttr.call(container, "id", CAROUSEL_ID);
        setAttr.call(container, "role", "listbox");
        setAttr.call(container, "aria-label", "Choose arena");
      }
      (container as { id?: unknown }).id = CAROUSEL_ID;
    } catch {
      // Id/role best-effort only.
    }
    for (const map of CAROUSEL_MAPS) {
      const card = make.call(doc, "button");
      if (card === null || typeof card !== "object") {
        continue;
      }
      try {
        const setAttr = (
          card as { setAttribute?: (name: string, value: string) => void }
        ).setAttribute;
        if (typeof setAttr === "function") {
          setAttr.call(card, CARD_ATTR, map);
          setAttr.call(card, "aria-pressed", "false");
          setAttr.call(card, "aria-selected", "false");
          setAttr.call(card, "class", "map-card");
          setAttr.call(card, "role", "option");
          setAttr.call(card, "type", "button");
        }
      } catch {
        // Card attrs best-effort only.
      }
      const thumb = make.call(doc, "canvas");
      if (thumb !== null && typeof thumb === "object") {
        try {
          const setAttr = (
            thumb as { setAttribute?: (name: string, value: string) => void }
          ).setAttribute;
          if (typeof setAttr === "function") {
            setAttr.call(thumb, "class", "map-thumb");
            setAttr.call(thumb, "width", String(THUMB_W));
            setAttr.call(thumb, "height", String(THUMB_H));
          }
          (thumb as { width?: unknown }).width = THUMB_W;
          (thumb as { height?: unknown }).height = THUMB_H;
        } catch {
          // Canvas size best-effort only.
        }
        try {
          const appender = (card as { appendChild?: unknown }).appendChild;
          if (typeof appender === "function") {
            (appender as (kid: unknown) => void).call(card, thumb);
          }
        } catch {
          // Thumb optional: the name still selects.
        }
      }
      const label = make.call(doc, "span");
      if (label !== null && typeof label === "object") {
        try {
          const setAttr = (
            label as { setAttribute?: (name: string, value: string) => void }
          ).setAttribute;
          if (typeof setAttr === "function") {
            setAttr.call(label, "class", "map-name");
          }
        } catch {
          // Label class best-effort only.
        }
        if ("textContent" in label) {
          (label as { textContent?: unknown }).textContent = map;
        }
        try {
          const appender = (card as { appendChild?: unknown }).appendChild;
          if (typeof appender === "function") {
            (appender as (kid: unknown) => void).call(card, label);
          }
        } catch {
          // Label optional: the card still selects.
        }
      }
      const best = make.call(doc, "span");
      if (best !== null && typeof best === "object") {
        try {
          const setAttr = (
            best as { setAttribute?: (name: string, value: string) => void }
          ).setAttribute;
          if (typeof setAttr === "function") {
            setAttr.call(best, "class", "map-best");
          }
        } catch {
          // Best-line class best-effort only.
        }
        if ("textContent" in best) {
          (best as { textContent?: unknown }).textContent = "";
        }
        try {
          const appender = (card as { appendChild?: unknown }).appendChild;
          if (typeof appender === "function") {
            (appender as (kid: unknown) => void).call(card, best);
          }
        } catch {
          // Best line optional: the name still selects.
        }
      }
      try {
        const appender = (container as { appendChild?: unknown }).appendChild;
        if (typeof appender === "function") {
          (appender as (kid: unknown) => void).call(container, card);
        }
      } catch {
        // Card append failure: keep the rest of the carousel.
      }
    }
    try {
      const appender = (menu as { appendChild?: unknown }).appendChild;
      if (typeof appender !== "function") {
        return null;
      }
      (appender as (kid: unknown) => void).call(menu, container);
      return container;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/** Find the card's thumbnail canvas (null when absent). */
function cardCanvas(card: unknown): {
  width?: unknown;
  height?: unknown;
  getContext?: unknown;
} | null {
  if (typeof card !== "object" || card === null) {
    return null;
  }
  try {
    const query = (card as { querySelector?: unknown }).querySelector;
    if (typeof query === "function") {
      const found =
        ((query as (sel: string) => unknown).call(card, "canvas.map-thumb") as object | null) ??
        ((query as (sel: string) => unknown).call(card, "canvas") as object | null);
      if (found !== null && typeof found === "object") {
        return found as {
          width?: unknown;
          height?: unknown;
          getContext?: unknown;
        };
      }
    }
  } catch {
    // querySelector shorn: scan children below.
  }
  try {
    const kids = (card as { children?: unknown }).children;
    if (kids !== null && typeof kids === "object") {
      const list = kids as ArrayLike<unknown>;
      if (typeof list.length === "number") {
        for (let i = 0; i < list.length; i += 1) {
          const kid = list[i];
          if (typeof kid === "object" && kid !== null) {
            const tag = (kid as { tagName?: unknown; tag?: unknown }).tagName ??
              (kid as { tag?: unknown }).tag;
            if (typeof tag === "string" && tag.toLowerCase() === "canvas") {
              return kid as {
                width?: unknown;
                height?: unknown;
                getContext?: unknown;
              };
            }
          }
        }
      }
    }
  } catch {
    // Children unreadable: no canvas.
  }
  return null;
}

/** Read a finite canvas dimension, falling back to the thumbnail default. */
function canvasDim(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

/**
 * Paint every card thumbnail from its own map. A null (or headless-less)
 * 2d context skips that card; the whole pass never throws so boot is
 * never gated on canvas availability.
 */
export function paintAllThumbnails(doc: Document): void {
  try {
    for (const card of carouselCards(doc)) {
      try {
        const map = cardMap(card);
        if (map === null) {
          continue;
        }
        const canvas = cardCanvas(card);
        if (canvas === null) {
          continue;
        }
        const getCtx = canvas.getContext;
        if (typeof getCtx !== "function") {
          continue;
        }
        const ctx = (getCtx as (kind: string) => unknown).call(canvas, "2d");
        if (ctx === null || ctx === undefined) {
          continue;
        }
        paintMapThumbnail(
          ctx,
          map,
          canvasDim(canvas.width, THUMB_W),
          canvasDim(canvas.height, THUMB_H),
        );
      } catch {
        // One bad card never blocks the rest.
      }
    }
  } catch {
    // Shorn document: boot continues unpainted.
  }
}

/**
 * Read one page dot per arena in setup menu order (possibly empty).
 * Uses per-map querySelector lookups (the readTier idiom) so shorn
 * documents without querySelectorAll still converge. Never throws.
 */
function carouselDots(doc: Document): unknown[] {
  const out: unknown[] = [];
  try {
    const query = (doc as unknown as { querySelector?: unknown }).querySelector;
    if (typeof query !== "function") {
      return out;
    }
    const q = query as (sel: string) => unknown;
    for (const map of CAROUSEL_MAPS) {
      try {
        const node = q.call(doc, `[${DOT_ATTR}="${map}"]`);
        if (node !== null && typeof node === "object") {
          out.push(node);
        }
      } catch {
        // One unreadable dot never blocks the rest.
      }
    }
  } catch {
    // Shorn document: no dots.
  }
  return out;
}

/** Read a dot's map name from its data attribute (null when unreadable). */
function dotMap(dot: unknown): SetupMap | null {
  try {
    const attr = asAttr(dot);
    if (attr === null) {
      return null;
    }
    const raw = attr.getAttribute(DOT_ATTR);
    if (typeof raw !== "string") {
      return null;
    }
    const key = raw.trim().toLowerCase();
    if ((MAP_LIST as readonly string[]).includes(key)) {
      return key as SetupMap;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sync every page dot to the selection: the active dot reads
 * aria-selected true (the chrome.css on-pip), the rest false.
 * Best-effort; never throws.
 */
export function syncCarouselDots(doc: Document, map: unknown): SetupMap {
  const normalized = parseCarouselMap(map);
  try {
    for (const dot of carouselDots(doc)) {
      try {
        if (dotMap(dot) === null) {
          continue;
        }
        const attr = asAttr(dot);
        if (attr === null) {
          continue;
        }
        const selected = dotMap(dot) === normalized;
        attr.setAttribute("aria-selected", selected ? "true" : "false");
        // Keep the dot plate in sync with the selection so the icon set
        // never shows a stale on/off well after a cycle.
        try {
          const query = (dot as { querySelector?: unknown }).querySelector;
          const img =
            typeof query === "function"
              ? (query as (sel: string) => unknown).call(dot, "img")
              : null;
          const want = selected ? "./assets/ui/menu-dot-on.png" : "./assets/ui/menu-dot-off.png";
          if (img !== null && typeof img === "object") {
            const setter = (img as { setAttribute?: unknown }).setAttribute;
            if (typeof setter === "function") {
              (setter as (n: string, v: string) => void).call(img, "src", want);
            }
            try {
              (img as Record<string, unknown>)["src"] = want;
            } catch {
              // Attribute above already landed.
            }
          }
        } catch {
          // Dot plate optional: aria-selected still carries the state.
        }
      } catch {
        // One unreadable dot never blocks the rest.
      }
    }
  } catch {
    // Dot sync best-effort only.
  }
  return normalized;
}

/**
 * Mirror the selection onto the menu theme (the per-theme scrim veil
 * in menu.css follows `menu[data-theme]`). Unknown maps fall back to
 * the kilima veil. Best-effort; never throws.
 */
export function syncMenuTheme(doc: Document, map: unknown): SetupMap {
  const normalized = parseCarouselMap(map);
  try {
    const byId = (doc as unknown as { getElementById?: unknown }).getElementById;
    if (typeof byId !== "function") {
      return normalized;
    }
    const attr = asAttr((byId as (id: string) => unknown).call(doc, "menu"));
    if (attr === null) {
      return normalized;
    }
    attr.setAttribute("data-theme", normalized);
  } catch {
    // Theme mirror best-effort only.
  }
  return normalized;
}

/**
 * Step the selection one arena forward (+1) or back (-1), wrapping
 * around the map list. Unknown directions step forward. Persists via
 * selectCarouselMap (dots and theme follow). Never throws.
 */
export function cycleCarouselMap(
  doc: Document,
  storage: SetupStorage | null | undefined,
  direction: unknown,
): SetupMap {
  try {
    const step =
      direction === -1 ||
      direction === "-1" ||
      direction === "prev" ||
      direction === "previous" ||
      direction === "left"
        ? -1
        : 1;
    const current = carouselConfigFor(doc, storage).map;
    const at = CAROUSEL_MAPS.indexOf(current);
    const base = at < 0 ? 0 : at;
    const next =
      CAROUSEL_MAPS[
        ((base + step) % CAROUSEL_MAPS.length + CAROUSEL_MAPS.length) %
          CAROUSEL_MAPS.length
      ] ?? DEFAULT_SETUP.map;
    return selectCarouselMap(doc, storage, next);
  } catch {
    return DEFAULT_SETUP.map;
  }
}

/**
 * Ensure the carousel nav affordances exist: previous/next arrow
 * buttons flanking the cards plus one page dot per arena. Static
 * skeletons ship them; this backstops dynamic documents by appending
 * text-glyph buttons to #menu. Idempotent; never throws.
 */
export function ensureCarouselNav(doc: Document): void {
  try {
    const api = doc as unknown as {
      getElementById?: unknown;
      createElement?: unknown;
    };
    if (
      typeof api.getElementById !== "function" ||
      typeof api.createElement !== "function"
    ) {
      return;
    }
    const get = api.getElementById as (id: string) => unknown;
    const make = api.createElement as (tag: string) => unknown;
    const menu = get.call(doc, "menu");
    if (menu === null || typeof menu !== "object") {
      return;
    }
    const appender = (menu as { appendChild?: unknown }).appendChild;
    if (typeof appender !== "function") {
      return;
    }
    const glyphSrcFor = (glyph: string): string | null => {
      if (glyph === "\u2039") {
        return "./assets/atlas/icons/glyph-chev-left.png";
      }
      if (glyph === "\u203a") {
        return "./assets/atlas/icons/glyph-chev-right.png";
      }
      if (glyph === "\u25cf") {
        return "./assets/ui/menu-dot-off.png";
      }
      return null;
    };
    const ensureButton = (
      id: string,
      cls: string,
      label: string,
      glyph: string,
      attrName: string | null,
      attrValue: string | null,
    ): void => {
      try {
        const existing = get.call(doc, id);
        if (existing !== null && typeof existing === "object") {
          return;
        }
        const made = make.call(doc, "button");
        if (made === null || typeof made !== "object") {
          return;
        }
        try {
          const setAttr = (
            made as { setAttribute?: (name: string, value: string) => void }
          ).setAttribute;
          if (typeof setAttr === "function") {
            setAttr.call(made, "id", id);
            setAttr.call(made, "class", cls);
            setAttr.call(made, "type", "button");
            setAttr.call(made, "aria-label", label);
            if (attrName !== null && attrValue !== null) {
              setAttr.call(made, attrName, attrValue);
            }
          }
          (made as { id?: unknown }).id = id;
        } catch {
          // Attrs best-effort only.
        }
        try {
          const src = glyphSrcFor(glyph);
          if (src !== null) {
            const img = make.call(doc, "img");
            if (img !== null && typeof img === "object") {
              try {
                const setter = (img as { setAttribute?: unknown }).setAttribute;
                if (typeof setter === "function") {
                  (setter as (n: string, v: string) => void).call(img, "src", src);
                  (setter as (n: string, v: string) => void).call(img, "alt", label);
                }
              } catch {
                // Attrs best-effort only.
              }
              try {
                (img as Record<string, unknown>)["src"] = src;
              } catch {
                // Read-only shims: attributes above already landed.
              }
              const kid = (made as { appendChild?: unknown }).appendChild;
              if (typeof kid === "function") {
                (kid as (child: unknown) => void).call(made, img);
              }
            }
          } else {
            const span = make.call(doc, "span");
            if (span !== null && typeof span === "object") {
              if ("textContent" in span) {
                (span as { textContent?: unknown }).textContent = glyph;
              }
              const kid = (made as { appendChild?: unknown }).appendChild;
              if (typeof kid === "function") {
                (kid as (child: unknown) => void).call(made, span);
              }
            }
          }
        } catch {
          // Glyph best-effort only.
        }
        (appender as (kid: unknown) => void).call(menu, made);
      } catch {
        // One missing affordance never blocks the rest.
      }
    };
    ensureButton(CAROUSEL_PREV_ID, "carousel-arrow", "Previous arena", "‹", null, null);
    ensureButton(CAROUSEL_NEXT_ID, "carousel-arrow", "Next arena", "›", null, null);
    const query = (doc as unknown as { querySelector?: unknown }).querySelector;
    for (const map of CAROUSEL_MAPS) {
      let dotExists = false;
      try {
        if (typeof query === "function") {
          const found = (query as (sel: string) => unknown).call(
            doc,
            `[${DOT_ATTR}="${map}"]`,
          );
          dotExists = found !== null && typeof found === "object";
        }
      } catch {
        dotExists = false;
      }
      // Static skeletons ship the dots (id-less, found by attribute);
      // only the dynamic backstop mints id'd spares.
      if (dotExists) {
        continue;
      }
      ensureButton(
        `carousel-dot-${map}`,
        "carousel-dot",
        map,
        "●",
        DOT_ATTR,
        map,
      );
    }
  } catch {
    // Nav backstop best-effort only.
  }
}

/**
 * Persist a carousel selection and sync every pressed state: the
 * carousel cards plus the legacy `#setup [data-map]` buttons (which
 * keep owning the `data-map` attribute). Mirrors the choice onto
 * `window.__carousel` best-effort. Returns the normalized map.
 */
export function selectCarouselMap(
  doc: Document,
  storage: SetupStorage | null | undefined,
  map: unknown,
): SetupMap {
  const normalized = parseCarouselMap(map);
  try {
    saveSetup(storage, { ...loadSetup(storage), map: normalized });
  } catch {
    // Storage best-effort: the pressed states still sync.
  }
  try {
    for (const card of carouselCards(doc)) {
      const attr = asAttr(card);
      if (attr === null) {
        continue;
      }
      if (cardMap(card) === null) {
        continue;
      }
      const active = cardMap(card) === normalized;
      try {
        attr.setAttribute("aria-pressed", active ? "true" : "false");
        attr.setAttribute("aria-selected", active ? "true" : "false");
        if (active) {
          attr.setAttribute("data-active", "true");
        } else {
          attr.removeAttribute("data-active");
        }
      } catch {
        // One unreadable card never blocks the rest.
      }
      syncCardSelected(card, active);
    }
  } catch {
    // Card sync best-effort only.
  }
  try {
    const query = (doc as unknown as { querySelector?: unknown }).querySelector;
    if (typeof query === "function") {
      const q = query as (sel: string) => unknown;
      for (const name of MAP_LIST) {
        const button = q.call(doc, `[data-map="${name}"]`) as unknown;
        const attr = asAttr(button);
        if (attr === null) {
          continue;
        }
        const active = name === normalized;
        try {
          attr.setAttribute("aria-pressed", active ? "true" : "false");
          if (active) {
            attr.setAttribute("data-active", "true");
          } else {
            attr.removeAttribute("data-active");
          }
        } catch {
          // One unreadable button never blocks the rest.
        }
      }
    }
  } catch {
    // Legacy sync best-effort only.
  }
  try {
    syncCarouselDots(doc, normalized);
  } catch {
    // Dot sync best-effort only.
  }
  try {
    syncMenuTheme(doc, normalized);
  } catch {
    // Theme mirror best-effort only.
  }
  try {
    if (typeof window !== "undefined") {
      const surface: Record<string, unknown> = {
        map: normalized,
        maps: CAROUSEL_MAPS.slice(),
      };
      const game = (window as unknown as Record<string, unknown>)[
        "__carousel"
      ] as Record<string, unknown> | undefined;
      if (game !== undefined && game !== null && typeof game === "object") {
        Object.assign(game, surface);
      } else {
        (window as unknown as Record<string, unknown>)["__carousel"] = surface;
      }
    }
  } catch {
    // Probe mirror best-effort only.
  }
  return normalized;
}

/** Live binder state returned by bindCarousel. */
export interface CarouselBinder {
  /** Latest carousel config (refreshed on every select). */
  config: SetupConfig;
  /** Re-read the live selection and repaint pressed states. */
  refresh(): SetupConfig;
  /** Persist a selection and sync pressed states. */
  select(map: unknown): SetupMap;
  /** Step the selection one arena forward (+1) or back (-1). */
  cycle(direction: unknown): SetupMap;
  /** Tear down the arrow-key listener (idempotent). */
  stop(): void;
}

/**
 * True while keyboard carousel nav may run: the menu is visible and
 * the key target is not an editable control (typing a pilot name or
 * picking a palette must never reselect the arena).
 */
export function carouselKeyAllowed(doc: Document, target: unknown): boolean {
  try {
    if (!isMenuVisible(doc)) {
      return false;
    }
    if (typeof target === "object" && target !== null) {
      const tag = (target as { tagName?: unknown }).tagName;
      if (typeof tag === "string") {
        const upper = tag.toUpperCase();
        if (upper === "INPUT" || upper === "SELECT" || upper === "TEXTAREA") {
          return false;
        }
      }
      const editable = (target as { isContentEditable?: unknown }).isContentEditable;
      if (editable === true) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Wire the map carousel: ensure the DOM, paint the thumbnails, apply
 * the stored selection, and attach one click listener per card.
 * The arrow buttons and page dots cycle the same selection (click plus
 * Left/Right keys while the menu is visible); the menu theme follows
 * the selection for the per-theme scrim veil. Missing elements are
 * no-ops; listeners attach once. Never touches
 * the sim, the match renderer, or the Quick Play handler (which keeps
 * reading the persisted setup verbatim).
 */
export function bindCarousel(
  doc: Document,
  storage: SetupStorage | null | undefined,
): CarouselBinder {
  let keyHandler: ((event: KeyboardEvent) => void) | null = null;
  const binder: CarouselBinder = {
    config: loadSetup(storage),
    refresh: (): SetupConfig => binder.config,
    select: (map: unknown): SetupMap => {
      const normalized = selectCarouselMap(doc, storage, map);
      binder.config = parseSetup({ ...binder.config, map: normalized });
      return normalized;
    },
    cycle: (direction: unknown): SetupMap => {
      const normalized = cycleCarouselMap(doc, storage, direction);
      binder.config = parseSetup({ ...binder.config, map: normalized });
      return normalized;
    },
    stop: (): void => {
      try {
        if (keyHandler !== null && typeof window !== "undefined") {
          const remove = (
            window as unknown as { removeEventListener?: unknown }
          ).removeEventListener;
          if (typeof remove === "function") {
            (remove as (type: string, listener: (event: KeyboardEvent) => void) => void).call(
              window,
              "keydown",
              keyHandler,
            );
          }
        }
      } catch {
        // Listener teardown best-effort only.
      }
      keyHandler = null;
    },
  };
  try {
    ensureCarousel(doc);
  } catch {
    // Scene optional: painting still proceeds on static skeletons.
  }
  try {
    ensureCarouselNav(doc);
  } catch {
    // Nav optional: cards still select.
  }
  try {
    paintAllThumbnails(doc);
  } catch {
    // Unpainted cards still select.
  }
  binder.refresh = (): SetupConfig => {
    try {
      const live = carouselConfigFor(doc, storage);
      binder.config = live;
      try {
        selectCarouselMap(doc, storage, live.map);
      } catch {
        // Pressed-state sync best-effort only.
      }
      try {
        refreshBestLines(doc, storage);
      } catch {
        // Best-line repaint best-effort only.
      }
      return { ...live };
    } catch {
      return { ...binder.config };
    }
  };
  try {
    // Boot seeds from persisted storage (never from the static skeleton
    // pressed state): a stored non-default map must survive reload.
    binder.config = loadSetup(storage);
    selectCarouselMap(doc, storage, binder.config.map);
    refreshBestLines(doc, storage);
  } catch {
    // Stored-selection paint best-effort only.
  }
  try {
    for (const card of carouselCards(doc)) {
      try {
        const attr = asAttr(card);
        if (attr !== null) {
          try {
            if (attr.getAttribute("data-carousel-bound") === "true") {
              continue;
            }
          } catch {
            // Unreadable marker: bind anyway.
          }
        }
        const clickable = card as { addEventListener?: unknown };
        if (
          typeof clickable.addEventListener !== "function" ||
          cardMap(card) === null
        ) {
          continue;
        }
        const name = cardMap(card) as SetupMap;
        (clickable.addEventListener as (type: string, listener: () => void) => void).call(
          clickable,
          "click",
          () => {
            binder.select(name);
          },
        );
        if (attr !== null) {
          try {
            attr.setAttribute("data-carousel-bound", "true");
          } catch {
            // Marker best-effort: double binding only duplicates a save.
          }
        }
      } catch {
        // One bad card never blocks the rest.
      }
    }
  } catch {
    // Listener wiring best-effort only.
  }
  // Arrow buttons plus page dots cycle the same persisted selection;
  // one listener each, guarded by the bound marker like the cards.
  try {
    const byId = (doc as unknown as { getElementById?: unknown }).getElementById;
    const get = typeof byId === "function" ? (byId as (id: string) => unknown) : null;
    const wireNav = (id: string, direction: 1 | -1): void => {
      try {
        if (get === null) {
          return;
        }
        const node = get.call(doc, id) as {
          addEventListener?: unknown;
          getAttribute?: (name: string) => string | null;
          setAttribute?: (name: string, value: string) => void;
        } | null;
        if (node === null || typeof node !== "object") {
          return;
        }
        if (typeof node.addEventListener !== "function") {
          return;
        }
        try {
          if (
            typeof node.getAttribute === "function" &&
            node.getAttribute.call(node, "data-carousel-bound") === "true"
          ) {
            return;
          }
        } catch {
          // Unreadable marker: bind anyway.
        }
        (node.addEventListener as (type: string, listener: () => void) => void).call(
          node,
          "click",
          () => {
            binder.cycle(direction);
          },
        );
        try {
          node.setAttribute?.call(node, "data-carousel-bound", "true");
        } catch {
          // Marker best-effort: double binding only duplicates a save.
        }
      } catch {
        // One bad affordance never blocks the rest.
      }
    };
    wireNav(CAROUSEL_PREV_ID, -1);
    wireNav(CAROUSEL_NEXT_ID, 1);
    for (const dot of carouselDots(doc)) {
      try {
        const name = dotMap(dot);
        if (name === null) {
          continue;
        }
        const clickable = dot as { addEventListener?: unknown };
        if (typeof clickable.addEventListener !== "function") {
          continue;
        }
        const attr = asAttr(dot);
        try {
          if (
            attr !== null &&
            attr.getAttribute("data-carousel-bound") === "true"
          ) {
            continue;
          }
        } catch {
          // Unreadable marker: bind anyway.
        }
        (clickable.addEventListener as (type: string, listener: () => void) => void).call(
          clickable,
          "click",
          () => {
            binder.select(name);
          },
        );
        try {
          attr?.setAttribute("data-carousel-bound", "true");
        } catch {
          // Marker best-effort: double binding only duplicates a save.
        }
      } catch {
        // One bad dot never blocks the rest.
      }
    }
  } catch {
    // Nav wiring best-effort only.
  }
  // Arrow-key nav: Left/Right cycle while the menu is visible and the
  // focus is not in an editable control. Registered once per window;
  // stop() removes it. Never prevents default: the match input layer
  // keeps its own key handling untouched.
  try {
    if (typeof window !== "undefined") {
      const surface = window as unknown as Record<string, unknown>;
      if (surface["__carouselKeys"] !== true) {
        const add = (window as unknown as { addEventListener?: unknown }).addEventListener;
        if (typeof add === "function") {
          keyHandler = (event: KeyboardEvent): void => {
            try {
              if (event.repeat) {
                return;
              }
              const key = (event as { key?: unknown }).key;
              if (key !== "ArrowLeft" && key !== "ArrowRight") {
                return;
              }
              if (!carouselKeyAllowed(doc, (event as { target?: unknown }).target ?? null)) {
                return;
              }
              binder.cycle(key === "ArrowLeft" ? -1 : 1);
            } catch {
              // Key nav best-effort: the buttons still work.
            }
          };
          (add as (type: string, listener: (event: KeyboardEvent) => void) => void).call(
            window,
            "keydown",
            keyHandler,
          );
          surface["__carouselKeys"] = true;
        }
      }
    }
  } catch {
    // Key nav best-effort: the buttons still work.
  }
  const baseStop = binder.stop;
  binder.stop = (): void => {
    // Only the binder that registered the window handler releases the
    // once-per-window flag; a binder that never registered keeps it.
    const owned = keyHandler !== null;
    try {
      baseStop();
    } catch {
      // Base teardown best-effort only.
    }
    try {
      if (owned && typeof window !== "undefined") {
        const surface = window as unknown as Record<string, unknown>;
        if (surface["__carouselKeys"] === true) {
          delete surface["__carouselKeys"];
        }
      }
    } catch {
      // Flag teardown best-effort only.
    }
  };
  return binder;
}
