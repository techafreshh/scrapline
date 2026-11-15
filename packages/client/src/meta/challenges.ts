// Daily challenges: three fixed local-day tasks (rifle kills, grenade
// kills, a win on dune) progressed from core sim events and surfaced in
// a menu panel that refreshes at local midnight. Pure progress helpers
// stay DOM-free and unit-testable under node like meta/profile.ts; the
// thin panel binder mirrors the menu/tips.ts idiom (null-safe lookups,
// missing elements are no-ops, a `window.__challenges` probe mirror).
// The sim stays untouched: main.ts owns the storage handle and feeds
// drained kill details plus the authoritative matchEnd edge in.

/** One fixed daily task: kill/win quota plus its one-shot XP reward. */
export interface ChallengeTemplate {
  /** Stable row id (also the `data-challenge` attribute value). */
  id: string;
  /** Player-language row label. */
  label: string;
  /** Completions needed (progress clamps here). */
  target: number;
  /** XP auto-awarded once on completion. */
  xp: number;
}

/**
 * Fixed daily set, always these three in this order: rifle kills,
 * grenade kills, then the dune win. A fixed set (no seeded rotation)
 * keeps the grenade `2/2` acceptance row present every day.
 */
export const CHALLENGE_TEMPLATES: readonly ChallengeTemplate[] = [
  { id: "rifle-5", label: "Score 5 rifle kills", target: 5, xp: 30 },
  { id: "grenade-2", label: "Score 2 grenade kills", target: 2, xp: 30 },
  { id: "win-dune-1", label: "Win a match on dune", target: 1, xp: 50 },
];

/** localStorage key holding the challenge JSON object. */
export const CHALLENGES_KEY = "scrapline.challenges.v1";

/** Minimal storage surface so tests can pass a fake (no DOM needed). */
export interface ChallengeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Per-template progress: quota fill plus its one-shot claim flag. */
export interface ChallengeProgress {
  progress: number;
  claimed: boolean;
}

/** One local day of challenge progress, keyed by template id. */
export interface ChallengeState {
  /** Local calendar day id (`YYYY-MM-DD`); a mismatch resets progress. */
  dayId: string;
  progress: Record<string, ChallengeProgress>;
}

/** Minimal kill surface; the core KillDetail satisfies it. */
export interface KillLike {
  killerId: number | null;
  weapon: string | null;
}

/** Minimal match-outcome surface for the dune-win row. */
export interface WinLike {
  win: boolean;
  map: unknown;
}

/** Probe row: id, fill, quota, `N/M` text, completion, and reward. */
export interface ChallengeRow {
  id: string;
  label: string;
  progress: number;
  target: number;
  text: string;
  done: boolean;
  xp: number;
}

/**
 * Local calendar day id (`YYYY-MM-DD` in the host timezone) for an
 * instant. Accepts a Date or an epoch-ms number; garbage input (and
 * throwing clocks) falls back to right now, so probes can mock `Date`
 * and the panel still rolls over at local midnight. Never throws,
 * never returns empty.
 */
export function dayIdFor(now?: unknown): string {
  let stamp: Date;
  try {
    if (now instanceof Date) {
      stamp = Number.isNaN(now.getTime()) ? new Date() : now;
    } else if (typeof now === "number" && Number.isFinite(now)) {
      stamp = new Date(now);
    } else {
      stamp = new Date();
    }
  } catch {
    stamp = new Date();
  }
  try {
    const year = stamp.getFullYear();
    const month = stamp.getMonth() + 1;
    const day = stamp.getDate();
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day)
    ) {
      throw new Error("bad date parts");
    }
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
    return `${year}-${pad(month)}-${pad(day)}`;
  } catch {
    // Clock unreadable mid-format: rebuild from a fresh instant.
    const fallback = new Date();
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
    return `${fallback.getFullYear()}-${pad(fallback.getMonth() + 1)}-${pad(fallback.getDate())}`;
  }
}

