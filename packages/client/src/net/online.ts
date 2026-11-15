// Honest-mode menu binder: the `Play online` entry point. Null-safe
// binder in the menu/scene.ts shape (fake-doc tolerant, missing elements
// are no-ops, listeners attach once, stop() tears down). On click it
// hides #menu, opens an OnlineClient, publishes the window.__online probe
// mirror on the menu-poll idiom, and paints snapshot-interpolated states
// through the live renderer — never stepping the local World.

import {
  ONLINE_SEND_HZ,
  OnlineClient,
  type OnlineClientOptions,
  type OnlineInput,
  type SocketFactory,
} from "./client";
import type { InterpPlayer } from "./interpolation";

/** Play-online button id (static HTML in packages/client/index.html). */
export const ONLINE_BUTTON_ID = "play-online";
/** Probe-mirror refresh cadence in ms (well inside the 500ms probe). */
export const ONLINE_POLL_MS = 100;

/** Online probe mirror published as window.__online. */
export interface OnlineProbe {
  connected: boolean;
  inputsSent: number;
  snapshotsReceived: number;
  interpDelayMs: number;
  remoteCount: number;
}

/** Minimal renderer surface the online loop paints through. */
export interface OnlineRenderer {
  draw(state: unknown, map?: unknown, camera?: unknown, ...rest: unknown[]): void;
}

/** Creatable client surface (real OnlineClient or a probe stub). */
export interface OnlineClientLike {
  connected: boolean;
  inputsSent: number;
  snapshotsReceived: number;
  connect(view?: string): void;
  sample(nowMs?: number): InterpPlayer[];
  interpDelayMs(): number;
  close(): void;
}

/** Dependencies injected into bindOnline (all optional for probes). */
export interface OnlineBinderDeps {
  /** Socket factory forwarded to the client. */
  createSocket?: SocketFactory;
  /** Millisecond clock forwarded to the client and the render time. */
  now?: () => number;
  /** Input send rate in Hz (60 keeps the >=50/s floor). */
  sendHz?: number;
  /** Live renderer source (polled per frame; null paints nothing). */
  getRenderer?: () => OnlineRenderer | null;
  /** Live view source (read per click; beats the static view). */
  getView?: () => string;
  /** Static view name carried by the hello frame. */
  view?: string;
  /** Per-send intent sampler (wired to localInput in main.ts). */
  sampleInput?: () => OnlineInput;
  /** Explicit room URL (defaults to the same-origin /room endpoint). */
  url?: string;
  /** Client factory (probe seam; defaults to the real OnlineClient). */
  createClient?: (options: OnlineClientOptions) => OnlineClientLike;
  /** Called when a session starts (main.ts pauses the offline loop). */
  onStart?: () => void;
  /** Called when a session stops (menu restore hook). */
  onStop?: () => void;
}

/** Live binder state returned by bindOnline. */
export interface OnlineBinder {
  /** Active session client (null before the first click / after stop). */
  client: OnlineClientLike | null;
  /** True while a session owns the renderer. */
  active: boolean;
  /** Paint one interpolated frame now (also runs per rAF while active). */
  render(nowMs?: number): void;
  /** Refresh the window.__online mirror; returns the published probe. */
  refresh(): OnlineProbe;
  /** Tear down the loop, close the socket, restore the menu. */
  stop(): void;
}

/** Null-safe element lookup on real or fake documents. */
function byId(doc: Document, id: string): unknown {
  try {
    const api = (doc as unknown as { getElementById?: unknown }).getElementById;
    if (typeof api !== "function") {
      return null;
    }
    return (api as (id: string) => unknown).call(doc, id);
  } catch {
    return null;
  }
}

/** Current clock in ms (injected first, Date.now fallback). */
function clockOf(deps: OnlineBinderDeps): () => number {
  if (typeof deps.now === "function") {
    return deps.now;
  }
  return Date.now;
}

/**
 * Shape interpolated rows as a renderer StateLike: players carry the
 * snapshot pose plus neutral sim fields, entity streams stay empty (the
 * honest path renders remotes only; the offline sim owns the rest).
 */
