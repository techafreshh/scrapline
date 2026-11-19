// Offline kill-feed victim color regression (issue #331): `stepOnce`
// must resolve the victim feed index by player id (mirroring the killer
// side and the online `renderOnlineSnapshot` block), not pass the raw
// positional `kill.victim` field. Reads main.ts as text only (never
// imports it — load-time DOM side effects), mirroring
// main-cache.test.ts.
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

describe("main.ts offline killfeed victim index (issue #331)", () => {
  it("resolves the victim feed index by victimId beside the killer lines", () => {
    const source = mainSource();
    const stepBody = sliceBetween(
      source,
      "function stepOnce(): string[] {",
      "const kills = killsFromDiff(",
    );
    expect(stepBody).toContain("kill.victimId");
    expect(stepBody).toContain(
      "world.players.findIndex((p) => p.id === kill.victimId)",
    );
  });

  it("passes the guarded victim index to pushKillfeed, not kill.victim", () => {
    const source = mainSource();
    const stepBody = sliceBetween(
      source,
      "function stepOnce(): string[] {",
      "const kills = killsFromDiff(",
    );
    expect(stepBody).toContain("pushKillfeed(");
    expect(stepBody).toContain("victimIdx >= 0 ? victimIdx : null");
    expect(stepBody).not.toContain("kill.victim,");
    expect(stepBody).not.toContain("kill.victim)");
  });
});
