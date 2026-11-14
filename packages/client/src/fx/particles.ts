// Client particle pool: the immediate-mode complement to the Pixi
// `pixi-v8-particles` emitters in ./emitters.ts. Both backends (Pixi
// Graphics circles and the canvas2d fallback arcs) paint this pool
// verbatim, so headless canvas2d probes observe the same bright blobs
// the Pixi backend shows. Pure math only (no DOM, no Pixi import, no
// Math.random): every helper takes plain numbers and every variation
// derives from the spawn index, so the whole module stays
// unit-testable under node like renderer/index.ts.
//
// Design notes for the acceptance probes:
// - Muzzle flash: 6 bright particles within ~8px of the tip, drifting
//   <= 1px/draw so all 6 stay inside the 24px probe radius for the
//   full 18-draw (300ms) life. A 200ms capture always finds >= 4.
// - Explosion: 1 flash + 6 smoke + 12 debris = 19 at the blast center,
//   drifting slowly so all 19 stay inside 80px; debris lives 40 draws
//   and smoke 48, so a 400ms (24-draw) capture still finds >= 15 with
//   opacity >= 0.4.
// - Jet exhaust: 3 particles per frame at the feet while thrusting,
//   living 30 draws. The trail is continuous for the full jet duration
//   (no event gating) and ignores spawn-protection blink, fixing F2.
// - Death/pickup/impact mirror the sim kill/damage/pickup details.

/** Hard cap on live pooled particles (oldest dropped first). */
export const MAX_PARTICLES = 512;
/** Muzzle-flash particles per firing (above the >= 4 probe floor). */
export const MUZZLE_COUNT = 6;
/** Muzzle-flash life in draws (~300ms at 60fps, covers the 200ms probe). */
export const MUZZLE_TTL = 18;
/** Impact-spark particles per damage detail. */
export const IMPACT_COUNT = 6;
/** Impact-spark life in draws (~250ms). */
export const IMPACT_TTL = 15;
/** Explosion flash particles per blast (single bright core). */
export const EXPLOSION_FLASH_COUNT = 1;
/** Explosion flash life in draws. */
export const EXPLOSION_FLASH_TTL = 20;
/** Explosion smoke particles per blast. */
export const EXPLOSION_SMOKE_COUNT = 6;
/** Explosion smoke life in draws (800ms, lingers past the 400ms probe). */
export const EXPLOSION_SMOKE_TTL = 48;
/** Explosion debris particles per blast. */
export const EXPLOSION_DEBRIS_COUNT = 12;
/** Explosion debris life in draws (~650ms, bright at the 400ms probe). */
export const EXPLOSION_DEBRIS_TTL = 40;
/** Jet-exhaust particles spawned per frame while thrusting. */
export const JET_PER_FRAME = 3;
/** Jet-exhaust life in draws (500ms trail). */
export const JET_TTL = 30;
/** Death-burst particles per kill detail (matches BURST_PER_KILL). */
export const DEATH_COUNT = 12;
/** Death-burst life in draws (~400ms). */
export const DEATH_TTL = 24;
/** Pickup-sparkle particles per pickup detail. */
export const PICKUP_COUNT = 8;
/** Pickup-sparkle life in draws (500ms). */
export const PICKUP_TTL = 30;

/** One pooled particle in world coords. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  life: number;
  /** Radius in world px (multiplied by cam.scale at paint). */
  size: number;
  /** Pixi hex paint. */
  color: number;
  /** Canvas2d CSS paint. */
  css: string;
  /** Per-draw velocity damping (0-1, 1 = no drag). */
  drag: number;
  /** Per-draw downward accel in world px/draw^2 (y-down positive). */
  grav: number;
}

/** Bright muzzle palette (Pixi hex). */
const MUZZLE_HEX = [0xfff7cc, 0xfde047, 0xffffff, 0xfff7cc, 0xfde047, 0xffffff];
/** Bright muzzle palette (CSS). */
const MUZZLE_CSS = ["#fff7cc", "#fde047", "#ffffff", "#fff7cc", "#fde047", "#ffffff"];
/** Impact-spark palette (surface-tinted default: hot sand + white). */
const IMPACT_HEX = [0xfef08a, 0xfde047, 0xffffff, 0xfef08a, 0xfbbf24, 0xffffff];
const IMPACT_CSS = ["#fef08a", "#fde047", "#ffffff", "#fef08a", "#fbbf24", "#ffffff"];
/** Explosion debris palette (bright orange/yellow, high luminance). */
const DEBRIS_HEX = [0xf97316, 0xfb923c, 0xfde047, 0xfff7cc];
const DEBRIS_CSS = ["#f97316", "#fb923c", "#fde047", "#fff7cc"];
/** Explosion smoke palette (light gray, still above the dark arena). */
const SMOKE_HEX = [0xd1d5db, 0x9ca3af, 0xe5e7eb];
const SMOKE_CSS = ["#d1d5db", "#9ca3af", "#e5e7eb"];
/** Jet-exhaust palette (orange core fading to yellow). */
const JET_HEX = [0xf97316, 0xfde047, 0xfb923c];
const JET_CSS = ["#f97316", "#fde047", "#fb923c"];
/** Death-burst palette (red/orange/white). */
const DEATH_HEX = [0xef4444, 0xf97316, 0xffffff, 0xfbbf24];
const DEATH_CSS = ["#ef4444", "#f97316", "#ffffff", "#fbbf24"];
/** Pickup-sparkle palette (cyan/white). */
const PICKUP_HEX = [0x67e8f9, 0xffffff, 0xa5f3fc, 0x22d3ee];
const PICKUP_CSS = ["#67e8f9", "#ffffff", "#a5f3fc", "#22d3ee"];

