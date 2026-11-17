// Bot silhouette variety: distinct `platformer-characters` pack sets per
// bot index with roster tinting.
//
// Bots render from the Adventurer / Zombie / Female / Player families of
// the same Kenney `platformer-characters` pack (CC0) the soldier swap
// uses, so identical bots stop reading as clones while staying
// team-readable: every bot index maps to a distinct set, the run/idle
// animation still plays through that set's walk/stand/skid cards, and
// the per-roster palette swap (render/soldier.ts tintSoldierPixel over
// soldierTintHue) keeps torsos warm for enemies with dark outlines.
//
// DOM/Pixi-free: every helper takes plain numbers and strings, so the
// module stays unit-testable under node like render/soldier.ts. Image
// loading and canvas tinting live in renderer/index.ts; this module only
// names textures, anchors, and the set mapping the probes drive.

/** Vendor pack backing every bot family (Kenney CC0, same as soldier). */
export const BOT_PACK = "platformer-characters";

/**
 * Bot silhouette sets in roster order. Bot slot 0 renders Adventurer,
 * slot 1 Zombie, slot 2 Female, slot 3 Player, then the order repeats,
 * so a 3-bot match always fields three pairwise-distinct silhouettes.
 */
export const BOT_SETS = [
  "adventurer",
  "zombie",
  "female",
  "player",
] as const;

/** One bot silhouette set (one `platformer-characters` family). */
export type BotSet = (typeof BOT_SETS)[number];

/** Pack family directory per bot set inside the vendor tree. */
export const BOT_SET_DIRS: Record<BotSet, string> = {
  adventurer: "platformer-characters/PNG/Adventurer",
  zombie: "platformer-characters/PNG/Zombie",
  female: "platformer-characters/PNG/Female",
  player: "platformer-characters/PNG/Player",
};

/** Atlas family subdirectory holding the staged bot PNGs. */
export const BOT_ATLAS_DIR = "characters";

/**
 * Four-frame run cycle per bot set (platformer-characters
 * walk1/walk2/stand/skid, mirroring the soldier run mapping so every
 * bot run key always resolves through the atlas manifest).
 */
export const ADVENTURER_RUN_KEYS = [
  "adventurer.run.0",
  "adventurer.run.1",
  "adventurer.run.2",
  "adventurer.run.3",
] as const;
export const ZOMBIE_RUN_KEYS = [
  "zombie.run.0",
  "zombie.run.1",
  "zombie.run.2",
  "zombie.run.3",
] as const;
export const FEMALE_RUN_KEYS = [
  "female.run.0",
  "female.run.1",
  "female.run.2",
  "female.run.3",
] as const;
export const PLAYER_RUN_KEYS = [
  "player.run.0",
  "player.run.1",
  "player.run.2",
  "player.run.3",
] as const;

/** Run-cycle texture keys per bot set. */
export const BOT_RUN_KEYS: Record<BotSet, readonly string[]> = {
  adventurer: ADVENTURER_RUN_KEYS,
  zombie: ZOMBIE_RUN_KEYS,
  female: FEMALE_RUN_KEYS,
  player: PLAYER_RUN_KEYS,
};

/** One bot run-cycle texture key. */
export type BotRunKey = string;

/**
 * Full in-match pose textures per bot set (every key exists in the
 * vendor manifest). Hurt rides `<set>.fall` (a distinct flinch card)
 * while death rides `<set>.hurt`; the white hurt flash overlays on top.
 */
export const BOT_SPRITE_KEYS: Record<BotSet, Record<string, string>> = {
  adventurer: {
    idle: "adventurer.idle",
    run0: "adventurer.run.0",
    run1: "adventurer.run.1",
    run2: "adventurer.run.2",
    run3: "adventurer.run.3",
    jet: "adventurer.jet",
    crouch: "adventurer.crouch",
    hurt: "adventurer.fall",
    dead: "adventurer.dead",
  },
  zombie: {
    idle: "zombie.idle",
    run0: "zombie.run.0",
    run1: "zombie.run.1",
    run2: "zombie.run.2",
    run3: "zombie.run.3",
    jet: "zombie.jet",
    crouch: "zombie.crouch",
    hurt: "zombie.fall",
    dead: "zombie.dead",
  },
  female: {
    idle: "female.idle",
    run0: "female.run.0",
    run1: "female.run.1",
    run2: "female.run.2",
    run3: "female.run.3",
    jet: "female.jet",
    crouch: "female.crouch",
    hurt: "female.fall",
    dead: "female.dead",
  },
  player: {
    idle: "player.idle",
    run0: "player.run.0",
    run1: "player.run.1",
    run2: "player.run.2",
    run3: "player.run.3",
    jet: "player.jet",
    crouch: "player.crouch",
    hurt: "player.fall",
    dead: "player.dead",
  },
};

/**
 * Staged atlas file per bot texture key (mirrors the allowlist: the
 * vendor basename staged under characters/, so no two sets collide).
 */
