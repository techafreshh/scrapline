// Ambient particle beds: per-theme background life that runs behind
// gameplay. kilima drifts dust motes and crosses bird silhouettes,
// dune lifts heat shimmer plus fast sand streaks, frostbite falls
// snowfall under an oscillating aurora shimmer. Pure (no DOM, no Pixi):
// deterministic tick-hash spawn/update plus twin Pixi/canvas2d painters
// share one model so headless tests drive the same contract the
// renderer paints. Decor only: the renderer paints beds above tiles but
// below entities (never colliding), and the quality gate (low clears
// the bed) keeps low-end devices static.

import type { QualityLevel } from "../fx/filters";

/** Arena theme names in menu order. */
export const AMBIENT_THEMES = ["kilima", "dune", "frostbite"] as const;

/** Arena theme union for ambient beds. */
export type AmbientTheme = (typeof AMBIENT_THEMES)[number];

/**
 * Tolerant theme resolution: trims and lowercases, falls back to kilima
 * (the menu default) for unknown values. Mirrors resolveTileTheme.
 */
export function ambientThemeFor(name: unknown): AmbientTheme {
  if (typeof name === "string") {
    const key = name.trim().toLowerCase();
    if (key === "dune") {
      return "dune";
    }
    if (key === "frostbite") {
      return "frostbite";
    }
    if (key === "kilima") {
      return "kilima";
    }
  }
  return "kilima";
}

/**
 * True while the ambient bed may emit: only "low" variants (any case,
 * trimmed) read low, everything else (missing, corrupt, "high") reads
 * high. Mirrors lightsForQuality/parseQuality.
 */
export function ambientEnabled(quality: QualityLevel | unknown): boolean {
  if (typeof quality === "string" && quality.trim().toLowerCase() === "low") {
    return false;
  }
  return true;
}

/** Ambient mote kind (per-theme emitter source). */
export type AmbientMoteKind = "dust" | "snow" | "shimmer" | "streak";

/** One ambient mote in world coords (decor only, never colliding). */
export interface AmbientMote {
  /** Center in world px. */
  x: number;
  /** Center in world px. */
  y: number;
  /** Drift in world px per draw. */
  vx: number;
  /** Drift in world px per draw. */
  vy: number;
  /** Draws remaining. */
  ttl: number;
  /** Draws of total life (fade basis). */
  life: number;
  /** Paint edge in screen px (constant across zoom for probe stability). */
  size: number;
  /** Paint as Pixi hex. */
  color: number;
  /** Paint as CSS. */
  css: string;
  /** Peak paint alpha in (0, 1]. */
  alpha: number;
  /** Lateral sway amplitude in world px per draw (0 = straight). */
  sway: number;
  /** Sway phase seed in radians. */
  phase: number;
  /** Emitter source (drives the elongated streak paint). */
  kind: AmbientMoteKind;
}

/** One crossing bird silhouette in world coords (kilima only). */
export interface AmbientBird {
  /** Nose in world px. */
  x: number;
  /** Cruise height in world px (mid-band relative to the live camera). */
  y: number;
  /** Cruise speed in world px per draw (signed: flight direction). */
  vx: number;
  /** Wing phase in draws (advances 1 per draw, drives the flap). */
  flap: number;
  /** Draws remaining. */
  ttl: number;
  /** Draws of total life. */
  life: number;
}

/** Live ambient bed (renderer-owned, updated once per draw). */
export interface AmbientBed {
  motes: AmbientMote[];
  birds: AmbientBird[];
}

/** Fresh empty bed (renderer seeds one per backend lifetime). */
export function createAmbientBed(): AmbientBed {
  return { motes: [], birds: [] };
}