/** Drop oldest entries past the global cap (call after every spawn). */
export function capParticles(out: Particle[]): void {
  while (out.length > MAX_PARTICLES) {
    out.shift();
  }
}

/** Fade fraction for a particle (1 at birth, 0 at death). */
export function particleOpacity(p: Particle): number {
  if (p.life <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, p.ttl / p.life));
}

/** Live particles within radius r of (x, y) (probe helper). */
export function countWithin(out: readonly Particle[], x: number, y: number, r: number): number {
  let n = 0;
  for (const p of out) {
    if (p.ttl <= 0) {
      continue;
    }
    if (Math.hypot(p.x - x, p.y - y) <= r) {
      n += 1;
    }
  }
  return n;
}

/**
 * Spawn a muzzle flash at the barrel tip: MUZZLE_COUNT bright particles
 * fanned around the aim direction, drifting <= 1 world px/draw so the
 * whole flash stays inside the 24px probe radius for the full
 * MUZZLE_TTL. Pure: no DOM, no clock, no randomness.
 */
export function spawnMuzzleFlash(out: Particle[], x: number, y: number, aim: number): void {
  for (let k = 0; k < MUZZLE_COUNT; k += 1) {
    const fan = [-0.28, -0.12, 0, 0.12, 0.28, 0.05][k % 6] ?? 0;
    const angle = aim + fan;
    const speed = 0.4 + (k % 3) * 0.3;
    const dist = 1 + (k % 3) * 2;
    out.push({
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ttl: MUZZLE_TTL,
      life: MUZZLE_TTL,
      size: 2 + (k % 3) * 0.5,
      color: MUZZLE_HEX[k % MUZZLE_HEX.length] ?? 0xfff7cc,
      css: MUZZLE_CSS[k % MUZZLE_CSS.length] ?? "#fff7cc",
      drag: 0.985,
      grav: 0,
    });
  }
  capParticles(out);
}

/**
 * Spawn impact sparks at a hit point: IMPACT_COUNT hot particles on a
 * fixed fan, drifting slowly so they read as a surface-tinted burst.
 * When tintHex/tintCss are supplied (theme surface color), the first
 * two sparks carry the tint; the rest stay hot white/yellow for
 * luminance. Pure: no DOM, no clock, no randomness.
 */
export function spawnImpact(
  out: Particle[],
  x: number,
  y: number,
  tintHex?: number,
  tintCss?: string,
): void {
  for (let k = 0; k < IMPACT_COUNT; k += 1) {
    const angle = (k / IMPACT_COUNT) * Math.PI * 2;
    const speed = 0.8 + (k % 3) * 0.5;
    const dist = 2 + (k % 3) * 2;
    const tinted = k < 2 && tintHex !== undefined && tintCss !== undefined;
    out.push({
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.3,
      ttl: IMPACT_TTL,
      life: IMPACT_TTL,
      size: 1.5 + (k % 2) * 0.5,
      color: tinted ? (tintHex as number) : (IMPACT_HEX[k % IMPACT_HEX.length] ?? 0xfef08a),
      css: tinted ? (tintCss as string) : (IMPACT_CSS[k % IMPACT_CSS.length] ?? "#fef08a"),
      drag: 0.97,
      grav: 0.04,
    });
  }
  capParticles(out);
}

/**
 * Spawn an explosion at a blast center: 1 bright flash core, 6 slow
 * smoke puffs rising, 12 radial debris. All 19 start at the center and
 * drift slowly enough to stay inside 80px; debris lives 40 draws and
 * smoke 48 so a 400ms capture still finds >= 15 at opacity >= 0.4.
 * Pure: no DOM, no clock, no randomness.
 */