export function onlineStateFor(rows: readonly InterpPlayer[], tick: number): {
  tick: number;
  players: Record<string, unknown>[];
  projectiles: never[];
  pickups: never[];
  props: never[];
} {
  return {
    tick,
    players: rows.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      aim: p.aim,
      hp: p.hp,
      weapon: p.weapon,
      alive: true,
      onGround: true,
      crouching: false,
      jetting: false,
      protectionTicks: 0,
      fuel: 100,
      vx: 0,
      vy: 0,
    })),
    projectiles: [],
    pickups: [],
    props: [],
  };
}

/**
 * Wire the static `#play-online` button: click hides #menu, opens the
 * honest-mode session, publishes window.__online, and owns the rAF
 * render-from-buffer loop until stop(). Missing elements are no-ops;
 * the click listener attaches once; everything is torn down by stop().
 */
export function bindOnline(doc: Document, deps: OnlineBinderDeps = {}): OnlineBinder {
  const now = clockOf(deps);
  const makeClient =
    deps.createClient ?? ((options: OnlineClientOptions) => new OnlineClient(options));
  const binder: OnlineBinder = {
    client: null,
    active: false,
    render: (): void => {},
    refresh: (): OnlineProbe => ({
      connected: false,
      inputsSent: 0,
      snapshotsReceived: 0,
      interpDelayMs: 100,
      remoteCount: 0,
    }),
    stop: (): void => {},
  };

  let stopped = false;
  let interval: unknown = null;
  let rafId = 0;
  let clicked = false;

  const readView = (): string => {
    try {
      if (typeof deps.getView === "function") {
        const live = deps.getView();
        if (typeof live === "string" && live.trim().length > 0) {
          return live.trim();
        }
      }
    } catch {
      // Live view unreadable: the static view stands.
    }
    if (typeof deps.view === "string" && deps.view.trim().length > 0) {
      return deps.view.trim();
    }
    return "dune";
  };

  const publish = (probe: OnlineProbe): void => {
    try {
      if (typeof window !== "undefined") {
        const surface = (window as unknown as Record<string, unknown>)[
          "__online"
        ] as Record<string, unknown> | undefined;
        if (surface !== undefined && surface !== null && typeof surface === "object") {
          Object.assign(surface, probe);
        } else {
          (window as unknown as Record<string, unknown>)["__online"] = { ...probe };
        }
      }
    } catch {
      // Probe mirror best-effort only.
    }
  };

  const refresh = (): OnlineProbe => {
    const client = binder.client;
    const probe: OnlineProbe = {
      connected: client?.connected ?? false,
      inputsSent: client?.inputsSent ?? 0,
      snapshotsReceived: client?.snapshotsReceived ?? 0,
      interpDelayMs: (() => {
        try {
          return client?.interpDelayMs() ?? 100;
        } catch {
          return 100;
        }
      })(),
      remoteCount: (() => {
        try {
          const rows = client?.sample(now()) ?? [];
          return Array.isArray(rows) ? rows.length : 0;
        } catch {
          return 0;
        }
      })(),
    };
    publish(probe);
    return probe;
  };
  binder.refresh = refresh;

  const render = (nowMs?: number): void => {
    const client = binder.client;
    if (client === null || !binder.active) {
      return;
    }
    let renderer: OnlineRenderer | null;
    try {
      renderer = deps.getRenderer?.() ?? null;
    } catch {
      renderer = null;
    }
    if (renderer === null || typeof renderer.draw !== "function") {
      return;
    }
    let stamp = nowMs;
    if (stamp === undefined) {
      try {
        stamp = now();
      } catch {
        stamp = 0;
      }
    }
    if (typeof stamp !== "number" || !Number.isFinite(stamp)) {
      stamp = 0;
    }
    let rows: InterpPlayer[];
    try {
      rows = client.sample(stamp) ?? [];
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows)) {
      rows = [];
    }
    try {
      renderer.draw(onlineStateFor(rows, 0));
    } catch {
      // Renderer faults never kill the session; the next frame retries.
    }
  };
  binder.render = render;

  const loop = (): void => {
    if (stopped || !binder.active) {
      return;
    }
    try {
      render();
    } catch {
      // Frame faults never break the loop.
    }
    try {
      const raf = (
        window as unknown as {
          requestAnimationFrame?: (cb: () => void) => number;
        }
      ).requestAnimationFrame;
      if (typeof raf === "function") {
        rafId = raf.call(window, loop);
      }
    } catch {
      // No rAF (headless import): the poll interval still mirrors state.
    }
  };

  const onClick = (): void => {
    if (clicked || stopped) {
      return;
    }
    clicked = true;
    try {
      const menu = byId(doc, "menu") as { style?: Record<string, unknown> } | null;
      if (menu !== null && typeof menu === "object" && menu.style !== undefined) {
        (menu.style as Record<string, unknown>)["display"] = "none";
      }
    } catch {
      // Menu hide best-effort: the session still opens.
    }
    const view = readView();
    let client: OnlineClientLike | null;
    try {
      client = makeClient({
        createSocket: deps.createSocket,
        now: deps.now,
        sendHz: deps.sendHz ?? ONLINE_SEND_HZ,
        sampleInput: deps.sampleInput,
        view,
        url: deps.url,
      });
    } catch {
      client = null;
    }
    if (client === null) {
      clicked = false;
      return;
    }
    binder.client = client;
    binder.active = true;
    try {
      client.connect(view);
    } catch {
      // Connect faults surface through the mirror; the loop still runs.
    }
    try {
      deps.onStart?.();
    } catch {
      // Offline-loop pause best-effort only.
    }
    refresh();
    loop();
  };

  try {
    const button = byId(doc, ONLINE_BUTTON_ID) as {
      addEventListener?: (name: string, cb: () => void) => void;
    } | null;
    if (
      button !== null &&
      typeof button === "object" &&
      typeof button.addEventListener === "function"
    ) {
      button.addEventListener("click", onClick);
    }
  } catch {
    // Button missing/shorn: the binder still answers render/refresh/stop.
  }

  const canPoll =
    typeof window !== "undefined" && typeof doc !== "undefined" && doc !== null;
  if (canPoll) {
    try {
      const schedule = (
        window as unknown as { setInterval?: typeof setInterval }
      ).setInterval;
      if (typeof schedule === "function") {
        interval = schedule.call(window, () => {
          if (stopped) {
            return;
          }
          refresh();
        }, ONLINE_POLL_MS);
        try {
          const timer = interval as { unref?: () => void };
          if (typeof timer.unref === "function") {
            timer.unref();
          }
        } catch {
          // Browser timers lack unref: harmless.
        }
      }
    } catch {
      interval = null;
    }
    try {
      refresh();
    } catch {
      // Initial mirror best-effort only.
    }
  }

  binder.stop = (): void => {
    stopped = true;
    binder.active = false;
    try {
      if (interval !== null && typeof clearInterval === "function") {
        clearInterval(interval as Parameters<typeof clearInterval>[0]);
      }
    } catch {
      // Timer teardown best-effort only.
    }
    try {
      if (rafId !== 0 && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
    } catch {
      // rAF teardown best-effort only.
    }
    interval = null;
    rafId = 0;
    const client = binder.client;
    binder.client = null;
    if (client !== null) {
      try {
        client.close();
      } catch {
        // Socket teardown best-effort only.
      }
    }
    try {
      const menuEl = byId(doc, "menu") as { style?: Record<string, unknown> } | null;
      if (menuEl !== null && typeof menuEl === "object" && menuEl.style !== undefined) {
        (menuEl.style as Record<string, unknown>)["display"] = "";
      }
    } catch {
      // Menu restore best-effort only.
    }
    try {
      deps.onStop?.();
    } catch {
      // Restore hook best-effort only.
    }
    try {
      refresh();
    } catch {
      // Final mirror best-effort only.
    }
  };

  return binder;
}