export const BOT_SPRITE_FILES: Record<string, string> = {
  "adventurer.idle": "characters/adventurer_idle.png",
  "adventurer.run.0": "characters/adventurer_walk1.png",
  "adventurer.run.1": "characters/adventurer_walk2.png",
  "adventurer.run.2": "characters/adventurer_stand.png",
  "adventurer.run.3": "characters/adventurer_skid.png",
  "adventurer.jet": "characters/adventurer_jump.png",
  "adventurer.crouch": "characters/adventurer_duck.png",
  "adventurer.fall": "characters/adventurer_fall.png",
  "adventurer.dead": "characters/adventurer_hurt.png",
  "zombie.idle": "characters/zombie_idle.png",
  "zombie.run.0": "characters/zombie_walk1.png",
  "zombie.run.1": "characters/zombie_walk2.png",
  "zombie.run.2": "characters/zombie_stand.png",
  "zombie.run.3": "characters/zombie_skid.png",
  "zombie.jet": "characters/zombie_jump.png",
  "zombie.crouch": "characters/zombie_duck.png",
  "zombie.fall": "characters/zombie_fall.png",
  "zombie.dead": "characters/zombie_hurt.png",
  "female.idle": "characters/female_idle.png",
  "female.run.0": "characters/female_walk1.png",
  "female.run.1": "characters/female_walk2.png",
  "female.run.2": "characters/female_stand.png",
  "female.run.3": "characters/female_skid.png",
  "female.jet": "characters/female_jump.png",
  "female.crouch": "characters/female_duck.png",
  "female.fall": "characters/female_fall.png",
  "female.dead": "characters/female_hurt.png",
  "player.idle": "characters/player_idle.png",
  "player.run.0": "characters/player_walk1.png",
  "player.run.1": "characters/player_walk2.png",
  "player.run.2": "characters/player_stand.png",
  "player.run.3": "characters/player_skid.png",
  "player.jet": "characters/player_jump.png",
  "player.crouch": "characters/player_duck.png",
  "player.fall": "characters/player_fall.png",
  "player.dead": "characters/player_hurt.png",
};

/** File for one bot texture key (null when unknown). */
export function botSpriteFile(key: string): string | null {
  return BOT_SPRITE_FILES[key] ?? null;
}

/**
 * Silhouette set for a 0-based bot slot. Wraps around the roster order
 * so slots 0/1/2 (a 3-bot match) always read Adventurer/Zombie/Female.
 * Pure.
 */
export function botSetForSlot(slot: number): BotSet {
  const count = BOT_SETS.length;
  const idx = ((Math.floor(slot) % count) + count) % count;
  return BOT_SETS[idx] ?? BOT_SETS[0];
}

/**
 * Silhouette set for a match player index. Index 0 is the local soldier
 * (never a bot) and reads the first set as a fallback; bot indices map
 * slot (index - 1) onto the roster order so consecutive bots stay
 * distinct. Pure.
 */
export function botSetForPlayer(playerIndex: number): BotSet {
  if (!Number.isFinite(playerIndex) || playerIndex <= 0) {
    return BOT_SETS[0];
  }
  return botSetForSlot(Math.floor(playerIndex) - 1);
}

/**
 * Resolve the run-cycle texture for a bot set and leg phase. Quadrants
 * advance run.0 -> run.1 -> run.2 -> run.3 so a full stride reads as 4+
 * frames; negative phases wrap. Pure.
 */
export function botRunKey(set: BotSet, legPhase: number): BotRunKey {
  const keys = BOT_RUN_KEYS[set] ?? BOT_RUN_KEYS["adventurer"];
  const idx =
    ((Math.floor((legPhase ?? 0) / (Math.PI / 2)) % 4) + 4) % 4;
  return keys[idx] ?? keys[0];
}

/** Pose fields the bot sprite resolver reads. */
export interface BotSpritePose {
  deadPose?: boolean;
  tuck?: boolean;
  crouching?: boolean;
  heightScale?: number;
  legPhase?: number;
  swing?: number;
  hurtFlash?: boolean;
}

/**
 * Resolve the manifest texture key for a bot pose and player index. Dead
 * wins, then crouch, then the jet tuck, then the 4-frame run cycle while
 * the legs swing (hurt flashes ride `<set>.fall`), else `<set>.idle`.
 * The returned key always carries its set family
 * (`<set>.run.*` for running) so probes can match on the run suffix.
 * Pure.
 */
export function botSpriteKey(
  pose: BotSpritePose,
  playerIndex: number,
): string {
  const set = botSetForPlayer(playerIndex);
  const keys = BOT_SPRITE_KEYS[set] ?? BOT_SPRITE_KEYS["adventurer"];
  if (pose.deadPose === true) {
    return keys["dead"] as string;
  }
  if (
    pose.crouching === true ||
    (pose.heightScale !== undefined && pose.heightScale < 1)
  ) {
    return keys["crouch"] as string;
  }
  if (pose.tuck === true) {
    return keys["jet"] as string;
  }
  if (Math.abs(pose.swing ?? 0) < 0.5) {
    if (pose.hurtFlash === true) {
      return keys["hurt"] as string;
    }
    return keys["idle"] as string;
  }
  if (pose.hurtFlash === true) {
    return keys["hurt"] as string;
  }
  return botRunKey(set, pose.legPhase ?? 0);
}
