// Connecting / error card (issue #350, SC-10): the small centred card
// behind the online handshake, room join, and reconnect states. Pure
// helpers stay DOM-free and unit-testable under node (the tips.ts
// idiom); the binder degrades to no-ops on fake docs and never throws.

/** Connecting card root id (child of #stage, hidden by default). */
export const NET_STATUS_ID = "net-status";
/** Card title id (Connecting… vs Connection failed). */
export const NET_TITLE_ID = "net-title";
/** Card hint id (room line or the error detail). */
export const NET_HINT_ID = "net-hint";
/** Cancel button id (hides the card). */
export const NET_CANCEL_ID = "net-cancel";
/** Retry button id (visible in the error state only). */
export const NET_RETRY_ID = "net-retry";

/** Card state: connecting shows the cancel path, error the retry path. */
export type NetStatusState = "connecting" | "error";

/** Null-safe id lookup without throwing on hostile shims. */
function byId(doc: unknown, id: string): unknown {
  try {
    const lookup = (doc as { getElementById?: unknown }).getElementById;
    if (typeof lookup === "function") {
      return (lookup as (key: string) => unknown).call(doc, id);
    }
  } catch {
    // Lookup-less docs: the caller treats the miss as absent.
  }
  return null;
}

/** Assign text on an unknown handle when it carries textContent. */
function setText(el: unknown, text: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  try {
    if ("textContent" in el) {
      (el as { textContent: unknown }).textContent = text;
    }
  } catch {
    // Text-less shims: the state attribute below still lands.
  }
}

/** Write one attribute on an unknown handle (best-effort). */
function setAttr(el: unknown, name: string, value: string): void {
  try {
    if (typeof el !== "object" || el === null) {
      return;
    }
    const setter = (el as { setAttribute?: unknown }).setAttribute;
    if (typeof setter === "function") {
      (setter as (key: string, val: string) => void).call(el, name, value);
    }
  } catch {
    // Attribute-less fakes: the display write below still lands.
  }
}

/** Assign display on an unknown handle when it carries a style bag. */
function setDisplay(el: unknown, display: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      (style as Record<string, unknown>)["display"] = display;
    }
  } catch {
    // Style-less shims: the state attribute above still lands.
  }
}

/** Class-list narrow for the state hook (null when shorn). */
function setStateClass(card: unknown, state: NetStatusState): void {
  try {
    if (typeof card !== "object" || card === null) {
      return;
    }
    const list = (card as { classList?: unknown }).classList as
      | { add?: unknown; remove?: unknown }
      | undefined;
    if (list === undefined || list === null) {
      return;
    }
    if (typeof list.add === "function" && typeof list.remove === "function") {
      const add = list.add as (name: string) => void;
      const remove = list.remove as (name: string) => void;
      if (state === "error") {
        add.call(list, "net-error");
        remove.call(list, "net-connecting");
      } else {
        add.call(list, "net-connecting");
        remove.call(list, "net-error");
      }
    }
  } catch {
    // Class-less shims: the data-state attribute below still lands.
  }
}

/**
 * Show the card in one state: `connecting` reads the Joining-room
 * title with Cancel visible, `error` reads the failure title with
 * Retry visible and the detail in the hint line. Missing elements are
 * no-ops; never throws.
 */
export function showNetStatus(
  doc: unknown,
  state: NetStatusState = "connecting",
  detail?: unknown,
): NetStatusState {
  const mode: NetStatusState = state === "error" ? "error" : "connecting";
  try {
    const card = byId(doc, NET_STATUS_ID);
    if (card === null || typeof card !== "object") {
      return mode;
    }
    setDisplay(card, "");
    setAttr(card, "data-state", mode);
    setStateClass(card, mode);
    const title = byId(doc, NET_TITLE_ID);
    setText(
      title,
      mode === "error" ? "Connection failed" : "Connecting…",
    );
    const hint = byId(doc, NET_HINT_ID);
    if (mode === "error") {
      const text =
        typeof detail === "string" && detail.trim() !== ""
          ? detail.trim()
          : "The room did not answer. Retry or keep playing offline.";
      setText(hint, text);
    } else {
      setText(hint, "Joining room…");
    }
    setDisplay(byId(doc, NET_RETRY_ID), mode === "error" ? "" : "none");
    setDisplay(byId(doc, NET_CANCEL_ID), "");
  } catch {
    // Card optional: the toast path still reports status.
  }
  return mode;
}

/** Hide the card (Cancel path and session handoff). Never throws. */
export function hideNetStatus(doc: unknown): void {
  try {
    setDisplay(byId(doc, NET_STATUS_ID), "none");
  } catch {
    // Card optional: hiding never gates the session.
  }
}

/** Live binder state returned by bindNetStatus. */
export interface NetStatusBinder {
  /** Show the connecting card; returns the applied state. */
  connecting(): NetStatusState;
  /** Show the error card with an optional detail; returns the state. */
  error(detail?: unknown): NetStatusState;
  /** Hide the card. */
  hide(): void;
  /** Detach nothing (listeners attach once); keeps the tips.ts shape. */
  stop(): void;
}

/** Narrow an unknown handle to the click-listener surface. */
function asClickable(el: unknown): { addEventListener(type: string, fn: () => void): void } | null {
  if (typeof el !== "object" || el === null) {
    return null;
  }
  const listen = (el as { addEventListener?: unknown }).addEventListener;
  if (typeof listen !== "function") {
    return null;
  }
  return el as { addEventListener(type: string, fn: () => void): void };
}

/** Guard a one-time listener marker on the handle. */
function claimOnce(el: object, marker: string): boolean {
  try {
    const get = (el as { getAttribute?: unknown }).getAttribute;
    if (typeof get === "function") {
      if (
        (get as (name: string) => unknown).call(el, marker) === "true"
      ) {
        return false;
      }
    }
    const set = (el as { setAttribute?: unknown }).setAttribute;
    if (typeof set === "function") {
      (set as (name: string, value: string) => void).call(el, marker, "true");
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Wire the connecting card: Cancel hides it, Retry hides it and
 * re-fires the retry hook (the online join by default). Missing
 * elements are no-ops; listeners attach once. Never throws.
 */
export function bindNetStatus(
  doc: unknown,
  onRetry?: (() => void) | null,
): NetStatusBinder {
  const binder: NetStatusBinder = {
    connecting: (): NetStatusState => showNetStatus(doc, "connecting"),
    error: (detail?: unknown): NetStatusState =>
      showNetStatus(doc, "error", detail),
    hide: (): void => hideNetStatus(doc),
    stop: (): void => {},
  };
  try {
    const cancel = byId(doc, NET_CANCEL_ID);
    if (cancel !== null && typeof cancel === "object") {
      if (claimOnce(cancel, "data-net-bound")) {
        asClickable(cancel)?.addEventListener("click", () => {
          hideNetStatus(doc);
        });
      }
    }
    const retry = byId(doc, NET_RETRY_ID);
    if (retry !== null && typeof retry === "object") {
      if (claimOnce(retry, "data-net-bound")) {
        asClickable(retry)?.addEventListener("click", () => {
          hideNetStatus(doc);
          try {
            if (typeof onRetry === "function") {
              onRetry();
            }
          } catch {
            // Retry hook best-effort: the card already hid.
          }
        });
      }
    }
  } catch {
    // Buttons optional: the binder methods still drive the card.
  }
  return binder;
}