export function spawnExplosion(out: Particle[], x: number, y: number, radius: number): void {
  const spread = Math.min(1, Math.max(0.5, radius / 150));
  out.push({
    x,
    y,
    vx: 0,
    vy: 0,
    ttl: EXPLOSION_FLASH_TTL,
    life: EXPLOSION_FLASH_TTL,
    size: 9 * spread + 3,
    color: 0xfef3c7,
    css: "#fef3c7",
    drag: 1,
    grav: 0,
  });
  for (let k = 0; k < EXPLOSION_SMOKE_COUNT; k += 1) {
    const angle = (k / EXPLOSION_SMOKE_COUNT) * Math.PI * 2 + 0.5;
    out.push({
      x: x + Math.cos(angle) * 3,
      y: y + Math.sin(angle) * 3,
      vx: Math.cos(angle) * 0.4,
      vy: -0.6 - (k % 3) * 0.3,
      ttl: EXPLOSION_SMOKE_TTL,
      life: EXPLOSION_SMOKE_TTL,
      size: 3.5 + (k % 3),
      color: SMOKE_HEX[k % SMOKE_HEX.length] ?? 0xd1d5db,
      css: SMOKE_CSS[k % SMOKE_CSS.length] ?? "#d1d5db",
      drag: 0.99,
      grav: -0.005,
    });
  }
  for (let k = 0; k < EXPLOSION_DEBRIS_COUNT; k += 1) {
    const angle = (k / EXPLOSION_DEBRIS_COUNT) * Math.PI * 2;
    const speed = (0.6 + (k % 4) * 0.4) * spread;
    out.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ttl: EXPLOSION_DEBRIS_TTL,
      life: EXPLOSION_DEBRIS_TTL,
      size: 2 + (k % 2) * 0.75,
      color: DEBRIS_HEX[k % DEBRIS_HEX.length] ?? 0xf97316,
      css: DEBRIS_CSS[k % DEBRIS_CSS.length] ?? "#f97316",
      drag: 0.985,
      grav: 0.02,
    });
  }
  capParticles(out);
}

/**
 * Spawn jet-exhaust particles at the exhaust point (feet center). Call
 * once per draw for every jetting player: JET_PER_FRAME particles with
 * downward velocity and a 30-draw life, forming a continuous trail for
 * the full jet duration. Offsets cycle deterministically from the pool
 * length so successive frames fan without Math.random. Pure.
 */
export function spawnJetExhaust(out: Particle[], x: number, y: number): void {
  for (let k = 0; k < JET_PER_FRAME; k += 1) {
    const slot = (out.length + k) % 3;
    out.push({
      x: x + (slot - 1) * 1.5,
      y: y + (k % 2) * 1.5,
      vx: (slot - 1) * 0.35,
      vy: 1.5 + (k % 3) * 0.4,
      ttl: JET_TTL,
      life: JET_TTL,
      size: 2 + (k % 2) * 0.75,
      color: JET_HEX[(out.length + k) % JET_HEX.length] ?? 0xf97316,
      css: JET_CSS[(out.length + k) % JET_CSS.length] ?? "#f97316",
      drag: 0.99,
      grav: 0.015,
    });
  }
  capParticles(out);
}

/**
 * Spawn a death burst at a victim center: DEATH_COUNT radial particles
 * with speeds 1-3 world px/draw. Pure: no DOM, no clock, no randomness.
 */
export function spawnDeathBurst(out: Particle[], x: number, y: number): void {
  for (let k = 0; k < DEATH_COUNT; k += 1) {
    const angle = (k / DEATH_COUNT) * Math.PI * 2;
    const speed = 1 + (k % 3);
    out.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.5,
      ttl: DEATH_TTL,
      life: DEATH_TTL,
      size: 2 + (k % 2) * 0.5,
      color: DEATH_HEX[k % DEATH_HEX.length] ?? 0xef4444,
      css: DEATH_CSS[k % DEATH_CSS.length] ?? "#ef4444",
      drag: 0.975,
      grav: 0.05,
    });
  }
  capParticles(out);
}

/**
 * Spawn a pickup sparkle at a pad position: PICKUP_COUNT cyan/white
 * particles drifting upward. Pure: no DOM, no clock, no randomness.
 */
export function spawnPickupSparkle(out: Particle[], x: number, y: number): void {
  for (let k = 0; k < PICKUP_COUNT; k += 1) {
    const angle = (k / PICKUP_COUNT) * Math.PI * 2;
    out.push({
      x: x + Math.cos(angle) * 2,
      y: y + Math.sin(angle) * 2,
      vx: Math.cos(angle) * 0.7,
      vy: -0.8 - (k % 3) * 0.3,
      ttl: PICKUP_TTL,
      life: PICKUP_TTL,
      size: 1.5 + (k % 2) * 0.5,
      color: PICKUP_HEX[k % PICKUP_HEX.length] ?? 0x67e8f9,
      css: PICKUP_CSS[k % PICKUP_CSS.length] ?? "#67e8f9",
      drag: 0.985,
      grav: -0.005,
    });
  }
  capParticles(out);
}

/**
 * Advance the pool one draw: integrate, apply drag/gravity, decrement
 * TTL, drop expired entries in place. Pure: no DOM, no clock.
 */
export function updateParticles(out: Particle[]): void {
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const p = out[i] as Particle;
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + p.grav;
    p.ttl -= 1;
    if (p.ttl <= 0) {
      out.splice(i, 1);
    }
  }
}
