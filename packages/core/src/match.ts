// FFA match helpers — pure standings/end-condition logic for World.
//
// The sim is sacred: this module is pure data plus pure functions (no
// imports except the tuning literals, no RNG/clock/globals) so match
// orchestration never leaks nondeterminism into packages/core. World
// owns the mutable scores; these helpers decide order and endings.

import { MATCH_SCORE_LIMIT, MATCH_TIME_LIMIT_TICKS } from "./constants";

/** Match mode (only "ffa" is implemented; other strings behave as FFA). */
export type MatchMode = "ffa";

/** Default mode when WorldOptions.mode is absent. */
export const DEFAULT_MATCH_MODE: MatchMode = "ffa";
/** Default kill cap (25 kills). */
export const DEFAULT_SCORE_LIMIT = MATCH_SCORE_LIMIT;
/** Default time cap (5 min * 60 Hz). */
export const DEFAULT_TIME_LIMIT_TICKS = MATCH_TIME_LIMIT_TICKS;

/**
 * Player ids ordered by score desc, id asc on ties. `scores[k]` belongs
 * to `ids[k]` (World's player-array position); missing entries read 0.
 */
export function standingsFor(scores: readonly number[], ids: readonly number[]): number[] {
  return ids
    .map((id, k) => ({ id, score: scores[k] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .map((entry) => entry.id);
}

/** True when any score hit the kill cap or tick hit the time cap. */
export function isMatchOver(
  scores: readonly number[],
  tick: number,
  scoreLimit: number,
  timeLimitTicks: number,
): boolean {
  if (tick >= timeLimitTicks) {
    return true;
  }
  for (const score of scores) {
    if (score >= scoreLimit) {
      return true;
    }
  }
  return false;
}
