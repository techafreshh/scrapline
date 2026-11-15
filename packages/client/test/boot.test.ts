// Noscript fallback tests (issue #160): the WebGL probe resolves only
// on a real canvas context, the show/hide helpers toggle display without
// throwing on shorn DOM, and source-text guards pin the index.html id plus
// the dual main.ts call sites. Mirrors test/pwa.test.ts (small local
// fakes, behavior assertions) and test/main-order.test.ts (source as text,
// never importing DOM-entangled modules).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOSCRIPT_ID,
  hasWebGLSupport,
  hideNoscript,
  showNoscript,
  syncNoscriptFallback,
  type NoscriptDocument,
} from "../src/boot";

const CLIENT_DIR = join(__dirname, "..");

/** Fake style bag capturing display writes. */
function fakeElement(): { style: { display: string } } {
  return { style: { display: "" } };
}

/** Fake document serving one element (or null) for NOSCRIPT_ID. */
function fakeDoc(el: unknown): NoscriptDocument {
  return {
    getElementById(id: string): unknown {
      return id === NOSCRIPT_ID ? el : null;
    },
  };
}

/** Probe canvas stub: getContext returns per-kind values or throws. */
function fakeFactory(
  handler: (kind: string) => unknown,
): () => { getContext(kind: string): unknown } {
  return () => ({
    getContext: (kind: string): unknown => handler(kind),
  });
}

describe("hasWebGLSupport", () => {
  it("returns true when webgl2 context creation succeeds", () => {
    expect(hasWebGLSupport(fakeFactory(() => ({})))).toBe(true);
  });

  it("falls back to webgl when webgl2 is null", () => {
    expect(
      hasWebGLSupport(
        fakeFactory((kind) => (kind === "webgl2" ? null : {})),
      ),
    ).toBe(true);
  });

  it("returns false when both probes return null", () => {
    expect(hasWebGLSupport(fakeFactory(() => null))).toBe(false);
  });

  it("returns false when getContext throws", () => {
    expect(
      hasWebGLSupport(
        fakeFactory(() => {
          throw new Error("blocked");
        }),
      ),
    ).toBe(false);
  });

  it("returns false when the factory throws", () => {
    expect(
      hasWebGLSupport(() => {
        throw new Error("no canvas");
      }),
    ).toBe(false);
  });

  it("returns false with a shorn canvas (no getContext)", () => {
    expect(hasWebGLSupport(() => ({}) as never)).toBe(false);
  });

  it("returns false with no DOM (no factory under node)", () => {
    expect(hasWebGLSupport()).toBe(false);
  });
});

describe("hideNoscript / showNoscript / syncNoscriptFallback", () => {
  it("hides with display:none and restores with display:\"\"", () => {
    const el = fakeElement();
    const doc = fakeDoc(el);
    hideNoscript(doc);
    expect(el.style.display).toBe("none");
    showNoscript(doc);
    expect(el.style.display).toBe("");
  });

  it("syncs visibility: true shows, false hides", () => {
    const el = fakeElement();
    const doc = fakeDoc(el);
    syncNoscriptFallback(doc, false);
    expect(el.style.display).toBe("none");
    syncNoscriptFallback(doc, true);
    expect(el.style.display).toBe("");
  });

  it("no-ops (not throw) on a missing element", () => {
    const doc = fakeDoc(null);
    expect(() => hideNoscript(doc)).not.toThrow();
    expect(() => showNoscript(doc)).not.toThrow();
    expect(() => syncNoscriptFallback(doc, true)).not.toThrow();
    expect(() => syncNoscriptFallback(doc, false)).not.toThrow();
  });

  it("no-ops (not throw) on null docs and throwing docs", () => {
    expect(() => hideNoscript(null)).not.toThrow();
    expect(() => showNoscript(undefined)).not.toThrow();
    expect(() => syncNoscriptFallback(null, true)).not.toThrow();
    const throwing: NoscriptDocument = {
      getElementById(): unknown {
        throw new Error("shorn");
      },
    };
    expect(() => hideNoscript(throwing)).not.toThrow();
    expect(() => showNoscript(throwing)).not.toThrow();
    expect(() => syncNoscriptFallback(throwing, false)).not.toThrow();
  });
});

describe("index.html fallback source", () => {
  function html(): string {
    return readFileSync(join(CLIENT_DIR, "index.html"), "utf8");
  }

  it("marks the fallback paragraph with id=\"noscript\"", () => {
    expect(html()).toContain('id="noscript"');
  });

  it("keeps the exact fallback text", () => {
    expect(html()).toContain("JavaScript is disabled");
  });
});

describe("main.ts boot wiring source", () => {
  function mainSource(): string {
    return readFileSync(join(CLIENT_DIR, "src", "main.ts"), "utf8");
  }

  it("imports the boot helpers next to the pwa import", () => {
    const source = mainSource();
    expect(source).toContain('from "./boot"');
    expect(source).toContain("hideNoscript");
    expect(source).toContain("syncNoscriptFallback");
    expect(source).toContain("hasWebGLSupport");
  });

  it("hides synchronously at boot top before the renderer settle", () => {
    const source = mainSource();
    const hideIndex = source.indexOf("hideNoscript(document)");
    const settleIndex = source.indexOf("Promise.allSettled([createRenderer(canvas)");
    expect(hideIndex).toBeGreaterThanOrEqual(0);
    expect(settleIndex).toBeGreaterThanOrEqual(0);
    expect(hideIndex).toBeLessThan(settleIndex);
  });

  it("re-syncs inside the renderer-settle continuation on renderer mode", () => {
    const source = mainSource();
    const settleIndex = source.indexOf("Promise.allSettled([createRenderer(canvas)");
    const syncIndex = source.indexOf("syncNoscriptFallback(document");
    expect(syncIndex).toBeGreaterThan(settleIndex);
    const tail = source.slice(settleIndex);
    expect(tail).toContain("hasWebGLSupport()");
    expect(tail).toContain('mode === "pixi"');
    expect(tail).toContain("revealCanvas()");
  });
});
