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
// Explosives tuning (issue #8): rockets fly straight with splash, grenades
// throw/bounce on a fuse, barrels chain-explode. Pure literals only.
export const GRENADE_THROW_SPEED_PX_S = 760;
export const GRENADE_GRAVITY = 1300;
export const GRENADE_BOUNCE = 0.45;
export const GRENADE_DAMAGE = 115;
export const GRENADE_RADIUS_PX = 165;
export const GRENADE_FUSE_TICKS = 144;
export const GRENADE_COOLDOWN_TICKS = 36;
export const GRENADE_MAX = 3;
export const ROCKET_SPEED_PX_S = 900;
export const BARREL_HP = 30;
export const BARREL_W = 26;
export const BARREL_H = 34;
export const BARREL_RESPAWN_TICKS = 1800;
export const BARREL_EXPLODE_DAMAGE = 80;
export const BARREL_EXPLODE_RADIUS_PX = 120;
export const CRATE_HP = 60;
export const CRATE_W = 30;
export const CRATE_H = 30;
export const CRATE_RESPAWN_TICKS = 1500;
// Pickup tuning (issue #9): weapon/health/grenade pads with timed respawns.
// Respawn ticks derive from TICK_HZ: 15s weapon pads, 20s sustain pads.
export const PICKUP_RADIUS_PX = 22;
export const WEAPON_RESPAWN_TICKS = 900;
export const HEALTH_RESPAWN_TICKS = 1200;
export const GRENADE_PICKUP_RESPAWN_TICKS = 1200;
export const HEALTH_PICKUP_AMOUNT = 50;
export const GRENADE_PICKUP_AMOUNT = 2;
// FFA match tuning (issue #10): 25-kill cap, 5 min cap at 60 Hz.
export const MATCH_SCORE_LIMIT = 25;
export const MATCH_TIME_LIMIT_TICKS = 18000;
// Health / regen / respawn tuning.
export const HEALTH_MAX = 100;
export const HEALTH_REGEN_PER_S = 10;
export const HEALTH_REGEN_DELAY_TICKS = 300;
export const RESPAWN_TICKS = 180;
export const PROTECTION_TICKS = 90;
