// Controller-connect toast tests: text contract plus the null-safe
// fake-doc binder (insert, fade scheduling, removal, no-throw).
// Fake elements only (no jsdom), mirroring the feed.test.ts style.
import { describe, expect, it } from "vitest";
import {
  buildToast,
  showToast,
  TOAST_FADE_MS,
  TOAST_HOLD_MS,
  TOAST_TEXT,
  type ToastHandles,
} from "../src/ui/toast";

/** Minimal fake element with attrs, a style bag, and children. */
interface FakeEl {
  tag: string;
  attrs: Map<string, string>;
  style: Record<string, string>;
  textContent: string;
  children: FakeEl[];
  classList: { add(c: string): void; remove(c: string): void };
  ownerDocument: FakeDoc;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(kid: FakeEl): FakeEl;
  removeChild(kid: FakeEl): void;
}

/** Minimal fake document with a builder and capturing timers. */
interface FakeDoc {
  timers: Array<{ fn: () => void; ms: number }>;
  nodes: Map<string, FakeEl>;
  createElement(tag: string): FakeEl;
  getElementById(id: string): FakeEl | null;
  defaultView: { setTimeout(fn: () => void, ms: number): number };
}

function makeEl(doc: FakeDoc, tag: string): FakeEl {
  const el: FakeEl = {
    tag,
    attrs: new Map<string, string>(),
    style: {},
    textContent: "",
    children: [],
    classList: {
      add: (c: string): void => {
        const raw = el.attrs.get("class") ?? "";
        const parts = raw.split(" ").filter((part) => part !== "");
        if (!parts.includes(c)) {
          parts.push(c);
        }
        el.attrs.set("class", parts.join(" "));
      },
      remove: (c: string): void => {
        const raw = el.attrs.get("class") ?? "";
        const parts = raw.split(" ").filter((part) => part !== "" && part !== c);
        el.attrs.set("class", parts.join(" "));
      },
    },
    ownerDocument: doc,
    setAttribute: (k: string, v: string): void => {
      el.attrs.set(k, v);
    },
    getAttribute: (k: string): string | null => el.attrs.get(k) ?? null,
    appendChild: (kid: FakeEl): FakeEl => {
      el.children.push(kid);
      return kid;
    },
    removeChild: (kid: FakeEl): void => {
      const index = el.children.indexOf(kid);
      if (index >= 0) {
        el.children.splice(index, 1);
      }
    },
  };
  return el;
}

function makeDoc(): FakeDoc {
  const doc: FakeDoc = {
    timers: [],
    nodes: new Map<string, FakeEl>(),
    createElement: (tag: string): FakeEl => makeEl(doc, tag),
    getElementById: (id: string): FakeEl | null => doc.nodes.get(id) ?? null,
    defaultView: {
      setTimeout: (fn: () => void, ms: number): number => {
        doc.timers.push({ fn, ms });
        return doc.timers.length;
      },
    },
  };
  return doc;
}

/** Fake `#toast` container registered on the doc, returned with handles. */
function makeToast(doc: FakeDoc): { handles: ToastHandles; box: FakeEl } {
  const box = makeEl(doc, "div");
  doc.nodes.set("toast", box);
  return { handles: buildToast(doc), box };
}

/** Run every captured timer in scheduled order. */
function flushTimers(doc: FakeDoc): void {
  const pending = doc.timers.splice(0, doc.timers.length);
  for (const timer of pending) {
    timer.fn();
  }
}

describe("toast text contract", () => {
  it("names the controller connection for the probe substring", () => {
    expect(TOAST_TEXT).toMatch(/controller connected/i);
  });

  it("holds visible for 4s with a shorter fade tail", () => {
    expect(TOAST_HOLD_MS).toBe(4000);
    expect(TOAST_FADE_MS).toBeLessThan(TOAST_HOLD_MS);
  });
});

describe("showToast binder", () => {
  it("inserts the toast text into the #toast node", () => {
    const doc = makeDoc();
    const { handles, box } = makeToast(doc);
    showToast(handles);
    expect(box.children).toHaveLength(1);
    expect(box.children[0]?.textContent).toMatch(/controller connected/i);
  });

  it("fades then removes the entry on the owner-document timers", () => {
    const doc = makeDoc();
    const { handles, box } = makeToast(doc);
    showToast(handles);
    const node = box.children[0];
    expect(node).toBeDefined();
    flushTimers(doc);
    expect(node?.getAttribute("class")).toContain("fade");
    expect(box.children).toHaveLength(0);
  });

  it("is a no-op without throwing when the container is missing", () => {
    const doc = makeDoc();
    expect(() => showToast(buildToast(doc))).not.toThrow();
    expect(() => showToast(null)).not.toThrow();
    expect(() => showToast(undefined)).not.toThrow();
    expect(() => buildToast(null)).not.toThrow();
  });
});