/** Template lookup by id; unknown ids read undefined. */
function templateFor(id: unknown): ChallengeTemplate | undefined {
  if (typeof id !== "string") {
    return undefined;
  }
  for (const template of CHALLENGE_TEMPLATES) {
    if (template.id === id) {
      return template;
    }
  }
  return undefined;
}

/**
 * Fresh zeroed state for a day id. Non-string day ids fall back to
 * today. Never throws.
 */
export function defaultChallengeState(dayId: unknown): ChallengeState {
  let id: string;
  try {
    id =
      typeof dayId === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayId)
        ? dayId
        : dayIdFor();
  } catch {
    id = dayIdFor();
  }
  const progress: Record<string, ChallengeProgress> = {};
  for (const template of CHALLENGE_TEMPLATES) {
    progress[template.id] = { progress: 0, claimed: false };
  }
  return { dayId: id, progress };
}

/** Tolerantly normalize an unknown value into a quota fill. */
function parseProgressField(value: unknown, target: number): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    if (value.trim() === "") {
      return 0;
    }
    n = Number(value);
  } else {
    return 0;
  }
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(target, Math.max(0, Math.floor(n)));
}

/**
 * Tolerantly normalize an unknown value into a challenge state: each
 * per-template field falls back independently (the parseProfile idiom)
 * and unknown template severities are dropped. Never throws.
 */
export function parseChallengeState(
  value: unknown,
  dayId?: unknown,
): ChallengeState {
  const rec =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const storedDay = rec["dayId"];
  const id =
    typeof storedDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(storedDay)
      ? storedDay
      : undefined;
  const fallback =
    typeof dayId === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dayId)
      ? dayId
      : dayIdFor();
  const rows =
    typeof rec["progress"] === "object" && rec["progress"] !== null
      ? (rec["progress"] as Record<string, unknown>)
      : {};
  const progress: Record<string, ChallengeProgress> = {};
  for (const template of CHALLENGE_TEMPLATES) {
    const row =
      typeof rows[template.id] === "object" && rows[template.id] !== null
        ? (rows[template.id] as Record<string, unknown>)
        : {};
    progress[template.id] = {
      progress: parseProgressField(row["progress"], template.target),
      claimed: row["claimed"] === true,
    };
  }
  return { dayId: id ?? fallback, progress };
}

