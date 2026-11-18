// Layer discipline plus stale-overlay destruction (issue #313): the
// single numeric stacking authority (canvas 0, HUD 10, overlays 20,
// menu 30) with exclusive overlay visibility and real DOM destruction
// of the end-screen standings on Menu return. Pure helpers stay DOM-free
// and unit-testable under node (the feed.ts lookup/model idiom); every
// helper degrades to a no-op on fake docs without builders and never
// throws (the pushFeed binder idiom).

/** Canvas band: the match renderer paints at the bottom of the stack. */
export const LAYER_CANVAS = 0;
/** HUD band: health, ammo, feed, tags, and respawn paint above canvas. */
export const LAYER_HUD = 10;
/** Overlay band: setup, settings, how-to, challenges, locker, and end screens above HUD. */
export const LAYER_OVERLAY = 20;
/** Menu band: the menu root paints above every overlay. */
export const LAYER_MENU = 30;

/** Overlay ids owned by exclusive visibility (menu returns here). */
export const OVERLAY_IDS: readonly string[] = [
  "end-screen",
  "setup",
  "settings",
  "howto",
  "challenges",
  "locker",
];

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

/** Null-safe id lookup without throwing on hostile shims. */
function byId(doc: unknown, id: string): unknown {
  try {
    const lookup = (doc as { getElementById?: unknown }).getElementById;
    if (typeof lookup === "function") {
      return (lookup as (lookupId: string) => unknown).call(doc, id);
    }
  } catch {
    // Lookup-less docs: the caller treats the miss as absent.
  }
  return null;
}

/**
 * Show one overlay exclusively: `id` reads display "" while every other
 * overlay id reads "none". Missing elements are skipped; never throws.
 */
export function showOnly(doc: unknown, id: string): void {
  if (typeof doc !== "object" || doc === null) {
    return;
  }
  for (const overlayId of OVERLAY_IDS) {
    try {
      setDisplay(byId(doc, overlayId), overlayId === id ? "" : "none");
    } catch {
      // Unstylable shims: the remaining overlays still land.
    }
  }
}

/**
 * Destroy stale end-screen standings: every `.standings` node plus the
 * `#end-standings` container is removed from the document (never hidden)
 * and the `#end-winner` callout is cleared, so no `standings` substring
 * survives in body HTML. Missing builders and hostile shims are no-ops;
 * never throws.
 */
export function destroyStandings(doc: unknown): void {
  if (typeof doc !== "object" || doc === null) {
    return;
  }
  try {
    const query = (doc as { querySelectorAll?: unknown }).querySelectorAll;
    if (typeof query === "function") {
      const found = (query as (sel: string) => unknown).call(
        doc,
        ".standings",
      ) as { length?: unknown; [index: number]: unknown } | null;
      const length =
        typeof found?.length === "number" ? (found.length as number) : 0;
      for (let i = 0; i < length; i += 1) {
        try {
          const node = (found as { [index: number]: unknown })[i] as {
            remove?: unknown;
          } | null;
          if (typeof node?.remove === "function") {
            (node.remove as () => void).call(node);
          }
        } catch {
          // A stuck node never blocks the container removal below.
        }
      }
    }
  } catch {
    // Query-less docs: the container removal below still lands.
  }
  try {
    const container = byId(doc, "end-standings") as {
      remove?: unknown;
    } | null;
    if (typeof container?.remove === "function") {
      (container.remove as () => void).call(container);
    }
  } catch {
    // Detached docs: the winner clearing below still lands.
  }
  try {
    const winner = byId(doc, "end-winner");
    if (
      typeof winner === "object" &&
      winner !== null &&
      "textContent" in winner
    ) {
      (winner as { textContent: unknown }).textContent = "";
    }
  } catch {
    // Text-less shims: the removals above already landed.
  }
}

/**
 * Rebuild the `#end-standings` container inside `#end-screen` when it is
 * absent (destroyed on the last Menu return); returns the container, or
 * null when the screen or element builders are missing. Idempotent: a
 * present container is returned untouched. Never throws.
 */
export function ensureStandings(doc: unknown): unknown {
  if (typeof doc !== "object" || doc === null) {
    return null;
  }
  const screen = byId(doc, "end-screen");
  if (typeof screen !== "object" || screen === null) {
    return null;
  }
  const existing = byId(doc, "end-standings");
  if (existing !== null && existing !== undefined) {
    return existing;
  }
  try {
    const create = (doc as { createElement?: unknown }).createElement;
    if (typeof create !== "function") {
      return null;
    }
    const created = (create as (tag: string) => unknown).call(
      doc,
      "div",
    ) as { setAttribute?: unknown; id?: unknown } | null;
    if (typeof created !== "object" || created === null) {
      return null;
    }
    try {
      if (typeof created.setAttribute === "function") {
        (created.setAttribute as (name: string, value: string) => void).call(
          created,
          "id",
          "end-standings",
        );
      } else {
        created.id = "end-standings";
      }
    } catch {
      try {
        created.id = "end-standings";
      } catch {
        return null;
      }
    }
    const append = (screen as { appendChild?: unknown }).appendChild;
    if (typeof append !== "function") {
      return null;
    }
    (append as (child: unknown) => void).call(screen, created);
    return created;
  } catch {
    return null;
  }
}
