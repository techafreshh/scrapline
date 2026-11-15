// Honest-mode interpolation buffer tests: bracketing lerp, edge clamping
// (no extrapolation), the 100 ms delay window, and shortest-arc aim.
// Pure imports only, no DOM (mirrors the codec.test.ts style).
import { describe, expect, it } from "vitest";
import {
  INTERP_BUFFER_MS,
  INTERP_DELAY_MS,
  SnapshotBuffer,
  lerpAim,
} from "../src/net/interpolation";

const DEG = Math.PI / 180;

function row(id: number, x: number, y = 0, aim = 0) {
  return { id, x, y, aim, hp: 100, weapon: "pistol" as const };
}

describe("SnapshotBuffer delay window", () => {
  it("pins the interpolation delay inside 80-120ms", () => {
    expect(INTERP_DELAY_MS).toBeGreaterThanOrEqual(80);
    expect(INTERP_DELAY_MS).toBeLessThanOrEqual(120);
    expect(INTERP_DELAY_MS).toBe(100);
    expect(INTERP_BUFFER_MS).toBeGreaterThanOrEqual(500);
  });

  it("samples the midpoint between two snapshots 50ms apart", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1, 0, [row(0, 0), row(1, 100)]);
    buffer.push(2, 50, [row(0, 100), row(1, 200)]);
    // Renders at nowMs - 100: nowMs=125 renders t=25, the exact midpoint.
    const rows = buffer.sample(125);
    expect(rows).toHaveLength(2);
    const local = rows.find((p) => p.id === 0);
    const remote = rows.find((p) => p.id === 1);
    expect(local?.x).toBeCloseTo(50, 9);
    expect(remote?.x).toBeCloseTo(150, 9);
  });

  it("renders between the last two snapshots, not extrapolated", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1, 0, [row(0, 0)]);
    buffer.push(2, 50, [row(0, 100)]);
    // Render time past the newest edge clamps to the newest row.
    const late = buffer.sample(1000);
    expect(late).toHaveLength(1);
    expect(late[0]?.x).toBe(100);
    // Render time before the oldest edge clamps to the oldest row.
    const early = buffer.sample(50);
    expect(early).toHaveLength(1);
    expect(early[0]?.x).toBe(0);
  });

  it("never leaves the convex hull of the stored snapshots", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1, 0, [row(0, 10, 20)]);
    buffer.push(2, 40, [row(0, 30, 60)]);
    buffer.push(3, 80, [row(0, 50, 40)]);
    for (let now = 80; now <= 400; now += 5) {
      const rows = buffer.sample(now);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.x).toBeGreaterThanOrEqual(10);
      expect(rows[0]?.x).toBeLessThanOrEqual(50);
      expect(rows[0]?.y).toBeGreaterThanOrEqual(20);
      expect(rows[0]?.y).toBeLessThanOrEqual(60);
    }
  });

  it("lerps aim along the shortest arc through 0deg, never 180deg", () => {
    // 350deg -> 10deg must pass through 0deg (short way around).
    const mid = lerpAim(350 * DEG, 10 * DEG, 0.5);
    const wrapped = ((mid % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const distToZero = Math.min(wrapped, Math.PI * 2 - wrapped);
    expect(distToZero).toBeLessThan(0.05);
    // Full buffer path: the sampled midpoint aim sits on the short arc.
    const buffer = new SnapshotBuffer();
    buffer.push(1, 0, [row(0, 0, 0, 350 * DEG)]);
    buffer.push(2, 50, [row(0, 0, 0, 10 * DEG)]);
    const rows = buffer.sample(125);
    const aim = rows[0]?.aim ?? NaN;
    const w = ((aim % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    expect(Math.min(w, Math.PI * 2 - w)).toBeLessThan(0.05);
  });

  it("holds the known row for players present on only one side", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(1, 0, [row(0, 0)]);
    buffer.push(2, 50, [row(0, 100), row(7, 400)]);
    const rows = buffer.sample(125);
    expect(rows).toHaveLength(2);
    expect(rows.find((p) => p.id === 0)?.x).toBeCloseTo(50, 9);
    // Player 7 joins mid-buffer: no invented motion, holds the join row.
    expect(rows.find((p) => p.id === 7)?.x).toBe(400);
  });

  it("returns no rows when empty and clears on demand", () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.sample(1000)).toEqual([]);
    expect(buffer.latestTick).toBe(-1);
    buffer.push(9, 900, [row(0, 5)]);
    expect(buffer.size).toBe(1);
    expect(buffer.latestTick).toBe(9);
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.sample(1000)).toEqual([]);
  });
});