/** Hard cap on live ambient motes (oldest dropped first). */
export const AMBIENT_MOTE_CAP = 320;
/** Hard cap on live birds (kilima cruises a pair). */
export const AMBIENT_BIRD_CAP = 3;
/** kilima dust spawn per draw (1 x 160-draw life ~= 160 live). */
export const AMBIENT_DUST_TTL = 160;
/** frostbite snowfall spawn per draw (2 x 150-draw life ~= 300 live). */
export const AMBIENT_SNOW_PER_DRAW = 2;
/** frostbite snowfall life in draws (well past the 2s probe window). */
export const AMBIENT_SNOW_TTL = 150;
/** dune shimmer/streak life in draws (2 per draw ~= 220 live). */
export const AMBIENT_DUNE_TTL = 110;
/** Bird cruise: cross (viewW + margin) in this many draws (~3.5s). */
export const AMBIENT_BIRD_CROSS_DRAWS = 210;
/** Bird spawn margin past the view edge in world px. */
export const AMBIENT_SPAWN_MARGIN = 40;
/** Mote spawn margin past the view edge in world px. */
export const AMBIENT_MOTE_MARGIN = 24;
/** Bird wingspan in screen px (paired 7px rects). */
export const AMBIENT_BIRD_W = 7;
/** Bird body height in screen px. */
export const AMBIENT_BIRD_H = 2;
/** Sand-streak length in screen px (elongated horizontal paint). */
export const AMBIENT_STREAK_LEN = 12;
/** Sand-streak height in screen px. */
export const AMBIENT_STREAK_H = 2;
/** Aurora shimmer period in ms (a 2.6s loop the probes can straddle). */
export const AURORA_SHIMMER_PERIOD_MS = 2600;
/** Aurora shimmer base alpha (fullscreen-width bands, frostbite only). */
export const AURORA_SHIMMER_BASE = 0.2;
/** Aurora shimmer swing (bands breathe base +/- swing). */
export const AURORA_SHIMMER_AMP = 0.1;
/** kilima dust paint (pale tan, translucent). */
export const AMBIENT_DUST_HEX = 0xd6c48f;
/** kilima dust paint as CSS. */
export const AMBIENT_DUST_CSS = "#d6c48f";
/** frostbite snow paint (near-white, reads above the polar night). */
export const AMBIENT_SNOW_HEX = 0xf8fafc;
/** frostbite snow paint as CSS. */
export const AMBIENT_SNOW_CSS = "#f8fafc";
/** dune shimmer paint (pale heat rise, faint). */
export const AMBIENT_SHIMMER_HEX = 0xfff7cc;
/** dune shimmer paint as CSS. */
export const AMBIENT_SHIMMER_CSS = "#fff7cc";
/** dune sand-streak paint (amber wind band). */
export const AMBIENT_STREAK_HEX = 0xe8b06a;
/** dune sand-streak paint as CSS. */
export const AMBIENT_STREAK_CSS = "#e8b06a";
/** kilima bird paint (dark savanna silhouette). */
export const AMBIENT_BIRD_HEX = 0x1e262e;
/** kilima bird paint as CSS. */
export const AMBIENT_BIRD_CSS = "#1e262e";
/** Aurora shimmer band paint (frostbite haze twin). */
export const AURORA_SHIMMER_HEX = 0x9fd4f0;
/** Aurora shimmer band paint as CSS. */
export const AURORA_SHIMMER_CSS = "#9fd4f0";

/** Live mote count (probe shorthand for the snowfall/dust/shimmer bed). */
export function ambientMoteCount(bed: AmbientBed | null | undefined): number {
  if (bed === null || bed === undefined || !Array.isArray(bed.motes)) {
    return 0;
  }
  return bed.motes.length;
}

/** Live bird count (probe shorthand for the kilima crossing pair). */
export function ambientBirdCount(bed: AmbientBed | null | undefined): number {
  if (bed === null || bed === undefined || !Array.isArray(bed.birds)) {
    return 0;
  }
  return bed.birds.length;
}

/**
 * Deterministic unit hash in [0, 1): integer-mix noise from a draw tick
 * and a slot id, so spawn layouts vary per draw without Math.random.
 * Pure: no DOM, no clock, no randomness.
 */
