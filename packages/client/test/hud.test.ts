// HUD helper tests: names, ordinals, timer text, standings rows, and
// score/alive-diff kill attribution. Pure helpers only (no DOM/jsdom),
// mirroring packages/core/test builder style.
import { describe, expect, it } from "vitest";
import {
  formatTimer,
  killsFromDiff,
  ordinal,
  playerName,
  standingsRows,
} from "../src/hud/hud";

describe("playerName", () => {
  it("names the local id 0 You and others Bot <id>", () => {
    expect(playerName(0)).toBe("You");
    expect(playerName(1)).toBe("Bot 1");
    expect(playerName(3)).toBe("Bot 3");
  });
});

describe("ordinal", () => {
  it("labels 1st, 2nd, 3rd, 4th, and 11th", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(11)).toBe("11th");
  });

  it("keeps the teen exception and rolls over at 21st", () => {
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
  });
});

describe("formatTimer", () => {
  it("shows 5:00 at tick 0 of an 18000-tick limit", () => {
    expect(formatTimer(0, 18000)).toBe("5:00");
  });

  it("counts down and clamps at 0:00 past the cap", () => {
    expect(formatTimer(17940, 18000)).toBe("0:01");
    expect(formatTimer(18000, 18000)).toBe("0:00");
    expect(formatTimer(19000, 18000)).toBe("0:00");
  });
});

describe("standingsRows", () => {
  it("orders by score desc, id asc on ties, with ordinal ranks", () => {
    const rows = standingsRows([3, 5, 5], [0, 1, 2]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 0]);
    expect(rows.map((row) => row.rank)).toEqual(["1st", "2nd", "3rd"]);
    expect(rows[0]).toMatchObject({ name: "Bot 1", score: 5 });
    expect(rows[2]).toMatchObject({ name: "You", score: 3 });
  });
});

describe("killsFromDiff", () => {
  it("attributes a single kill to the scorer", () => {
    const kills = killsFromDiff([0, 0], [1, 0], [true, true], [true, false]);
    expect(kills).toEqual([{ killerId: 0, victimId: 1 }]);
  });

  it("reports killer null for unattributed deaths", () => {
    const kills = killsFromDiff([0, 0], [0, 0], [true, true], [true, false]);
    expect(kills).toEqual([{ killerId: null, victimId: 1 }]);
  });

  it("pairs two same-tick kills with their scorers in order", () => {
    const kills = killsFromDiff(
      [0, 0, 0, 0],
      [1, 0, 1, 0],
      [true, true, true, true],
      [true, false, true, false],
    );
    expect(kills).toEqual([
      { killerId: 0, victimId: 1 },
      { killerId: 2, victimId: 3 },
    ]);
  });
});
