// Controller-connect toast (issue #158). Pure model (text constant)
// plus a thin timed DOM binder: one bottom-center entry that holds
// TOAST_HOLD_MS, fades over TOAST_FADE_MS, then leaves the DOM.
// DOM-free helpers stay unit-testable under node; the binder degrades
// to no-ops on fake docs without builders and never throws.

/** Toast container id (mirrors the `#killfeed` overlay handle grab). */
export const TOAST_ID = "toast";
/** Toast entry class (carries the visible-entry styling). */
export const TOAST_ENTRY_CLASS = "toast-entry";
/** Toast text: the probe substring for a freshly detected controller. */
export const TOAST_TEXT = "Controller connected";
/** Toast hold in ms: entries stay fully visible this long, then fade. */
export const TOAST_HOLD_MS = 4000;
/** Toast fade in ms: fade-to-transparent window before DOM removal. */
export const TOAST_FADE_MS = 500;

/** Live toast handles; idempotent and safe before any toast shows. */
export interface ToastHandles {
  toast: HTMLElement | null;
}

/** Grab one element by id; non-element lookups read as missing. */
function byId(doc: unknown, id: string): HTMLElement | null {
  try {
    const target = doc as { getElementById?: unknown };
    if (typeof target.getElementById !== "function") {
      return null;
    }
    const el = (target.getElementById as (id: string) => unknown).call(doc, id);
    return el !== null && typeof el === "object" ? (el as HTMLElement) : null;
  } catch {
    return null;
  }
}

/** Grab the toast handles; idempotent and safe before match start. */
export function buildToast(doc: unknown): ToastHandles {
  return { toast: byId(doc, TOAST_ID) };
}

/** Read one attribute; null when the node carries no attributes. */
function readAttr(el: unknown, name: string): string | null {
  try {
    const target = el as { getAttribute?: unknown };
    if (typeof target.getAttribute !== "function") {
      return null;
    }
    const value = (target.getAttribute as (id: string) => unknown).call(el, name);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** Write one attribute; attribute-less fakes are skipped silently. */
function writeAttr(el: unknown, name: string, value: string): void {
  try {
    const target = el as { setAttribute?: unknown };
    if (typeof target.setAttribute === "function") {
      (target.setAttribute as (id: string, v: string) => void).call(el, name, value);
    }
  } catch {
    // Attribute-less fakes: the text below still lands.
  }
  try {
    const bag = el as { [key: string]: unknown };
    if (name === "class" && typeof bag.className === "string") {
      bag.className = value;
    }
  } catch {
    // Shape-less fakes: nothing more to mirror.
  }
}

/** Write the text content through every surface the fake may offer. */
function writeText(el: unknown, text: string): void {
  try {
    const bag = el as { textContent?: unknown };
    if (typeof bag.textContent === "string" || bag.textContent === null || bag.textContent === undefined) {
      bag.textContent = text;
      return;
    }
  } catch {
    // Fall through to the innerText mirror below.
  }
  try {
    (el as { innerText?: unknown }).innerText = text;
  } catch {
    // Text-less fakes: the entry still appends, just silently.
  }
}

/** Append a child; returns false on builder-less fakes (never throws). */
function appendKid(parent: unknown, child: unknown): boolean {
  try {
    const target = parent as { appendChild?: unknown };
    if (typeof target.appendChild === "function") {
      (target.appendChild as (kid: unknown) => void).call(parent, child);
      return true;
    }
  } catch {
    // Hostile shims fall through to the false below.
  }
  return false;
}

/** Add one class token without dropping the existing class list. */
function addClass(el: unknown, token: string): void {
  try {
    const list = (el as { classList?: unknown }).classList as
      | { add?: unknown }
      | undefined;
    if (list !== undefined && typeof list.add === "function") {
      (list.add as (c: string) => void).call(list, token);
    }
  } catch {
    // Class-list-less fakes: the attribute path below still lands.
  }
  try {
    const current = readAttr(el, "class") ?? "";
    const parts = current.split(" ").filter((part) => part !== "");
    if (!parts.includes(token)) {
      parts.push(token);
      writeAttr(el, "class", parts.join(" "));
    }
  } catch {
    // Attribute-less fakes: the classList above may already have it.
  }
}

/** Set opacity through the style bag plus the style-attribute mirror. */
function setOpacity(el: unknown, value: string): void {
  try {
    const style = (el as { style?: unknown }).style;
    if (typeof style === "object" && style !== null) {
      (style as Record<string, unknown>)["opacity"] = value;
    }
  } catch {
    // Style-less fakes: the fade class still carries the state.
  }
}

/** Schedule a callback on the container's owner-document timers (never throws). */
function later(container: unknown, ms: number, fn: () => void): void {
  try {
    const owner = (container as { ownerDocument?: unknown }).ownerDocument as
      | { defaultView?: unknown }
      | undefined;
    const view = owner?.defaultView as { setTimeout?: unknown } | undefined;
    const timer = view?.setTimeout;
    if (typeof timer === "function") {
      (timer as (fn: () => void, ms: number) => void).call(view, fn, ms);
    }
  } catch {
    // Fake docs in unit tests may lack timers: the entry simply stays.
  }
}

/**
 * Show one toast entry: a `.toast-entry` div carrying the text,
 * appended to `#toast`; it fades at TOAST_HOLD_MS - TOAST_FADE_MS and
 * leaves the DOM at TOAST_HOLD_MS. Missing containers are no-ops;
 * hostile shims never throw.
 */
export function showToast(
  handles: ToastHandles | null | undefined,
  text: string = TOAST_TEXT,
): void {
  if (handles === null || handles === undefined) {
    return;
  }
  const container = handles.toast ?? null;
  if (container === null) {
    return;
  }
  let node: unknown;
  try {
    const owner = (container as { ownerDocument?: unknown }).ownerDocument as
      | { createElement?: unknown }
      | undefined;
    const create =
      owner !== undefined && typeof owner.createElement === "function"
        ? (owner.createElement as (tag: string) => unknown).bind(owner)
        : null;
    if (create === null) {
      return;
    }
    node = create("div");
  } catch {
    return;
  }
  writeAttr(node, "class", TOAST_ENTRY_CLASS);
  writeText(node, text);
  if (!appendKid(container, node)) {
    return;
  }
  const held = node;
  later(container, TOAST_HOLD_MS - TOAST_FADE_MS, () => {
    addClass(held, "fade");
    setOpacity(held, "0");
  });
  later(container, TOAST_HOLD_MS, () => {
    try {
      (container as { removeChild(kid: unknown): void }).removeChild(held);
    } catch {
      // Already gone: nothing left to remove.
    }
  });
}
