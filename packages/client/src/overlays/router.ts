// Overlay hash router (issue #319): hash routes for the five Panel
// surfaces (setup, settings, how-to, challenges, locker) without
// changing query/state behavior. Pure helpers stay DOM-free and
// unit-testable under node (the layers.ts lookup idiom); the binder
// degrades to a no-op on shorn docs and never throws.

/** Overlay routes owned by the hash router in menu order. */
export const OVERLAY_ROUTE_IDS = [
  "setup",
  "settings",
  "howto",
  "challenges",
  "locker",
] as const;

/** Overlay route union. */
export type OverlayRoute = (typeof OVERLAY_ROUTE_IDS)[number];

/** True when the value names one of the five overlay routes. */
function isRoute(value: string): value is OverlayRoute {
  for (const id of OVERLAY_ROUTE_IDS) {
    if (value === id) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a location hash into an overlay route: accepts `#setup`,
 * `#/setup`, `#setup?x=1`, upper case, and surrounding whitespace;
 * anything else (empty, `#menu`, unknown) reads null. Never throws.
 */
export function routeFromHash(hash: unknown): OverlayRoute | null {
  try {
    if (typeof hash !== "string") {
      return null;
    }
    let text = hash.trim();
    if (text === "") {
      return null;
    }
    if (text.startsWith("#")) {
      text = text.slice(1);
    }
    text = text.trim();
    if (text.startsWith("/")) {
      text = text.slice(1);
    }
    text = text.trim();
    const end = text.search(/[?/&\s]/);
    if (end !== -1) {
      text = text.slice(0, end);
    }
    const key = text.trim().toLowerCase();
    if (key === "") {
      return null;
    }
    return isRoute(key) ? key : null;
  } catch {
    return null;
  }
}

/** Canonical hash for a route (`#setup`). */
export function hashFor(route: OverlayRoute): string {
  return `#${route}`;
}

/** Minimal document surface for the router binder. */
export interface RouterDoc {
  getElementById(id: string): unknown;
  querySelectorAll?(selector: string): unknown;
}

/** Callbacks owning visibility plus per-route prefill. */
export interface RouterHandlers {
  /** Show one overlay exclusively (hides the others). */
  show(id: string): void;
  /** Hide one overlay by id. */
  hide(id: string): void;
  /** Reveal the menu root. */
  showMenu(): void;
  /** Hide the menu root. */
  hideMenu(): void;
  /** Prefill hook after an overlay is shown (storage repaint). */
  onRoute?(route: OverlayRoute): void;
}

/** Read the live hash without throwing on shorn windows. */
function liveHash(): string {
  try {
    const href =
      typeof window !== "undefined"
        ? (window as unknown as { location?: { hash?: unknown } }).location
            ?.hash
        : "";
    return typeof href === "string" ? href : "";
  } catch {
    return "";
  }
}

/**
 * Bind the hash router: initial hash applies once, later `hashchange`
 * events re-apply, and every `.panel-close` click closes to the menu
 * synchronously (well inside the 500ms probe budget). Missing
 * builders, throwing lookups, and listener-less shims are no-ops;
 * never throws.
 */
export function bindOverlayRouter(
  doc: unknown,
  handlers: RouterHandlers | null | undefined,
): { refresh(): OverlayRoute | null; stop(): void } {
  const api = {
    refresh(): OverlayRoute | null {
      return null;
    },
    stop(): void {},
  };
  if (typeof doc !== "object" || doc === null) {
    return api;
  }
  if (handlers === null || handlers === undefined) {
    return api;
  }
  const apply = (hash: string): OverlayRoute | null => {
    try {
      const route = routeFromHash(hash);
      if (route === null) {
        return null;
      }
      try {
        handlers.hideMenu();
      } catch {
        // Menu hide best-effort: the overlay show below still lands.
      }
      try {
        handlers.show(route);
      } catch {
        // Show best-effort: the prefill below still lands.
      }
      try {
        if (typeof handlers.onRoute === "function") {
          handlers.onRoute(route);
        }
      } catch {
        // Prefill best-effort: visibility already landed.
      }
      return route;
    } catch {
      return null;
    }
  };
  api.refresh = (): OverlayRoute | null => {
    try {
      return apply(liveHash());
    } catch {
      return null;
    }
  };
  const onHashChange = (): void => {
    try {
      apply(liveHash());
    } catch {
      // Hash routing never breaks the menu.
    }
  };
  try {
    const target = globalThis as unknown as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    if (typeof target.addEventListener === "function") {
      (target.addEventListener as (t: string, fn: () => void) => void).call(
        target,
        "hashchange",
        onHashChange,
      );
      const remover = (): void => {
        try {
          if (typeof target.removeEventListener === "function") {
            (target.removeEventListener as (t: string, fn: () => void) => void).call(
              target,
              "hashchange",
              onHashChange,
            );
          }
        } catch {
          // Detach best-effort only.
        }
      };
      api.stop = remover;
    }
  } catch {
    // Listener-less shims: the initial apply below still lands.
  }
  // Wire every close button once: hide all overlays, show the menu,
  // and clear the hash while preserving the query string. Synchronous
  // DOM writes land far inside the 500ms probe budget.
  try {
    const query = (doc as RouterDoc).querySelectorAll;
    if (typeof query === "function") {
      const found = (query as (sel: string) => unknown).call(
        doc,
        ".panel-close",
      ) as ArrayLike<unknown> | Iterable<unknown> | null;
      const visit = (el: unknown): void => {
        try {
          if (el === null || typeof el !== "object") {
            return;
          }
          const get = (el as { getAttribute?: unknown }).getAttribute;
          if (
            typeof get === "function" &&
            (get as (k: string) => unknown).call(el, "data-router-bound") ===
              "true"
          ) {
            return;
          }
          const set = (el as { setAttribute?: unknown }).setAttribute;
          if (typeof set === "function") {
            (set as (k: string, v: string) => void).call(
              el,
              "data-router-bound",
              "true",
            );
          }
          const listen = (el as { addEventListener?: unknown })
            .addEventListener;
          if (typeof listen !== "function") {
            return;
          }
          (listen as (t: string, fn: () => void) => void).call(
            el,
            "click",
            () => {
              try {
                for (const id of OVERLAY_ROUTE_IDS) {
                  try {
                    handlers.hide(id);
                  } catch {
                    // One stuck overlay never blocks the menu return.
                  }
                }
                try {
                  handlers.hide("end-screen");
                } catch {
                  // End-screen hide best-effort only.
                }
              } catch {
                // Hide-all best-effort: the menu show below still lands.
              }
              try {
                handlers.showMenu();
              } catch {
                // Menu show best-effort: the hash clear below still lands.
              }
              try {
                if (typeof window !== "undefined") {
                  const loc = (window as unknown as { location?: unknown })
                    .location as
                    | {
                        pathname?: unknown;
                        search?: unknown;
                        hash?: unknown;
                      }
                    | undefined;
                  const hist = (window as unknown as { history?: unknown })
                    .history as
                    | { replaceState?: unknown }
                    | undefined;
                  if (
                    typeof loc?.pathname === "string" &&
                    typeof loc?.search === "string" &&
                    typeof hist?.replaceState === "function"
                  ) {
                    (hist.replaceState as (a: null, b: string, c: string) => void).call(
                      hist,
                      null,
                      "",
                      `${loc.pathname}${loc.search}`,
                    );
                  } else if (
                    typeof window !== "undefined" &&
                    (window as unknown as { location?: unknown }).location !==
                      undefined
                  ) {
                    try {
                      ((window as unknown as { location: { hash: string } }).location).hash =
                        "";
                    } catch {
                      // Hash clear best-effort only.
                    }
                  }
                }
              } catch {
                // Hash clear never blocks the menu return.
              }
            },
          );
        } catch {
          // One bad button never blocks the rest.
        }
      };
      if (
        found !== null &&
        typeof found === "object" &&
        typeof (found as ArrayLike<unknown>).length === "number"
      ) {
        const list = found as ArrayLike<unknown>;
        for (let i = 0; i < list.length; i += 1) {
          visit(list[i]);
        }
      } else if (
        found !== null &&
        typeof found === "object" &&
        typeof (found as Iterable<unknown>)[Symbol.iterator] === "function"
      ) {
        for (const el of found as Iterable<unknown>) {
          visit(el);
        }
      }
    }
  } catch {
    // Close wiring best-effort: the hash apply below still lands.
  }
  try {
    api.refresh();
  } catch {
    // Initial hash best-effort only.
  }
  return api;
}
