// Layer-discipline wiring regression test (issue #313): main.ts routes
// overlay visibility through the layers module, rebuilds the standings
// container on end screens, and destroys (never hides) it on Menu return.
// Reads main.ts as text only (never imports it — load-time DOM side
// effects), mirroring main-cache.test.ts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MAIN_TS = join(__dirname, "..", "src", "main.ts");

function mainSource(): string {
  return readFileSync(MAIN_TS, "utf8");
}

/** Source slice between two anchor markers (end anchor exclusive). */
function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from === -1 ? 0 : from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("main.ts layer wiring (issue #313)", () => {
  it("imports the layers module for exclusivity plus destruction", () => {
    const source = mainSource();
    expect(source).toContain('from "./ui/layers"');
    expect(source).toContain("destroyStandings");
    expect(source).toContain("ensureStandings");
    expect(source).toContain("OVERLAY_IDS");
    expect(source).toContain("showOnly");
  });

  it("reveals overlays exclusively through `showOnly`", () => {
    const source = mainSource();
    const body = sliceBetween(
      source,
      "function showOverlay(id: string): void {",
      "function hideOverlay(id: string): void {",
    );
    expect(body).toContain("showOnly(document, id)");
  });

  it("routes the setup/settings/howto opens through exclusivity", () => {
    const source = mainSource();
    const playWiring = sliceBetween(
      source,
      "const playButton = document.getElementById",
      "const settingsOpen = document.getElementById",
    );
    expect(playWiring).toContain('showOnly(document, "setup")');
    const settingsWiring = sliceBetween(
      source,
      "const settingsOpen = document.getElementById",
      "const howtoOpen = document.getElementById",
    );
    expect(settingsWiring).toContain('showOnly(document, "settings")');
    const howtoWiring = sliceBetween(
      source,
      "const howtoOpen = document.getElementById",
      "const restartButton = document.getElementById",
    );
    expect(howtoWiring).toContain('showOverlay("howto")');
  });

  it("hides every overlay id (not just #end-screen) in `startMatch`", () => {
    const source = mainSource();
    const body = sliceBetween(
      source,
      "function startMatch(",
      "const storage = browserStorage();",
    );
    expect(body).toContain("OVERLAY_IDS");
    expect(body).toContain("hideOverlay(overlayId)");
    expect(body).toContain("#end-screen");
  });

  it("rebuilds standings and shows only the end screen in `showEndScreen`", () => {
    const source = mainSource();
    const body = sliceBetween(
      source,
      "function showEndScreen(): void {",
      "function browserStorage()",
    );
    expect(body).toContain("ensureStandings(document)");
    expect(body).toContain('showOverlay("end-screen")');
  });

  it("destroys standings (never hides) on the Menu return path", () => {
    const source = mainSource();
    const body = sliceBetween(
      source,
      'document.getElementById("end-menu")',
      "applyResponsiveSize();",
    );
    expect(body).toContain("destroyStandings(document)");
    expect(body).not.toContain("hud.endScreen.style.display");
    expect(body).toContain("startMenuMusic");
    expect(body).toContain("updateChallengesPanel");
  });
});
