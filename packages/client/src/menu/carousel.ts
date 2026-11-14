// Map carousel with live headless thumbnails. One card per MAP_LIST
// entry lives inside #menu; each card carries a <canvas> painted
// synchronously at boot from core ASCII rows (mapRowsFor) through a
// tiny dedicated tile painter (sky fill from skyGradeFor plus scaled
// tile rects colored by themeFor/tileKindAt). Card selection persists
// via saveSetup so the untouched Quick Play path
// (startMatch(loadSetup(storage))) loads the selected map. Pure
// helpers stay DOM-free for node tests; the binder mirrors the
// scene.ts idiom (null-safe lookups, missing parents are no-ops,
// listeners attach once).

import { TileMap } from "../../../core/src/map";
import { mapRowsFor } from "../maps";
import { skyGradeFor, themeFor } from "../view/theme";
import { tileKindAt } from "../view/tiles";
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
 * one-way planks and bounce pads in their theme fills, backwalls in
 * the dimmed quad). Unknown maps fall back to kilima; non-finite
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
          target.fillStyle = theme.oneWay;
          target.fillRect(
            tx * 32 * sx,
            (ty * 32 + 24) * sy,
            32 * sx,
            8 * sy,
          );
        } else {
          target.fillStyle = theme.bounce;
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
        if (active) {
          attr.setAttribute("data-active", "true");
        } else {
          attr.removeAttribute("data-active");
        }
      } catch {
        // One unreadable card never blocks the rest.
      }
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
  /** Tear down (no timers: idempotent no-op for shape parity). */
  stop(): void;
}

/**
 * Wire the map carousel: ensure the DOM, paint the thumbnails, apply
 * the stored selection, and attach one click listener per card.
 * Missing elements are no-ops; listeners attach once. Never touches
 * the sim, the match renderer, or the Quick Play handler (which keeps
 * reading the persisted setup verbatim).
 */
export function bindCarousel(
  doc: Document,
  storage: SetupStorage | null | undefined,
): CarouselBinder {
  const binder: CarouselBinder = {
    config: loadSetup(storage),
    refresh: (): SetupConfig => binder.config,
    select: (map: unknown): SetupMap => {
      const normalized = selectCarouselMap(doc, storage, map);
      binder.config = parseSetup({ ...binder.config, map: normalized });
      return normalized;
    },
    stop: (): void => {},
  };
  try {
    ensureCarousel(doc);
  } catch {
    // Scene optional: painting still proceeds on static skeletons.
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
      return { ...live };
    } catch {
      return { ...binder.config };
    }
  };
  try {
    binder.config = carouselConfigFor(doc, storage);
    selectCarouselMap(doc, storage, binder.config.map);
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
  return binder;
}
