// Deterministic tuning constants — the single source of truth for the sim.
//
// The sim is sacred: this module is pure data (export const literals only,
// no imports, no functions) so tuning never leaks DOM, Node, clock, or
// Math.random behavior into packages/core. Values frozen from RECON.md.

// Fixed-timestep tick rate for the whole game (see RECON.md).
export const TICK_HZ = 60;
// Aim is quantized to 4096 steps around the circle.
export const AIM_STEPS = 4096;
// moveX is quantized to 1/64 steps in [-1, 1].
export const MOVE_X_QUANT = 1 / 64;
// Physics.
export const GRAVITY = 1550;
export const MAX_FALL = 1150;
export const GROUND_ACCEL = 2600;
export const GROUND_FRICTION = 2300;
export const AIR_ACCEL = 1500;
export const AIR_DRAG = 160;
// Movement.
export const RUN_SPEED = 290;
export const CROUCH_SPEED = 120;
export const HOP_SPEED = 300;
export const PLAYER_WIDTH = 26;
export const PLAYER_HEIGHT = 58;
export const PLAYER_CROUCH_HEIGHT = 40;
// Jetpack.
export const JETPACK_ACCEL = 3350;
export const JETPACK_MAX_UP = 470;
export const JETPACK_FUEL_MAX = 100;
export const JETPACK_BURN_PER_S = 34;
export const JETPACK_REGEN_GROUND_PER_S = 60;
export const JETPACK_REGEN_AIR_PER_S = 14;
export const JETPACK_REGEN_DELAY_S = 0.35;
export const JETPACK_MIN_FUEL_TO_START = 8;
// Weapon timing (intervals in ticks).
export const WEAPON_PISTOL_INTERVAL_TICKS = 14;
export const WEAPON_SMG_INTERVAL_TICKS = 5;
export const WEAPON_RIFLE_INTERVAL_TICKS = 7;
export const WEAPON_SHOTGUN_INTERVAL_TICKS = 30;
export const WEAPON_SNIPER_INTERVAL_TICKS = 60;
export const WEAPON_ROCKET_INTERVAL_TICKS = 54;
export const WEAPON_RICOCHET_INTERVAL_TICKS = 22;
export const WEAPON_VORTEX_INTERVAL_TICKS = 50;
export const WEAPON_RHINO_INTERVAL_TICKS = 3;
// Melee / grenade timing.
export const MELEE_COOLDOWN_S = 0.5;
export const GRENADE_COOLDOWN_S = 0.6;
export const GRENADE_FUSE_S = 2.4;
