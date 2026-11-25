// Connecting / error card tests (issue #350, SC-10): the show/hide
// state machine plus the Cancel/Retry binder. Fake-doc style mirroring
// locker.test.ts (no jsdom).
import { describe, expect, it } from "vitest";
import {
  bindNetStatus,
  hideNetStatus,
  NET_CANCEL_ID,
  NET_HINT_ID,
  NET_RETRY_ID,
  NET_STATUS_ID,
  NET_TITLE_ID,
  showNetStatus,
} from "../src/net/status";

/** Minimal fake element with attrs, style, class set, and listeners. */
interface FakeEl {
  id: string;
  textContent: string | null;
  style: Record<string, string>;
  classes: Set<string>;
  attrs: Map<string, string>;
  listeners: Map<string, Array<() => void>>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  addEventListener(type: string, listener: () => void): void;
  fire(type: string): void;
}

function makeEl(id = ""): FakeEl {
  const el: FakeEl = {
    id,
    textContent: "",
    style: {},
    classes: new Set<string>(),
    attrs: new Map<string, string>(),
    listeners: new Map<string, Array<() => void>>(),
    setAttribute(k: string, v: string): void {
      el.attrs.set(k, v);
      if (k === "id") {
        el.id = v;
      }
    },
    getAttribute(k: string): string | null {
      if (k === "id") {
        return el.id === "" ? null : el.id;
      }
      return el.attrs.has(k) ? (el.attrs.get(k) as string) : null;
    },
    addEventListener(type: string, listener: () => void): void {
      const list = el.listeners.get(type) ?? [];
      list.push(listener);
      el.listeners.set(type, list);
    },
    fire(type: string): void {
      for (const listener of el.listeners.get(type) ?? []) {
        listener();
      }
    },
  };
  if (id !== "") {
    el.attrs.set("id", id);
  }
  return el;
}

/** Fake document with classList-backed elements. */
interface FakeDoc {
  elements: Map<string, FakeEl>;
  getElementById(id: string): FakeEl | null;
}

function makeDoc(): FakeDoc {
  const elements = new Map<string, FakeEl>();
  for (const id of [
    NET_STATUS_ID,
    NET_TITLE_ID,
    NET_HINT_ID,
    NET_CANCEL_ID,
    NET_RETRY_ID,
  ]) {
    elements.set(id, makeEl(id));
  }
  const doc: FakeDoc = {
    elements,
    getElementById: (id: string): FakeEl | null => elements.get(id) ?? null,
  };
  // classList surface for the state-hook classes.
  for (const el of elements.values()) {
    (el as unknown as Record<string, unknown>)["classList"] = {
      add: (name: string): void => {
        el.classes.add(name);
      },
      remove: (name: string): void => {
        el.classes.delete(name);
      },
      contains: (name: string): boolean => el.classes.has(name),
    };
  }
  return doc;
}

describe("showNetStatus", () => {
  it("shows the connecting card with Cancel and no Retry", () => {
    const doc = makeDoc();
    expect(showNetStatus(doc, "connecting")).toBe("connecting");
    const card = doc.getElementById(NET_STATUS_ID) as FakeEl;
    expect(card.style["display"]).toBe("");
    expect(card.getAttribute("data-state")).toBe("connecting");
    expect((doc.getElementById(NET_TITLE_ID) as FakeEl).textContent).toMatch(
      /Connecting/,
    );
    expect((doc.getElementById(NET_RETRY_ID) as FakeEl).style["display"]).toBe(
      "none",
    );
    expect((doc.getElementById(NET_CANCEL_ID) as FakeEl).style["display"]).toBe(
      "",
    );
    expect(card.classes.has("net-connecting")).toBe(true);
  });

  it("shows the error card with Retry and the detail", () => {
    const doc = makeDoc();
    expect(showNetStatus(doc, "error", "room full")).toBe("error");
    const card = doc.getElementById(NET_STATUS_ID) as FakeEl;
    expect(card.getAttribute("data-state")).toBe("error");
    expect((doc.getElementById(NET_TITLE_ID) as FakeEl).textContent).toMatch(
      /Connection failed/,
    );
    expect((doc.getElementById(NET_HINT_ID) as FakeEl).textContent).toBe(
      "room full",
    );
    expect((doc.getElementById(NET_RETRY_ID) as FakeEl).style["display"]).toBe(
      "",
    );
    expect(card.classes.has("net-error")).toBe(true);
  });

  it("no-ops on missing cards and normalizes garbage states", () => {
    const doc: FakeDoc = {
      elements: new Map(),
      getElementById: (): FakeEl | null => null,
    };
    expect(showNetStatus(doc, "error")).toBe("error");
    expect(showNetStatus(null, "banana")).toBe("connecting");
    expect(() => hideNetStatus(null)).not.toThrow();
  });

  it("hides the card", () => {
    const doc = makeDoc();
    showNetStatus(doc, "connecting");
    hideNetStatus(doc);
    expect(
      (doc.getElementById(NET_STATUS_ID) as FakeEl).style["display"],
    ).toBe("none");
  });
});

describe("bindNetStatus", () => {
  it("hides on Cancel and refires the retry hook on Retry", () => {
    const doc = makeDoc();
    let retries = 0;
    const binder = bindNetStatus(doc as unknown as Document, () => {
      retries += 1;
    });
    binder.connecting();
    (doc.getElementById(NET_CANCEL_ID) as FakeEl).fire("click");
    expect(
      (doc.getElementById(NET_STATUS_ID) as FakeEl).style["display"],
    ).toBe("none");
    binder.error("boom");
    (doc.getElementById(NET_RETRY_ID) as FakeEl).fire("click");
    expect(retries).toBe(1);
    expect(
      (doc.getElementById(NET_STATUS_ID) as FakeEl).style["display"],
    ).toBe("none");
    expect(() => binder.stop()).not.toThrow();
  });

  it("binds once and no-ops without a retry hook", () => {
    const doc = makeDoc();
    const first = bindNetStatus(doc as unknown as Document);
    const second = bindNetStatus(doc as unknown as Document);
    void second;
    first.error("boom");
    expect(() =>
      (doc.getElementById(NET_RETRY_ID) as FakeEl).fire("click"),
    ).not.toThrow();
    expect(
      (doc.getElementById(NET_STATUS_ID) as FakeEl).style["display"],
    ).toBe("none");
  });
});