export function ambientHash01(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  let h = (Math.imul(n | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Ambient update arguments (all plain numbers plus theme/quality). */
export interface AmbientUpdate {
  /** Arena theme (tolerant, falls back to kilima). */
  theme: AmbientTheme | unknown;
  /** Post-effect quality (low clears the bed). */
  quality: QualityLevel | unknown;
  /** Sim tick of the current draw (spawn hash basis). */
  tick: number;
  /** Camera focus in world px. */
  camX: number;
  /** Camera focus in world px. */
  camY: number;
  /** Visible world size in px (viewSize of the live camera). */
  viewW: number;
  /** Visible world size in px (viewSize of the live camera). */
  viewH: number;
}

/** Drop expired motes/birds in place. Pure: no DOM, no clock. */
function ageBed(bed: AmbientBed): void {
  for (let i = bed.motes.length - 1; i >= 0; i -= 1) {
    const mote = bed.motes[i] as AmbientMote;
    const age = mote.life - mote.ttl;
    mote.x += mote.vx + mote.sway * Math.sin(age * 0.09 + mote.phase);
    mote.y += mote.vy;
    mote.ttl -= 1;
    if (mote.ttl <= 0) {
      bed.motes.splice(i, 1);
    }
  }
  for (let i = bed.birds.length - 1; i >= 0; i -= 1) {
    const bird = bed.birds[i] as AmbientBird;
    bird.x += bird.vx;
    bird.flap += 1;
    bird.ttl -= 1;
    if (bird.ttl <= 0) {
      bed.birds.splice(i, 1);
    }
  }
}

/**
 * Advance the bed one draw: age the live set, then spawn the theme
 * emitters inside the camera view (plus a margin) on high quality.
 * Low quality clears the bed so the ambient count reads 0. Pure apart
 * from the in-place bed mutation: no DOM, no clock, no randomness.
 */
export function updateAmbientBed(
  bed: AmbientBed | null | undefined,
  opts: AmbientUpdate,
): void {
  if (bed === null || bed === undefined) {
    return;
  }
  if (!Array.isArray(bed.motes) || !Array.isArray(bed.birds)) {
    return;
  }
  if (!ambientEnabled(opts.quality)) {
    bed.motes.length = 0;
    bed.birds.length = 0;
    return;
  }
  ageBed(bed);
  const tick = Number.isFinite(opts.tick) ? Math.floor(opts.tick) : 0;
  const camX = Number(opts.camX);
  const camY = Number(opts.camY);
  const viewW = Number(opts.viewW);
  const viewH = Number(opts.viewH);
  if (
    !Number.isFinite(camX) ||
    !Number.isFinite(camY) ||
    !Number.isFinite(viewW) ||
    viewW <= 0 ||
    !Number.isFinite(viewH) ||
    viewH <= 0
  ) {
    return;
  }
  const theme = ambientThemeFor(opts.theme);
  const m = AMBIENT_MOTE_MARGIN;
  const x0 = camX - viewW / 2 - m;
  const x1 = camX + viewW / 2 + m;
  const y0 = camY - viewH / 2 - m;
  const y1 = camY + viewH / 2 + m;
  if (theme === "kilima") {
    const fx = ambientHash01(tick * 3 + 7);
    const fy = ambientHash01(tick * 5 + 13);
    bed.motes.push({
      x: x0 + fx * (x1 - x0),
      y: y0 + fy * (y1 - y0),
      vx: 0.4 + 0.5 * ambientHash01(tick * 7 + 1),
      vy: -(0.15 + 0.2 * ambientHash01(tick * 11 + 2)),
      ttl: AMBIENT_DUST_TTL,
      life: AMBIENT_DUST_TTL,
      size: 2,
      color: AMBIENT_DUST_HEX,
      css: AMBIENT_DUST_CSS,
      alpha: 0.5,
      sway: 0.25,
      phase: ambientHash01(tick * 17 + 3) * Math.PI * 2,
      kind: "dust",
    });
    // Crossing pair: at most two birds, spawned at the upwind edge (or
    // mid-view for the first of a fresh bed so a restart crosses the
    // mid-band within ~1s). Cruise height stays inside the middle band
    // (+/- viewH/8 around the focus) at every spawn.
    if (bed.birds.length < 2) {
      const dir = ambientHash01(tick * 23 + 5) < 0.5 ? 1 : -1;
      const edgeX =
        dir > 0 ? x0 - AMBIENT_SPAWN_MARGIN : x1 + AMBIENT_SPAWN_MARGIN;
      const speed = (viewW + AMBIENT_SPAWN_MARGIN * 2) / AMBIENT_BIRD_CROSS_DRAWS;
      const life = AMBIENT_BIRD_CROSS_DRAWS + 40;
      bed.birds.push({
        x: bed.birds.length === 0 ? camX - dir * viewW * 0.25 : edgeX,
        y: camY + (ambientHash01(tick * 29 + 9) - 0.5) * viewH * 0.25,
        vx: dir * speed,
        flap: 0,
        ttl: life,
        life,
      });
    }
  } else if (theme === "dune") {
    // Heat shimmer rising off the lower half plus one fast sand streak
    // per draw (constant rightward wind).
    bed.motes.push({
      x: x0 + ambientHash01(tick * 13 + 21) * (x1 - x0),
      y: y0 + (0.4 + 0.6 * ambientHash01(tick * 17 + 31)) * (y1 - y0),
      vx: 0.2,
      vy: -(0.5 + 0.4 * ambientHash01(tick * 19 + 41)),
      ttl: AMBIENT_DUNE_TTL,
      life: AMBIENT_DUNE_TTL,
      size: 2,
      color: AMBIENT_SHIMMER_HEX,
      css: AMBIENT_SHIMMER_CSS,
      alpha: 0.32,
      sway: 0.3,
      phase: ambientHash01(tick * 23 + 51) * Math.PI * 2,
      kind: "shimmer",
    });
    bed.motes.push({
      x: x0 + ambientHash01(tick * 29 + 61) * (x1 - x0),
      y: y0 + ambientHash01(tick * 31 + 71) * (y1 - y0),
      vx: 2.5 + ambientHash01(tick * 37 + 81) * 1.0,
      vy: 0,
      ttl: AMBIENT_DUNE_TTL,
      life: AMBIENT_DUNE_TTL,
      size: AMBIENT_STREAK_LEN,
      color: AMBIENT_STREAK_HEX,
      css: AMBIENT_STREAK_CSS,
      alpha: 0.8,
      sway: 0,
      phase: 0,
      kind: "streak",
    });
  } else {
    // Frostbite snowfall: two flakes per draw along the top edge,
    // falling with a lateral sway.
    for (let k = 0; k < AMBIENT_SNOW_PER_DRAW; k += 1) {
      bed.motes.push({
        x: x0 + ambientHash01(tick * 13 + k * 101 + 91) * (x1 - x0),
        y: y0 - 8 - ambientHash01(tick * 17 + k * 103 + 93) * 20,
        vx: -0.2 + 0.4 * ambientHash01(tick * 19 + k * 107 + 95),
        vy: 0.7 + 0.6 * ambientHash01(tick * 23 + k * 109 + 97),
        ttl: AMBIENT_SNOW_TTL,
        life: AMBIENT_SNOW_TTL,
        size: 2,
        color: AMBIENT_SNOW_HEX,
        css: AMBIENT_SNOW_CSS,
        alpha: 0.95,
        sway: 0.5,
        phase: ambientHash01(tick * 29 + k * 113 + 99) * Math.PI * 2,
        kind: "snow",
      });
    }
  }
  while (bed.motes.length > AMBIENT_MOTE_CAP) {
    bed.motes.shift();
  }
  while (bed.birds.length > AMBIENT_BIRD_CAP) {
    bed.birds.shift();
  }
}

/**
 * Aurora shimmer alpha for a band at nowMs: base +/- swing on a shared
 * 2.6s loop, phase-offset per band so the two bands never peak
 * together. Non-finite stamps read the base. Pure: no DOM.
 */
export function auroraShimmerAlpha(nowMs: number, band: number): number {
  if (!Number.isFinite(nowMs)) {
    return AURORA_SHIMMER_BASE;
  }
  const phase = (2 * Math.PI * nowMs) / AURORA_SHIMMER_PERIOD_MS;
  const offset = Number.isFinite(band) ? band * (Math.PI / 2) : 0;
  return AURORA_SHIMMER_BASE + AURORA_SHIMMER_AMP * Math.sin(phase + offset);
}

/** Minimal Pixi graphics surface (structural, no pixi.js import). */
export interface AmbientPixiGraphics {
  rect(x: number, y: number, w: number, h: number): unknown;
  fill(style: number | { color?: number; alpha?: number }): unknown;
}

/** World-to-screen projection (renderer-owned camera closures). */
export type AmbientProject = (x: number, y: number) => { x: number; y: number };

/**
 * Paint the bed in Pixi: aurora bands (frostbite, time-varying alpha)
 * behind the motes, motes as small rects (streaks elongated), birds as
 * paired dark ticks with a flap offset. No-op on low quality or
 * non-finite dims.
 */
export function paintAmbientPixi(
  graphics: AmbientPixiGraphics,
  bed: AmbientBed | null | undefined,
  theme: AmbientTheme | unknown,
  project: AmbientProject,
  canvasWidth: number,
  canvasHeight: number,
  nowMs: number,
  quality: QualityLevel | unknown,
): void {
  if (!ambientEnabled(quality)) {
    return;
  }
  if (
    bed === null ||
    bed === undefined ||
    !Array.isArray(bed.motes) ||
    !Array.isArray(bed.birds)
  ) {
    return;
  }
  if (
    !Number.isFinite(canvasWidth) ||
    canvasWidth <= 0 ||
    !Number.isFinite(canvasHeight) ||
    canvasHeight <= 0
  ) {
    return;
  }
  if (ambientThemeFor(theme) === "frostbite") {
    for (let band = 0; band < 2; band += 1) {
      graphics.rect(0, canvasHeight * (0.24 + band * 0.1), canvasWidth, canvasHeight * 0.05);
      graphics.fill({
        color: AURORA_SHIMMER_HEX,
        alpha: auroraShimmerAlpha(nowMs, band),
      });
    }
  }
  for (const mote of bed.motes) {
    if (mote.ttl <= 0) {
      continue;
    }
    const s = project(mote.x, mote.y);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
      continue;
    }
    if (mote.kind === "streak") {
      graphics.rect(s.x, s.y, AMBIENT_STREAK_LEN, AMBIENT_STREAK_H);
    } else {
      const r = Math.max(1.5, mote.size);
      graphics.rect(s.x, s.y, r, r);
    }
    graphics.fill({ color: mote.color, alpha: mote.alpha });
  }
  for (const bird of bed.birds) {
    if (bird.ttl <= 0) {
      continue;
    }
    const s = project(bird.x, bird.y);
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
      continue;
    }
    const wing = bird.flap % 20 < 10 ? 0 : -2;
    graphics.rect(s.x - AMBIENT_BIRD_W, s.y, AMBIENT_BIRD_W, AMBIENT_BIRD_H);
    graphics.fill(AMBIENT_BIRD_HEX);
    graphics.rect(s.x, s.y + wing, AMBIENT_BIRD_W, AMBIENT_BIRD_H);
    graphics.fill(AMBIENT_BIRD_HEX);
  }
}

/**
 * Paint the bed on a 2D canvas (mirrors paintAmbientPixi). No-op on low
 * quality or non-finite dims.
 */
export function paintAmbient2D(
  ctx: CanvasRenderingContext2D,
  bed: AmbientBed | null | undefined,
  theme: AmbientTheme | unknown,
  project: AmbientProject,
  canvasWidth: number,
  canvasHeight: number,
  nowMs: number,
  quality: QualityLevel | unknown,
): void {
  if (!ambientEnabled(quality)) {
    return;
  }
  if (
    bed === null ||
    bed === undefined ||
    !Array.isArray(bed.motes) ||
    !Array.isArray(bed.birds)
  ) {
    return;
  }
  if (
    !Number.isFinite(canvasWidth) ||
    canvasWidth <= 0 ||
    !Number.isFinite(canvasHeight) ||
    canvasHeight <= 0
  ) {
    return;
  }
  const prevAlpha = ctx.globalAlpha;
  const prevStyle = ctx.fillStyle;
  try {
    if (ambientThemeFor(theme) === "frostbite") {
      ctx.fillStyle = AURORA_SHIMMER_CSS;
      for (let band = 0; band < 2; band += 1) {
        ctx.globalAlpha = auroraShimmerAlpha(nowMs, band);
        ctx.fillRect(
          0,
          canvasHeight * (0.24 + band * 0.1),
          canvasWidth,
          canvasHeight * 0.05,
        );
      }
    }
    for (const mote of bed.motes) {
      if (mote.ttl <= 0) {
        continue;
      }
      const s = project(mote.x, mote.y);
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
        continue;
      }
      ctx.globalAlpha = mote.alpha;
      ctx.fillStyle = mote.css;
      if (mote.kind === "streak") {
        ctx.fillRect(s.x, s.y, AMBIENT_STREAK_LEN, AMBIENT_STREAK_H);
      } else {
        const r = Math.max(1.5, mote.size);
        ctx.fillRect(s.x, s.y, r, r);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = AMBIENT_BIRD_CSS;
    for (const bird of bed.birds) {
      if (bird.ttl <= 0) {
        continue;
      }
      const s = project(bird.x, bird.y);
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
        continue;
      }
      const wing = bird.flap % 20 < 10 ? 0 : -2;
      ctx.fillRect(s.x - AMBIENT_BIRD_W, s.y, AMBIENT_BIRD_W, AMBIENT_BIRD_H);
      ctx.fillRect(s.x, s.y + wing, AMBIENT_BIRD_W, AMBIENT_BIRD_H);
    }
  } finally {
    ctx.globalAlpha = prevAlpha;
    ctx.fillStyle = prevStyle;
  }
}