/** Null-safe read: storage errors (or absence) yield null. */
function safeGet(
  storage: ChallengeStorage | null | undefined,
  key: string,
): string | null {
  if (storage === null || storage === undefined) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Load today's challenge state; a stored day id that differs from the
 * local day (midnight crossed) resets to fresh zeros. Missing,
 * corrupt, or unreadable values fall back per field. Never throws.
 */
export function loadChallenges(
  storage: ChallengeStorage | null | undefined,
  now?: unknown,
): ChallengeState {
  const today = dayIdFor(now ?? new Date());
  const raw = safeGet(storage, CHALLENGES_KEY);
  if (raw === null || raw.trim() === "") {
    return defaultChallengeState(today);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return defaultChallengeState(today);
  }
  const state = parseChallengeState(parsed, today);
  if (state.dayId !== today) {
    return defaultChallengeState(today);
  }
  return state;
}

/**
 * Persist the state as one JSON object holding exactly
 * `{dayId, progress}`; storage errors are swallowed.
 */
export function saveChallenges(
  storage: ChallengeStorage | null | undefined,
  state: ChallengeState,
): void {
  if (storage === null || storage === undefined) {
    return;
  }
  try {
    const parsed = parseChallengeState(state, state.dayId);
    try {
      storage.setItem(
        CHALLENGES_KEY,
        JSON.stringify({ dayId: parsed.dayId, progress: parsed.progress }),
      );
    } catch {
      // Private-mode storage: the match still counts, just not persisted.
    }
  } catch {
    // Unnormalizable state: never let persistence break the match.
  }
}

/**
 * Progress the kill rows from one drained kill detail: only the local
 * player (`killerId === 0`) counts, `rifle` fills the rifle row and
 * `grenade` the grenade row, clamped at quota. Bot-vs-bot kills and
 * unattributed deaths never count. Returns true when a row advanced.
 * Never throws.
 */
export function recordKill(
  state: ChallengeState | null | undefined,
  detail: unknown,
): boolean {
  try {
    if (state === null || state === undefined || typeof state !== "object") {
      return false;
    }
    if (state.progress === null || typeof state.progress !== "object") {
      return false;
    }
    const rec =
      typeof detail === "object" && detail !== null
        ? (detail as Record<string, unknown>)
        : {};
    if (rec["killerId"] !== 0) {
      return false;
    }
    const weapon = rec["weapon"];
    const id =
      weapon === "rifle"
        ? "rifle-5"
        : weapon === "grenade"
          ? "grenade-2"
          : null;
    if (id === null) {
      return false;
    }
    const template = templateFor(id);
    if (template === undefined) {
      return false;
    }
    const row = state.progress[id];
    const current =
      row !== undefined && typeof row.progress === "number" && Number.isFinite(row.progress)
        ? Math.max(0, Math.floor(row.progress))
        : 0;
    if (current >= template.target) {
      return false;
    }
    state.progress[id] = {
      progress: Math.min(template.target, current + 1),
      claimed: row?.claimed === true,
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Progress the dune-win row: completes only on a win (`win === true`)
 * while the running match's map is `dune`. Losses and other maps never
 * count. Returns true when the row advanced. Never throws.
 */
export function recordWin(
  state: ChallengeState | null | undefined,
  outcome: unknown,
): boolean {
  try {
    if (state === null || state === undefined || typeof state !== "object") {
      return false;
    }
    if (state.progress === null || typeof state.progress !== "object") {
      return false;
    }
    const rec =
      typeof outcome === "object" && outcome !== null
        ? (outcome as Record<string, unknown>)
        : {};
    if (rec["win"] !== true || rec["map"] !== "dune") {
      return false;
    }
    const template = templateFor("win-dune-1");
    if (template === undefined) {
      return false;
    }
    const row = state.progress["win-dune-1"];
    const current =
      row !== undefined && typeof row.progress === "number" && Number.isFinite(row.progress)
        ? Math.max(0, Math.floor(row.progress))
        : 0;
    if (current >= template.target) {
      return false;
    }
    state.progress["win-dune-1"] = {
      progress: template.target,
      claimed: row?.claimed === true,
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * XP due for freshly completed rows: sums the rewards of done but
 * unclaimed rows and marks them claimed, so a second call returns 0
 * (each challenge pays once per day). Never throws.
 */
export function collectDueXp(
  state: ChallengeState | null | undefined,
): number {
  try {
    if (state === null || state === undefined || typeof state !== "object") {
      return 0;
    }
    if (state.progress === null || typeof state.progress !== "object") {
      return 0;
    }
    let due = 0;
    for (const template of CHALLENGE_TEMPLATES) {
      const row = state.progress[template.id];
      if (row === undefined) {
        continue;
      }
      const fill =
        typeof row.progress === "number" && Number.isFinite(row.progress)
          ? Math.floor(row.progress)
          : 0;
      if (fill >= template.target && row.claimed !== true) {
        due += template.xp;
        state.progress[template.id] = { progress: fill, claimed: true };
      }
    }
    return due;
  } catch {
    return 0;
  }
}

/**
 * `N/M` progress text for a row id (the `2/2` probe readout): fill
 * clamped to quota, unknown ids read `0/0`. Never throws.
 */
export function challengeProgressText(
  state: ChallengeState | null | undefined,
  id: unknown,
): string {
  try {
    const template = templateFor(id);
    if (template === undefined) {
      return "0/0";
    }
    let fill = 0;
    if (
      state !== null &&
      state !== undefined &&
      typeof state === "object" &&
      state.progress !== null &&
      typeof state.progress === "object"
    ) {
      const row = (state.progress as Record<string, ChallengeProgress>)[
        template.id
      ];
      if (
        row !== undefined &&
        typeof row.progress === "number" &&
        Number.isFinite(row.progress)
      ) {
        fill = Math.min(template.target, Math.max(0, Math.floor(row.progress)));
      }
    }
    return `${fill}/${template.target}`;
  } catch {
    return "0/0";
  }
}

/**
 * Probe rows for a state, in template order: id, fill, quota, `N/M`
 * text, completion, and reward. Tolerantly normalized, never throws.
 */
export function challengeRows(
  state: ChallengeState | null | undefined,
): ChallengeRow[] {
  try {
    const rows: ChallengeRow[] = [];
    for (const template of CHALLENGE_TEMPLATES) {
      const text = challengeProgressText(state, template.id);
      const fill = Number(text.split("/")[0] ?? 0);
      rows.push({
        id: template.id,
        label: template.label,
        progress: Number.isFinite(fill) ? fill : 0,
        target: template.target,
        text,
        done: text === `${template.target}/${template.target}`,
        xp: template.xp,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

/** Panel container element id (child of #menu). */
export const CHALLENGES_PANEL_ID = "challenges-panel";
/** Panel toggle button id (child of #menu). */
export const CHALLENGES_OPEN_ID = "challenges-open";
/** Row marker attribute: each row carries `data-challenge="<id>"`. */
export const CHALLENGE_ROW_ATTR = "data-challenge";
/** Panel title element id. */
export const CHALLENGES_TITLE_ID = "challenges-title";

/** Live binder state returned by bindChallenges. */
export interface ChallengesBinder {
  /** Current day state (reloaded from storage on every refresh). */
  state: ChallengeState;
  /** Re-read storage, repaint the panel, mirror the probe; returns the set id. */
  refresh(): string;
  /** Detach nothing (listeners attach once); keeps the tips.ts shape. */
  stop(): void;
}

/** Null-safe id lookup: shorn documents read null instead of throwing. */
function byId(doc: Document, id: string): unknown {
  try {
    const lookup = (doc as unknown as { getElementById?: unknown })
      .getElementById;
    if (typeof lookup !== "function") {
      return null;
    }
    return (lookup as (key: string) => unknown).call(doc, id);
  } catch {
    return null;
  }
}

/** Assign text on an unknown handle when it carries textContent. */
function setText(el: unknown, text: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  if ("textContent" in el) {
    (el as { textContent: unknown }).textContent = text;
  }
}

/** Write one style property on an unknown handle's style bag. */
function setStyle(el: unknown, name: string, value: string): void {
  if (typeof el !== "object" || el === null) {
    return;
  }
  const style = (el as { style?: unknown }).style;
  if (typeof style !== "object" || style === null) {
    return;
  }
  (style as Record<string, unknown>)[name] = value;
}

/** Read one attribute off an unknown handle; else empty string. */
function getAttr(el: unknown, name: string): string {
  try {
    if (typeof el !== "object" || el === null) {
      return "";
    }
    const getter = (el as { getAttribute?: unknown }).getAttribute;
    if (typeof getter !== "function") {
      return "";
    }
    const value = (getter as (key: string) => unknown).call(el, name);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** Write one attribute on an unknown handle (best-effort). */
function setAttr(el: unknown, name: string, value: string): void {
  try {
    if (typeof el !== "object" || el === null) {
      return;
    }
    const setter = (el as { setAttribute?: unknown }).setAttribute;
    if (typeof setter !== "function") {
      return;
    }
    (setter as (key: string, val: string) => void).call(el, name, value);
  } catch {
    // Attribute write best-effort: the text update below still lands.
  }
}

/** Create one element via the document (null when shorn). */
function makeEl(doc: Document, tag: string): unknown {
  try {
    const creator = (doc as unknown as { createElement?: unknown })
      .createElement;
    if (typeof creator !== "function") {
      return null;
    }
    const el = (creator as (t: string) => unknown).call(doc, tag);
    return el !== null && typeof el === "object" ? el : null;
  } catch {
    return null;
  }
}

/** Append a child (false when the parent cannot take it). */
function appendKid(parent: unknown, kid: unknown): boolean {
  try {
    if (parent === null || typeof parent !== "object") {
      return false;
    }
    if (kid === null || typeof kid !== "object") {
      return false;
    }
    const appender = (parent as { appendChild?: unknown }).appendChild;
    if (typeof appender !== "function") {
      return false;
    }
    (appender as (k: unknown) => void).call(parent, kid);
    return true;
  } catch {
    return false;
  }
}

/** First child of a row whose class list contains the name. */
function childByClass(row: unknown, name: string): unknown {
  try {
    if (row === null || typeof row !== "object") {
      return null;
    }
    const kids = (row as { children?: unknown; childNodes?: unknown })
      .children;
    const list: ArrayLike<unknown> =
      kids !== null && typeof kids === "object" && typeof (kids as ArrayLike<unknown>).length === "number"
        ? (kids as ArrayLike<unknown>)
        : [];
    for (let i = 0; i < list.length; i += 1) {
      const kid = list[i];
      if (kid === null || typeof kid !== "object") {
        continue;
      }
      const cls = (kid as { className?: unknown }).className;
      if (typeof cls === "string") {
        const parts = cls.split(/\s+/);
        for (const part of parts) {
          if (part === name) {
            return kid;
          }
        }
      }
    }
    // Fallback for selector-capable rows (real DOM handles).
    try {
      const query = (row as { querySelector?: unknown }).querySelector;
      if (typeof query === "function") {
        const found = (query as (sel: string) => unknown).call(row, `.${name}`);
        if (found !== null && typeof found === "object") {
          return found;
        }
      }
    } catch {
      // Children scan already missed: no progress child to paint.
    }
    return null;
  } catch {
    return null;
  }
}

/** All panel rows: every node carrying a `data-challenge` attribute. */
function panelRows(doc: Document, panel: unknown): unknown[] {
  const rows: unknown[] = [];
  try {
    const query = (doc as unknown as { querySelectorAll?: unknown })
      .querySelectorAll;
    if (typeof query === "function") {
      const found = (query as (sel: string) => unknown).call(
        doc,
        `[${CHALLENGE_ROW_ATTR}]`,
      );
      if (found !== null && typeof found === "object") {
        const list = found as ArrayLike<unknown>;
        if (typeof list.length === "number") {
          for (let i = 0; i < list.length; i += 1) {
            const row = list[i];
            if (row !== null && typeof row === "object") {
              rows.push(row);
            }
          }
          return rows;
        }
        if (typeof (found as Iterable<unknown>)[Symbol.iterator] === "function") {
          for (const row of found as Iterable<unknown>) {
            if (row !== null && typeof row === "object") {
              rows.push(row);
            }
          }
          return rows;
        }
      }
    }
  } catch {
    // Selector surface shorn: fall back to the panel children below.
  }
  try {
    if (panel !== null && typeof panel === "object") {
      const kids = (panel as { children?: unknown }).children;
      if (
        kids !== null &&
        typeof kids === "object" &&
        typeof (kids as ArrayLike<unknown>).length === "number"
      ) {
        const list = kids as ArrayLike<unknown>;
        for (let i = 0; i < list.length; i += 1) {
          const row = list[i];
          if (
            row !== null &&
            typeof row === "object" &&
            getAttr(row, CHALLENGE_ROW_ATTR) !== ""
          ) {
            rows.push(row);
          }
        }
      }
    }
  } catch {
    // Children unreadable: the panel stays as-is.
  }
  return rows;
}

/**
 * Build one challenge row node: `<div class="challenge-row"
 * data-challenge="<id>">` with label, `N/M` progress, and reward spans.
 */
function buildRow(doc: Document, template: ChallengeTemplate): unknown {
  const row = makeEl(doc, "div");
  if (row === null) {
    return null;
  }
  setAttr(row, CHALLENGE_ROW_ATTR, template.id);
  try {
    (row as { className?: unknown }).className = "challenge-row";
  } catch {
    // Class best-effort: the attribute marker still selects the row.
  }
  const label = makeEl(doc, "span");
  if (label !== null) {
    try {
      (label as { className?: unknown }).className = "challenge-label";
    } catch {
      // Class best-effort only.
    }
    setText(label, template.label);
    appendKid(row, label);
  }
  const progress = makeEl(doc, "span");
  if (progress !== null) {
    try {
      (progress as { className?: unknown }).className = "challenge-progress";
    } catch {
      // Class best-effort only.
    }
    setText(progress, `0/${template.target}`);
    appendKid(row, progress);
  }
  const reward = makeEl(doc, "span");
  if (reward !== null) {
    try {
      (reward as { className?: unknown }).className = "challenge-reward";
    } catch {
      // Class best-effort only.
    }
    setText(reward, `${template.xp} XP`);
    appendKid(row, reward);
  }
  return row;
}

/**
 * Ensure the challenges panel exists inside #menu with exactly the
 * three template rows (idempotent; existing rows are never rebuilt).
 * Returns the panel node, or null when #menu is missing. Never throws.
 */
export function ensureChallengesPanel(doc: Document): unknown {
  try {
    const existing = byId(doc, CHALLENGES_PANEL_ID);
    if (existing !== null && typeof existing === "object") {
      // Static skeleton path: top up rows missing from a shorn
      // skeleton so the panel always carries exactly the template set.
      try {
        const have = new Set<string>();
        for (const row of panelRows(doc, existing)) {
          const id = getAttr(row, CHALLENGE_ROW_ATTR);
          if (id !== "") {
            have.add(id);
          }
        }
        for (const template of CHALLENGE_TEMPLATES) {
          if (!have.has(template.id)) {
            const row = buildRow(doc, template);
            if (row !== null) {
              appendKid(existing, row);
            }
          }
        }
      } catch {
        // Top-up best-effort: the skeleton rows still render.
      }
      return existing;
    }
    const menu = byId(doc, "menu");
    if (menu === null || typeof menu !== "object") {
      return null;
    }
    const panel = makeEl(doc, "div");
    if (panel === null) {
      return null;
    }
    setAttr(panel, "id", CHALLENGES_PANEL_ID);
    try {
      (panel as { id?: unknown }).id = CHALLENGES_PANEL_ID;
    } catch {
      // Id assignment best-effort: the attribute still selects it.
    }
    setStyle(panel, "display", "none");
    const title = makeEl(doc, "span");
    if (title !== null) {
      setAttr(title, "id", CHALLENGES_TITLE_ID);
      try {
        (title as { id?: unknown }).id = CHALLENGES_TITLE_ID;
      } catch {
        // Id best-effort only.
      }
      setText(title, "Daily Challenges");
      appendKid(panel, title);
    }
    for (const template of CHALLENGE_TEMPLATES) {
      const row = buildRow(doc, template);
      if (row !== null) {
        appendKid(panel, row);
      }
    }
    if (!appendKid(menu, panel)) {
      return null;
    }
    return panel;
  } catch {
    return null;
  }
}

/** Mirror the live challenges onto window.__challenges (best-effort). */
function mirrorChallenges(state: ChallengeState): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    const surface: Record<string, unknown> = {
      setId: state.dayId,
      rows: challengeRows(state),
    };
    const current = (window as unknown as Record<string, unknown>)[
      "__challenges"
    ] as Record<string, unknown> | undefined;
    if (current !== undefined && current !== null && typeof current === "object") {
      Object.assign(current, surface);
    } else {
      (window as unknown as Record<string, unknown>)["__challenges"] = surface;
    }
  } catch {
    // Probe mirror best-effort only.
  }
}

/** True while the challenges panel overlay is on screen. */
function isPanelVisible(panel: unknown): boolean {
  try {
    if (panel === null || typeof panel !== "object") {
      return false;
    }
    const style = (panel as { style?: { display?: unknown } }).style;
    if (style === null || style === undefined || typeof style !== "object") {
      return false;
    }
    return style.display !== "none";
  } catch {
    return false;
  }
}

/**
 * Repaint the panel rows from a state: each `data-challenge` row's
 * progress span reads `N/M` and the row carries `data-done` once its
 * quota fills. Rows are never rebuilt here. Mirrors
 * `window.__challenges`. Returns the painted row count. Never throws.
 */
export function updateChallengesPanel(
  doc: Document,
  state: ChallengeState | null | undefined,
): number {
  try {
    const panel = ensureChallengesPanel(doc);
    if (panel === null || typeof panel !== "object") {
      return 0;
    }
    const parsed = parseChallengeState(state, state?.dayId);
    const rows = panelRows(doc, panel);
    let painted = 0;
    for (const row of rows) {
      const id = getAttr(row, CHALLENGE_ROW_ATTR);
      const template = templateFor(id);
      if (template === undefined) {
        continue;
      }
      const text = challengeProgressText(parsed, id);
      const slot = childByClass(row, "challenge-progress");
      if (slot !== null) {
        setText(slot, text);
      } else {
        // Skeleton without span hooks: repaint the row text in place.
        setText(row, `${template.label} ${text} ${template.xp} XP`);
      }
      setAttr(row, "data-done", text === `${template.target}/${template.target}` ? "true" : "false");
      painted += 1;
    }
    mirrorChallenges(parsed);
    return painted;
  } catch {
    return 0;
  }
}

/**
 * Wire the menu challenges panel: ensure the panel DOM, paint it from
 * storage, mirror `window.__challenges`, and toggle it from the
 * `#challenges-open` button (repainting from storage on every open so
 * a midnight crossing resets the rows before they show). Missing
 * elements are no-ops; the open listener attaches once. Never throws.
 */
export function bindChallenges(
  doc: Document,
  storage: ChallengeStorage | null | undefined,
  now?: unknown,
): ChallengesBinder {
  const binder: ChallengesBinder = {
    state: loadChallenges(storage, now),
    refresh: (): string => "",
    stop: (): void => {},
  };
  const repaint = (state: ChallengeState): string => {
    try {
      binder.state = state;
      updateChallengesPanel(doc, state);
      return state.dayId;
    } catch {
      return binder.state.dayId;
    }
  };
  binder.refresh = (): string => {
    try {
      return repaint(loadChallenges(storage));
    } catch {
      return binder.state.dayId;
    }
  };
  try {
    ensureChallengesPanel(doc);
  } catch {
    // Static skeleton suffices: the paint below still mirrors.
  }
  try {
    repaint(binder.state);
  } catch {
    // Initial paint best-effort only.
  }
  try {
    const opener = byId(doc, CHALLENGES_OPEN_ID);
    if (opener !== null && typeof opener === "object") {
      if (getAttr(opener, "data-challenges-bound") !== "true") {
        setAttr(opener, "data-challenges-bound", "true");
        const listen = (opener as { addEventListener?: unknown })
          .addEventListener;
        if (typeof listen === "function") {
          (listen as (type: string, fn: () => void) => void).call(
            opener,
            "click",
            () => {
              try {
                const panel = ensureChallengesPanel(doc);
                if (panel === null || typeof panel !== "object") {
                  return;
                }
                if (isPanelVisible(panel)) {
                  setStyle(panel, "display", "none");
                  return;
                }
                const fresh = loadChallenges(storage);
                repaint(fresh);
                setStyle(panel, "display", "");
              } catch {
                // Toggle best-effort: the menu still works.
              }
            },
          );
        }
      }
    }
  } catch {
    // Opener optional: the panel still paints underneath.
  }
  return binder;
}
