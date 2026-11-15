// Offline-first PWA tests (issue #159): the safe registration helper
// never throws across absent/unsupported/rejecting worker surfaces, the
// manifest source parses with the required PWA fields, and the worker
// source carries the versioned-cache lifecycle hooks. Mirrors
// test/settings.test.ts (small local fakes, behavior assertions) and
// test/main-order.test.ts (source-as-text via readFileSync, never
// importing DOM-entangled modules).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerServiceWorker,
  serviceWorkerUrl,
  type PwaLogger,
  type PwaNavigator,
} from "../src/pwa";

const PUBLIC_DIR = join(__dirname, "..", "public");

/** Warn-counting logger stand-in. */
function fakeLogger(): PwaLogger & { calls: number } {
  const logger = {
    calls: 0,
    warn(): void {
      logger.calls += 1;
    },
  };
  return logger;
}

/** Navigator stand-in with a controllable register() outcome. */
function fakeNavigator(
  register: (url: string) => Promise<unknown>,
): PwaNavigator {
  return { serviceWorker: { register } };
}

describe("registerServiceWorker", () => {
  it("resolves false (not throw) when the worker surface is absent", async () => {
    const logger = fakeLogger();
    await expect(
      registerServiceWorker({}, logger, "sw.js"),
    ).resolves.toBe(false);
    expect(logger.calls).toBe(1);
  });

  it("resolves false (not throw) when navigator is null", async () => {
    const logger = fakeLogger();
    await expect(registerServiceWorker(null, logger)).resolves.toBe(false);
    expect(logger.calls).toBe(1);
  });

  it("resolves false and warns once when register() rejects (storage disabled)", async () => {
    const logger = fakeLogger();
    const nav = fakeNavigator(() =>
      Promise.reject(new Error("storage disabled")),
    );
    await expect(registerServiceWorker(nav, logger, "sw.js")).resolves.toBe(
      false,
    );
    expect(logger.calls).toBe(1);
  });

  it("resolves true without warning on success", async () => {
    const logger = fakeLogger();
    const seen: string[] = [];
    const nav = fakeNavigator((url: string) => {
      seen.push(url);
      return Promise.resolve(undefined);
    });
    await expect(registerServiceWorker(nav, logger, "sw.js")).resolves.toBe(
      true,
    );
    expect(logger.calls).toBe(0);
    expect(seen).toEqual(["sw.js"]);
  });

  it("resolves true with the default console logger when omitted", async () => {
    const nav = fakeNavigator(() => Promise.resolve(undefined));
    await expect(registerServiceWorker(nav, null, "sw.js")).resolves.toBe(
      true,
    );
  });
});

describe("serviceWorkerUrl", () => {
  it("resolves sw.js against an explicit base", () => {
    expect(serviceWorkerUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000/sw.js",
    );
  });

  it("returns null (not throw) for an unresolvable base", () => {
    expect(serviceWorkerUrl("")).toBeNull();
    expect(serviceWorkerUrl(":::not-a-url::")).toBeNull();
  });
});

describe("manifest.webmanifest source", () => {
  it("parses as JSON with the required PWA fields and an SVG icon", () => {
    const manifest = JSON.parse(
      readFileSync(join(PUBLIC_DIR, "manifest.webmanifest"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest["name"]).toBe("Scrapline");
    expect(manifest["start_url"]).toBe("./");
    expect(manifest["display"]).toBe("standalone");
    expect(Array.isArray(manifest["icons"])).toBe(true);
    const icons = manifest["icons"] as Array<Record<string, unknown>>;
    expect(icons.length).toBeGreaterThanOrEqual(1);
    for (const icon of icons) {
      expect(typeof icon["src"]).toBe("string");
      expect(String(icon["src"]).endsWith(".svg")).toBe(true);
    }
  });

  it("ships an SVG-only icon with no png/jpg references", () => {
    const icon = readFileSync(
      join(PUBLIC_DIR, "icons", "icon.svg"),
      "utf8",
    );
    expect(icon).toMatch(/<svg[\s>]/);
    expect(icon.toLowerCase()).not.toContain(".png");
    expect(icon.toLowerCase()).not.toContain(".jpg");
  });
});

describe("sw.js source", () => {
  function workerSource(): string {
    return readFileSync(join(PUBLIC_DIR, "sw.js"), "utf8");
  }

  it("listens on install/activate/fetch with skipWaiting and clients.claim", () => {
    const source = workerSource();
    expect(source).toMatch(/addEventListener\(\s*["']install["']/);
    expect(source).toMatch(/addEventListener\(\s*["']activate["']/);
    expect(source).toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(source).toContain("skipWaiting");
    expect(source).toContain("clients.claim");
  });

  it("uses a versioned scrapline cache name and warms stable entries", () => {
    const source = workerSource();
    expect(source).toMatch(/scrapline-v\d+/);
    expect(source).toContain("main.js");
    expect(source).toContain("manifest.webmanifest");
    expect(source).toContain("icons/icon.svg");
  });

  it("serves same-origin GETs cache-first with a navigate fallback", () => {
    const source = workerSource();
    expect(source).toContain("cache-first");
    expect(source).toContain('request.mode === "navigate"');
    expect(source).toContain("cache.match");
  });
});
