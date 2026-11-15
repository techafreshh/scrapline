// Online server-roster helpers (issue #217). Pure and DOM-free: name
// normalization, roster lookups, and the leave-banner text shared by the
// snapshot path and the immediate leave frame. Unit-testable under node
// like interpolation.ts; the binder in online.ts owns all DOM/Renderer
// work and only reads these helpers.

/** One server roster row: player id plus display name. */
export interface RosterEntry {
  /** Player id (matches the snapshot rows). */
  id: number;
  /** Display name (Alice/Bob, never a bot-pool name). */
  name: string;
  /** True once the slot idles as a host-backfill bot after a leave. */
  bot?: boolean;
}

/** Max roster display-name length (mirrors the profile 16-char cap). */
export const ROSTER_NAME_MAX = 16;

/** Leave-banner text: every disconnect banner contains this substring. */
export const LEAVE_BANNER_TEXT = "Player left";

/**
 * Normalize an unknown display name: trimmed, truncated to 16 chars,
 * falling back when blank or non-string. Never throws.
 */
export function normalizeRosterName(value: unknown, fallback: string): string {
  try {
    if (typeof value === "string") {
      const clean = value.trim().slice(0, ROSTER_NAME_MAX);
      if (clean.length > 0) {
        return clean;
      }
    }
  } catch {
    // Hostile input: the fallback stands.
  }
  return fallback;
}

/** True for a finite non-negative integer player id. */
function isPid(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/**
 * Normalize an unknown roster payload into entries: non-array payloads
 * read empty, rows without a finite id are dropped, blank names fall
 * back to `Player<id>`. Never throws.
 */
export function rosterFrom(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: RosterEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = row["id"];
    if (!isPid(id)) {
      continue;
    }
    out.push({
      id,
      name: normalizeRosterName(row["name"], `Player${id}`),
      ...(typeof row["bot"] === "boolean" ? { bot: row["bot"] } : {}),
    });
  }
  return out;
}

/**
 * Display name for a player id from the server roster: the roster row
 * wins (so Bob reads Bob for Alice), missing rows fall back to the
 * provided fallback (callers pass the offline pool name or Player<id>).
 */
export function nameForRoster(
  roster: readonly RosterEntry[] | null | undefined,
  id: number,
  fallback?: string | null,
): string {
  try {
    if (Array.isArray(roster)) {
      for (const row of roster) {
        if (row !== null && typeof row === "object" && row.id === id) {
          if (typeof row.name === "string" && row.name.length > 0) {
            return row.name;
          }
          break;
        }
      }
    }
  } catch {
    // Hostile roster: the fallback stands.
  }
  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback;
  }
  return `Player${id}`;
}

/**
 * Leave-banner text for a departed name: always contains `Player left`
 * (the acceptance substring), with the departed name appended when
 * known so `Player left: Bob` still matches the `Player left` probe.
 */
export function leaveBannerFor(name?: string | null): string {
  const clean =
    typeof name === "string" && name.trim().length > 0
      ? name.trim().slice(0, ROSTER_NAME_MAX)
      : "";
  return clean.length > 0 ? `${LEAVE_BANNER_TEXT}: ${clean}` : LEAVE_BANNER_TEXT;
}

/**
 * Merge fresh roster rows into the previous roster by id: rows present
 * in the fresh payload replace by id, rows missing from a non-empty
 * fresh payload are dropped (the server is authoritative), while an
 * empty/undefined fresh payload keeps the previous roster (a snapshot
 * without roster rows must not wipe names mid-match).
 */
export function mergeRoster(
  prev: readonly RosterEntry[],
  fresh: readonly RosterEntry[] | null | undefined,
): RosterEntry[] {
  if (!Array.isArray(fresh) || fresh.length === 0) {
    return prev.map((row) => ({ ...row }));
  }
  return fresh.map((row) => ({ ...row }));
}
