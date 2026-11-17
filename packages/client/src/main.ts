// Scrapline browser client: PixiJS v8 app driving the exact deterministic
// core at 60 Hz. The menu overlay and the input mirror are plain DOM/JS
// wired synchronously at load; the renderer is a bundled progressive
// enhancement (Pixi v8 with a 2D canvas fallback) that never gates input.

import {
  GRENADE_MAX,
  JETPACK_FUEL_MAX,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "../../core/src/constants";
import {
  BUTTON_FIRE,
  TICK_HZ,
  World,
  type WorldInput,
} from "../../core/src/world";
import type {
  DamageDetail,
  ExplodeDetail,
  KillDetail,
  PickupDetail,
  ShotDetail,
} from "../../core/src/events";
import { BotBrain } from "../../core/src/bots/brain";
import { standingsFor } from "../../core/src/match";
import {
  DEFAULT_PROFILE,
  awardMatchXp,
  bindProfile,
  loadProfile,
  saveProfile,
  updateProfileBadge,
  type Profile,
} from "./meta/profile";
import {
  bindChallenges,
  collectDueXp,
  defaultChallengeState,
  dayIdFor,
  loadChallenges,
  recordKill,
  recordWin,
  saveChallenges,
  updateChallengesPanel,
  type ChallengeState,
} from "./meta/challenges";
import { mapRowsFor } from "./maps";
import { setCurrentTheme } from "./view/theme";
import {
  DEFAULT_SETUP,
  bindSetup,
  loadSetup,
  parseSetup,
  saveSetup,
  setupSearchParams,
  type SetupConfig,
  type SetupStorage,
} from "./setup";
import {
  DEFAULT_COSMETICS,
  enemyCosmeticsFor,
  loadCosmetics,
  saveCosmetics,
} from "./cosmetics";
import {
  DEFAULT_LOCKER_ID,
  bindLocker,
  loadLockerSelection,
  lockerItemFor,
} from "./meta/locker";
import { setLocalAccent } from "./view/soldier";
import { bindSettings, loadQuality, loadShowNameTags, parseVolume } from "./settings";
import { bindMenuScene } from "./menu/scene";
import { bindOnline } from "./net/online";
import { bindCarousel } from "./menu/carousel";
import { bindMenuTips } from "./menu/tips";
import {
  ensureAudioOnGesture,
  groupShotWeapons,
  playBounce,
  playDryFire,
  playExplosion,
  playGrunt,
  playHop,
  playKill,
  playLand,
  playMatchEnd,
  playMatchStart,
  playPickup,
  playReload,
  playShot,
  setJetting,
  setVolume,
} from "./audio/engine";
import {
  musicTensionFor,
  playEndStinger,
  setMusicVolume,
  setTension01,
  startMatchMusic,
  startMenuMusic,
} from "./audio/music";
import {
  applyKeyEvent,
  applyMouseButton,
  applyMouseMove,
  createKeyState,
  stateAim,
  toInput,
  type InputMirror,
} from "./input";
import {
  createGamepadState,
  createGamepadTracker,
  mergeGamepad,
  readGamepad,
  trackConnected,
  trackSwap,
  type GamepadLike,
  type GamepadState,
} from "./gamepad";
import { buildToast, showToast, type ToastHandles } from "./ui/toast";
import { createRenderer, type Renderer } from "./renderer/index";
import {
  activeSoldierTexture,
  debugSoldierFrame,
  debugTextureOverride,
} from "./render/soldier";
import { weaponSpriteKey } from "./render/weapons";
import { loadAtlas } from "./atlas";
import { registerServiceWorker } from "./pwa";
import {
  hasWebGLSupport,
  hideNoscript,
  syncNoscriptFallback,
} from "./boot";
import { DISPLAY_FONT_FAMILY, publishFonts } from "./ui/fonts";
import {
  applyLetterbox,
  BASE_H,
  BASE_W,
  computeLetterboxFit,
  currentRendererResolution,
} from "./view/resize";
import {
  addTrauma,
  cameraTarget,
  createCamera,
  cycleZoom,
  EXPLODE_SHAKE_RADIUS,
  matchSpawnXs,
  projectCamera,
  rocketLaunchedSince,
  updateCamera,
  viewSize,
  type Camera,
} from "./renderer/camera";
import {
  CHARACTER_H,
  CHARACTER_W,
  ENEMY_A_CSS,
  LOCAL_CSS,
  PART_NAMES,
} from "./view/character";
import {
  buildHud,
  endStandingsRows,
  flashCrosshair,
  killsFromDiff,
  playerName,
  pushKillfeed,
  updateHud,
  type HudHandles,
} from "./hud/hud";
import { updateAmmo } from "./ui/ammo";
import {
  buildNametags,
  updateNametags,
  type NametagsHandles,
} from "./ui/nametags";
import {
  buildPadlabels,
  updatePadlabels,
  type PadlabelsHandles,
} from "./ui/padlabels";

/** Fixed-timestep sim step in seconds. */
const STEP = 1 / TICK_HZ;
/** Clamp for tab-switch frame gaps. */
const MAX_FRAME_DT = 0.25;
/** Max sim steps per animation frame; overflow resets the accumulator. */
const MAX_STEPS_PER_FRAME = 5;
/** Bot-brain replan cadence in sim ticks (mirrors the 12 Hz REPLAN_HZ). */
const REPLAN_TICKS = 5;
/** Match seeds stay inside the signed 32-bit range. */
const SEED_RANGE = 2147483647;

const GAME_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Space",
  "KeyA",
  "KeyD",
  "KeyW",
  "KeyS",
  "KeyG",
  "KeyR",
  "KeyZ",
]);

const el = document.getElementById("game");
if (!(el instanceof HTMLCanvasElement)) {
  throw new Error('scrapline: missing <canvas id="game">');
}
const canvas = el;
// Fixed 640x360 backing store (matches the camera.ts `#game 640x360`
// clamp contract): the bare `<canvas id="game">` tag carries no size
// attrs, so set the store here before the lazy Pixi
// `app.init({ canvas, width: canvas.width, ... })` path or the canvas2d
// fallback reads it; CSS scales the element to the stage width.
/** Logical sim/camera coordinate width in px (fixed backing store). */
const LOGICAL_W = BASE_W;
/** Logical sim/camera coordinate height in px (fixed backing store). */
const LOGICAL_H = BASE_H;
canvas.width = LOGICAL_W;
canvas.height = LOGICAL_H;

const keys = createKeyState();
/** Aim origin in canvas CSS pixels (canvas center before match start). */
const aimOrigin = { x: LOGICAL_W / 2, y: LOGICAL_H / 2 };

/** Live gamepad edge tracker: the connect toast fires once per plug-in. */
const padTracker = createGamepadTracker();
/** Live toast handles, grabbed once at boot like the HUD binders. */
const toastHandles: ToastHandles = buildToast(document);

/**
 * Fresh pad snapshot from the Gamepad API: resolved anew on every
 * call (never cached) so late-installed virtual-gamepad mocks are
 * seen; first connected pad wins. Never throws.
 */
function readLiveGamepad(): GamepadState {
  try {
    const nav = globalThis.navigator as unknown as
      | { getGamepads?: unknown }
      | undefined;
    const get = nav?.getGamepads;
    if (typeof get !== "function") {
      return createGamepadState();
    }
    const pads = (get as () => unknown).call(nav) as
      | readonly unknown[]
      | null
      | undefined;
    if (pads === null || pads === undefined) {
      return createGamepadState();
    }
    for (const candidate of pads) {
      if (
        candidate !== null &&
        typeof candidate === "object" &&
        (candidate as GamepadLike).connected === true
      ) {
        return readGamepad(candidate as GamepadLike);
      }
    }
  } catch {
    // Gamepad API unavailable: keyboard/mouse stand alone.
  }
  return createGamepadState();
}

/** Quantized local intent: keyboard/mouse merged under the live pad. */
function localInput(): InputMirror {
  const pad = readLiveGamepad();
  const merged = mergeGamepad(keys, pad);
  return toInput({
    moveX: merged.moveX,
    aim: stateAim(keys, aimOrigin.x, aimOrigin.y),
    buttons: merged.buttons,
  });
}

/**
 * Poll the Gamepad API for fresh connect edges (plus the D-pad swap
 * edge for the future inventory slice) and toast once per plug-in.
 */
function checkGamepadToast(): void {
  const pad = readLiveGamepad();
  if (trackConnected(padTracker, pad.connected)) {
    showToast(toastHandles);
  }
  // D-pad swap edge debounced in the tracker for the future inventory
  // slice; the single-slot core performs no sim mutation on this edge.
  trackSwap(padTracker, pad.swapPressed, performance.now());
}

/** Recompute the quantized input mirror from the live key/mouse state. */
function refreshInput(): void {
  window.__scraplineInput = localInput();
}

/** Key identity: `code` when present, else the `key` spelling. */
function eventKey(e: KeyboardEvent): string {
  if (e.code !== undefined && e.code !== "") {
    return e.code;
  }
  if (e.key === " ") {
    return " ";
  }
  return e.key;
}

/** Fullscreen toggle shared by the F key; wired once bindSettings runs below. */
let fullscreenToggle: (() => void) | null = null;

window.addEventListener("keydown", (e: KeyboardEvent) => {
  const id = eventKey(e);
  if (GAME_KEYS.has(id) || id === " ") {
    e.preventDefault();
  }
  // Zoom key: cycle the match camera through 1x / 0.8x / 0.64x.
  // Repeats ignored; pre-match (no camera yet) is a no-op.
  if ((id === "KeyZ" || id === "z" || id === "Z") && !e.repeat) {
    if (camera !== null) {
      cycleZoom(camera);
    }
  }
  // Fullscreen toggle: F shares the Settings button path (persisted
  // intent first, best-effort Fullscreen API, headless-safe). Repeats
  // ignored; the gesture also resumes the AudioContext.
  if ((id === "KeyF" || id === "f" || id === "F") && !e.repeat) {
    ensureAudioOnGesture();
    fullscreenToggle?.();
  }
  applyKeyEvent(keys, id, true);
  refreshInput();
});

window.addEventListener("keyup", (e: KeyboardEvent) => {
  applyKeyEvent(keys, eventKey(e), false);
  refreshInput();
});

window.addEventListener("mousemove", (e: MouseEvent) => {
  applyMouseMove(keys, e.clientX, e.clientY, canvas.getBoundingClientRect());
  refreshInput();
});

window.addEventListener("mousedown", (e: MouseEvent) => {
  applyMouseButton(keys, e.button, true);
  refreshInput();
});

window.addEventListener("mouseup", (e: MouseEvent) => {
  applyMouseButton(keys, e.button, false);
  refreshInput();
});

window.addEventListener("blur", () => {
  const fresh = createKeyState();
  fresh.mouseX = keys.mouseX;
  fresh.mouseY = keys.mouseY;
  fresh.hasMouse = keys.hasMouse;
  Object.assign(keys, fresh);
  refreshInput();
});

// Gamepad auto-detect: the hot-plug events funnel into the same
// edge-guarded toast path as the per-frame poll, so real hardware
// toasts even between frames; disconnects re-arm the edge.
window.addEventListener("gamepadconnected", () => {
  if (trackConnected(padTracker, true)) {
    showToast(toastHandles);
  }
});
window.addEventListener("gamepaddisconnected", () => {
  trackConnected(padTracker, false);
});
// Backstop poll for throttled-frame surfaces (background tabs): the
// edge guard keeps it to one toast per plug-in. Never gates boot.
try {
  window.setInterval(checkGamepadToast, 250);
} catch {
  // Shorn timers: the frame loop above still polls every frame.
}

canvas.addEventListener("contextmenu", (e: MouseEvent) => {
  e.preventDefault();
});

window.__scraplineTick = 0;
window.__scraplineWorld = null;
window.__matchConfig = null;
window.__camera = null;
// Sprite-swap probe hook (`platformer-characters` Soldier set):
// window.__scrapline.debugFrame("soldier.run.3") forces the active
// soldier texture so canvas and mirror probes read a soldier run key
// while running. The renderer refreshes activeTexture every draw; this
// seed keeps the hook live before the first draw. Never gates boot.
try {
  const scope = window as unknown as Record<string, unknown>;
  const seed = scope["__scrapline"] as Record<string, unknown> | undefined;
  const debugFrame = (key: unknown): string => {
    try {
      const next = debugSoldierFrame(key, "soldier.idle");
      try {
        const cur = scope["__scrapline"] as
          | Record<string, unknown>
          | undefined;
        if (cur !== undefined && cur !== null && typeof cur === "object") {
          cur["activeTexture"] = next;
          cur["activeFrame"] = next;
          cur["lastTexture"] = next;
        }
      } catch {
        // Mirror best-effort only.
      }
      return next;
    } catch {
      return "soldier.idle";
    }
  };
  // Pre-draw in-hand sprite key (issue #264): reads the live world so
  // the probe exists before the first draw; the renderer refreshes the
  // closure every draw. Never throws.
  const currentWeaponSprite = (): string => {
    try {
      const world = scope["__scraplineWorld"] as unknown as {
        players?: readonly { weapon?: unknown }[];
      } | null;
      return weaponSpriteKey(world?.players?.[0]?.weapon ?? "pistol");
    } catch {
      return weaponSpriteKey("pistol");
    }
  };
  // Pre-draw bot silhouette keys (issue #265): no bots exist before
  // the first draw, so the seed reads empty; the renderer replaces
  // the closure every draw. Never throws.
  const botSprites = (): string[] => [];
  if (seed === undefined || seed === null || typeof seed !== "object") {
    scope["__scrapline"] = {
      debugFrame,
      activeTexture: debugTextureOverride() ?? "soldier.idle",
      activeFrame: debugTextureOverride() ?? "soldier.idle",
      lastTexture: debugTextureOverride() ?? "soldier.idle",
      currentWeaponSprite,
      botSprites,
    };
  } else {
    seed["debugFrame"] = debugFrame;
    if (seed["activeTexture"] === undefined) {
      const current = debugTextureOverride() ?? "soldier.idle";
      seed["activeTexture"] = current;
      seed["activeFrame"] = current;
      seed["lastTexture"] = current;
    }
    if (seed["currentWeaponSprite"] === undefined) {
      seed["currentWeaponSprite"] = currentWeaponSprite;
    }
    if (seed["botSprites"] === undefined) {
      seed["botSprites"] = botSprites;
    }
  }
  void activeSoldierTexture;
} catch {
  // Shorn harnesses: the renderer-owned hook below still lands.
}
/**
 * Fresh window.__game value with composed-sprite probe seeds. The
 * renderer merges live players/colors/bounds/muzzle over these seeds
 * every draw (Object.assign, never replaced), so the seeds only show
 * before the first draw of a match.
 */
function seedGame(
  state: "menu" | "playing",
  playerCount: number,
  theme: string = "kilima",
): typeof window.__game {
  return {
    state,
    playerCount,
    tick: 0,
    rendererResolution: currentRendererResolution(),
    players: [],
    spritePartCount: PART_NAMES.length,
    localPlayerColor: LOCAL_CSS,
    firstEnemyColor: ENEMY_A_CSS,
    playerBounds: {
      w: CHARACTER_W,
      h: CHARACTER_H,
      width: CHARACTER_W,
      height: CHARACTER_H,
    },
    muzzle: { x: 0, y: 0 },
    weaponTip: { x: 0, y: 0 },
    muzzleX: 0,
    muzzleY: 0,
    weaponTipX: 0,
    weaponTipY: 0,
    legPhase: 0,
    isFlameVisible: false,
    isFlickerRectVisible: false,
    playerHeightScale: 1,
    isHurtFlash: false,
    gaitBlend: 0,
    airBlend: 0,
    crouchWeight: 0,
    aimSmoothed: 0,
    landSquash: 1,
    scaleY: 1,
    spawnEase: 1,
    deathEase: 1,
    enemyCosmetics: [],
    playerCosmetics: { ...DEFAULT_COSMETICS },
    theme,
    tileDrawCalls: 0,
    tilesDrawn: 0,
    bouncePadCount: 0,
    backwallCount: 0,
    oneWayCount: 0,
    backwallZ: 0,
    solidZ: 1,
    bounceZ: 2,
    oneWayZ: 2,
    bounceTileH: 8,
    oneWayTileH: 8,
    solidTileH: 32,
    decorationCount: 0,
    occludedTiles: 0,
    lightCount: 0,
    skyTop: { r: 0x5a, g: 0x6b, b: 0x7a },
    vignetteAlpha: 0.25,
    lightsRespected: true,
    skyCoversViewport: true,
    fps: 60,
    quality: "high",
    shockwaveCount: 0,
    hurtPulse: 0,
  };
}

window.__game = seedGame("menu", 0);
// Publish the display/bitmap font manifest for canvas/computed-font
// probes: the bundle now carries the Orbitron family name by import.
void DISPLAY_FONT_FAMILY;
publishFonts();
refreshInput();

/** Live overlay handles; rebuilt idempotently on every match start. */
let hud: HudHandles = buildHud(document);
/** Live name-tag handles; rebuilt idempotently on every match start. */
let nametags: NametagsHandles = buildNametags(document);
/** Live pad-label handles; rebuilt idempotently on every match start. */
let padlabels: PadlabelsHandles = buildPadlabels(document);

/** Cached canvas CSS rect: refreshAimOrigin runs every frame, so the
 * layout read is cached and only refreshed on resize (plus once). */
let cachedRect: { left: number; top: number; width: number; height: number } | null = null;
/**
 * Cached name-tag visibility: frame() runs at 60 Hz, so the persisted
 * flag is read once at boot (plus on toggle/match-start) instead of
 * hitting synchronous storage on every frame.
 */
let cachedShowNameTags = true;
/** Re-read the persisted name-tag flag into the frame-loop cache. */
function refreshShowNameTags(): void {
  try {
    cachedShowNameTags = loadShowNameTags(storage);
  } catch {
    // Storage unreadable: keep the previous cached value.
  }
}
/**
 * Cached local profile: frame() runs at 60 Hz, so the persisted name
 * and palette are read once at boot (plus on editor/match-start)
 * instead of hitting synchronous storage on every frame.
 */
let cachedProfile: Profile = { ...DEFAULT_PROFILE };
/** Re-read the persisted profile into the frame-loop cache. */
function refreshCachedProfile(): void {
  try {
    cachedProfile = loadProfile(storage);
  } catch {
    // Storage unreadable: keep the previous cached value.
  }
}
let renderer: Renderer | null = null;
/** Letterbox-fit the canvas/stage to the window, refresh the density. */
function applyResponsiveSize(): void {
  const size = computeLetterboxFit(window.innerWidth, window.innerHeight);
  applyLetterbox(canvas, document.getElementById("stage"), size);
  cachedRect = null;
  if (renderer !== null) {
    renderer.setResolution(currentRendererResolution());
  }
  window.__game.rendererResolution = currentRendererResolution();
}
window.addEventListener("resize", applyResponsiveSize);
window.addEventListener("orientationchange", applyResponsiveSize);

/** Reveal the canvas and drop the loading screen once the renderer
 * backend (lazy Pixi chunk or canvas2d fallback) is ready to paint. */
function revealCanvas(): void {
  canvas.style.visibility = "visible";
  const loading = document.getElementById("loading");
  if (loading instanceof HTMLElement) {
    loading.style.display = "none";
  }
}

// Progress text while the lazy Pixi chunk is in flight: the static
// "Loading..." HTML paints before any JS runs (slow-network cold
// load), this upgrade names the engine chunk while it fetches.
try {
  const loading = document.getElementById("loading");
  if (loading instanceof HTMLElement) {
    loading.textContent = "Loading PixiJS engine...";
  }
} catch {
  // Non-DOM harnesses: the renderer bootstrap below still proceeds.
}
try {
  const loading = document.getElementById("loading");
  if (loading instanceof HTMLElement) {
    loading.textContent = "Loading sprite atlas...";
  }
} catch {
  // Non-DOM harnesses: the atlas fetch below still proceeds.
}
// Noscript fallback (issue #160): the static "JavaScript is disabled"
// paragraph renders before any JS runs, so hide it the moment the client
// boots. The renderer-settle continuation below re-syncs (re-showing it
// when no WebGL context exists or a non-Pixi backend won).
try {
  hideNoscript(document);
} catch {
  // Non-DOM harnesses: the renderer bootstrap below still proceeds.
}
// Atlas preload races renderer init behind the same loading screen: the
// assets/atlas.json fetch fires before the first frame, and the canvas
// only reveals once both settle (either may fail without hanging boot).
void Promise.allSettled([createRenderer(canvas), loadAtlas()]).then(
  ([rendererResult]) => {
    if (rendererResult.status === "fulfilled") {
      const r: Renderer = rendererResult.value;
      renderer = r;
      // Seed the post-effect quality from storage next to the
      // responsive-size wiring; the settings toggle forwards later.
      try {
        r.setQuality(loadQuality(storage));
      } catch {
        // Storage unreadable: the renderer default (high) stands.
      }
      applyResponsiveSize();
      if (world === null) {
        renderer.draw(new World({ seed: 0 }).state);
      }
    } else {
      renderer = null;
    }
    // Re-sync the noscript fallback once the backend settles: hidden
    // if and only if a real WebGL context exists and the Pixi backend
    // won; any other outcome (null/stubbed context, canvas2d fallback,
    // failed init) restores the fallback text. Never gates boot.
    try {
      const webgl = hasWebGLSupport();
      const pixiWon =
        rendererResult.status === "fulfilled" &&
        renderer !== null &&
        renderer.mode === "pixi";
      syncNoscriptFallback(document, !(webgl && pixiWon));
    } catch {
      // Visibility sync failed: the canvas reveal below still proceeds.
    }
    // Canvas2d fallback unavailable (no 2d context): still drop the
    // loading screen so the failure surfaces instead of hanging.
    revealCanvas();
  },
);

let world: World | null = null;
let camera: Camera | null = null;
let running = false;
let rafId = 0;
let last = 0;
let accumulator = 0;
/** Rendered-frame counter: HUD DOM writes are throttled to every 3rd
 * frame (~20 Hz) so per-frame style/layout work never drags the 60 Hz
 * sim+paint loop below 55fps on integrated graphics. */
let hudFrame = 0;

const menu = document.getElementById("menu");
const playButton = document.getElementById("play");

/** Ease the shared camera toward the local player plus aim look-ahead. */
function updateCameraFromLocal(dtSeconds: number): void {
  if (world === null || camera === null) {
    return;
  }
  const local = world.players[0];
  if (local === undefined) {
    return;
  }
  const height = local.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  const target = cameraTarget(
    local.x + PLAYER_WIDTH / 2,
    local.y + height / 2,
    local.aim,
  );
  updateCamera(
    camera,
    target.x,
    target.y,
    world.map.widthPixels,
    world.map.heightPixels,
    dtSeconds,
  );
}

/**
 * Point the aim origin at the local player's screen position (canvas CSS
 * pixels, matching the stored mouse coordinates). Canvas center before
 * any match starts. The CSS rect is cached across frames (invalidated on
 * resize) to avoid a forced layout on every 60 Hz frame.
 */
function refreshAimOrigin(): void {
  if (cachedRect === null) {
    const rect = canvas.getBoundingClientRect();
    cachedRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  const rect = cachedRect;
  const local = world?.players[0];
  if (world === null || world === undefined || local === undefined || camera === null) {
    aimOrigin.x = rect.width / 2;
    aimOrigin.y = rect.height / 2;
    return;
  }
  const height = local.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  const center = projectCamera(
    camera,
    LOGICAL_W,
    LOGICAL_H,
    local.x + PLAYER_WIDTH / 2,
    local.y + height / 2,
  );
  aimOrigin.x = (center.x * rect.width) / LOGICAL_W;
  aimOrigin.y = (center.y * rect.height) / LOGICAL_H;
}

/** Per-frame hitscan shot details drained from the sim; cleared after each draw. */
const shotsThisFrame: ShotDetail[] = [];
/** Per-frame damage details drained from the sim; cleared after each draw. */
const damagesThisFrame: DamageDetail[] = [];
/** Per-frame kill details drained from the sim; cleared after each draw. */
const killsThisFrame: KillDetail[] = [];
/** Per-frame explosion blast centers drained from the sim; cleared after each draw. */
const explodesThisFrame: ExplodeDetail[] = [];
/** Per-frame pickup pad positions drained from the sim; cleared after each draw. */
const pickupsThisFrame: PickupDetail[] = [];

/**
 * Advance one fixed 60 Hz step; attribute kills to the killfeed and
 * show the end screen on matchEnd. Returns the step's sim events
 * for the renderer's fx flashes.
 */
function stepOnce(): string[] {
  if (world === null) {
    return [];
  }
  const local = localInput();
  window.__scraplineInput = local;
  // Bots replan at 12 Hz (every REPLAN_TICKS sim ticks); between replans
  // the cached inputs carry the match (ffa-full.test.ts pattern).
  if (world.tick % REPLAN_TICKS === 0) {
    botCached = brains.map((brain, k) => brain.tick(world, k + 1));
  }
  const inputs: WorldInput[] = [local, ...botCached];
  // SFX snapshot: reload/dry-fire intents diff pre- vs post-step without
  // touching the sacred sim (prevProjectileIds snapshot idiom).
  const focus = world.players[0];
  const preMagAmmo = focus?.magAmmo ?? -1;
  const preReloading = focus?.reloading === true;
  const preAlive = focus?.alive === true;
  const fireHeld = (local.buttons & BUTTON_FIRE) !== 0;
  const prevScores = world.scores.slice();
  const prevAlive = world.players.map((p) => p.alive);
  // Projectile ids before the step: rocket launches never emit
  // ShotDetails, so local fire is detected as a new owned projectile.
  const prevProjectileIds = new Set<number>();
  for (const proj of world.projectiles) {
    prevProjectileIds.add(proj.id);
  }
  const events = world.step(inputs);
  // Dry-fire clicks when the trigger is held on an empty magazine;
  // reload blips on the false->true edge (throttled in the engine).
  const postFocus = world.players[0];
  if (fireHeld && preMagAmmo === 0 && preAlive) {
    playDryFire();
  } else if (
    postFocus !== undefined &&
    postFocus.reloading &&
    !preReloading
  ) {
    playReload();
  }
  const stepShots: ShotDetail[] = [];
  const stepDamages: DamageDetail[] = [];
  for (const shot of world.drainShotDetails()) {
    shotsThisFrame.push(shot);
    stepShots.push(shot);
  }
  // One SFX play per firing, never per pellet: group drained details by
  // shooter (the spawnShots muzzled-set idiom) into a single playShot.
  for (const weapon of groupShotWeapons(stepShots)) {
    playShot(weapon);
  }
  for (const damage of world.drainDamageDetails()) {
    damagesThisFrame.push(damage);
    stepDamages.push(damage);
    // Crosshair confirm: the local player (shooter id 0) dealt damage.
    if (damage.shooterId === 0) {
      flashCrosshair(document);
    }
    // Damage grunt plus camera kick when the local player is hit.
    if (damage.victimId === 0) {
      playGrunt();
      if (camera !== null) {
        addTrauma(camera, 0.5);
      }
    }
  }
  // Camera kick: the local player fired the rocket. Projectile
  // weapons never produce ShotDetails, so detect the new rocket
  // projectile owned by player 0 instead of scanning drained shots.
  if (
    camera !== null &&
    rocketLaunchedSince(prevProjectileIds, world.projectiles, 0)
  ) {
    playShot("rocket");
    addTrauma(camera, 0.25);
  }
  // Camera kick: a nearby explosion rattles the local player. Trauma
  // scales down with distance; with no damage position known the
  // explosion stays too far to feel, so no fallback shake is added.
  if (events.includes("explode") && camera !== null) {
    const localPlayer = world.players[0];
    if (localPlayer !== undefined && stepDamages.length > 0) {
      const height = localPlayer.crouching
        ? PLAYER_CROUCH_HEIGHT
        : PLAYER_HEIGHT;
      const cx = localPlayer.x + PLAYER_WIDTH / 2;
      const cy = localPlayer.y + height / 2;
      let minDist = Infinity;
      for (const detail of stepDamages) {
        minDist = Math.min(minDist, Math.hypot(detail.x - cx, detail.y - cy));
      }
      if (minDist <= EXPLODE_SHAKE_RADIUS) {
        addTrauma(camera, 0.35 * (1 - minDist / EXPLODE_SHAKE_RADIUS));
      }
    }
  }
  // Grenade voices are local-player-agnostic (audible at any distance,
  // like the shake anchor fallback): bounce blips, explosion booms.
  if (events.includes("bounce")) {
    playBounce();
  }
  if (events.includes("explode")) {
    playExplosion();
  }
  // Movement and pickup cues ride the same event idiom: hop up-chirps,
  // land thuds, and the mid-band pickup chime (any distance, like grenades).
  if (events.includes("hop")) {
    playHop();
  }
  if (events.includes("land")) {
    playLand();
  }
  if (events.includes("pickup")) {
    playPickup();
  }
  for (const kill of world.drainKillDetails()) {
    killsThisFrame.push(kill);
    // Kill-confirm blip when the local player lands the kill.
    if (kill.killerId === 0) {
      playKill();
    }
    // Feed entries carry the sim-recorded killing weapon (fallback to
    // the killer's live weapon when the detail predates the field),
    // with per-player colors resolved from the array indices.
    const killerIdx =
      kill.killerId === null
        ? null
        : world.players.findIndex((p) => p.id === kill.killerId);
    const knownKiller = killerIdx !== null && killerIdx >= 0;
    const liveWeapon =
      knownKiller && killerIdx !== null
        ? (world.players[killerIdx]?.weapon ?? null)
        : null;
    pushKillfeed(
      hud,
      kill.killerId === null
        ? null
        : playerName(kill.killerId, cachedProfile.name),
      playerName(kill.victimId, cachedProfile.name),
      kill.weapon ?? liveWeapon,
      knownKiller ? killerIdx : null,
      kill.victim,
    );
    // Daily challenges (issue #211): only local-player kills progress
    // the rifle/grenade rows (bot-vs-bot kills never count); freshly
    // completed rows bank their one-shot XP immediately.
    try {
      const store = challengeStore();
      if (recordKill(store, kill)) {
        saveChallenges(storage, store);
        updateChallengesPanel(document, store);
        bankChallengeXp(store);
      }
    } catch {
      // Challenge progress best-effort: the feed still renders.
    }
  }
  // Blast centers plus pickup pads drive the pooled explosion and
  // sparkle particles (positions the string event bus never carried).
  for (const blast of world.drainExplodeDetails()) {
    explodesThisFrame.push(blast);
  }
  for (const pickup of world.drainPickupDetails()) {
    pickupsThisFrame.push(pickup);
  }
  // The jet loop follows the local player's jetting state plus fuel:
  // a missing or dead player silences it (match end below re-silences).
  const jetPlayer = world.players[0];
  const jetting =
    jetPlayer !== undefined &&
    jetPlayer.alive &&
    jetPlayer.jetting === true;
  const fuelRatio =
    jetPlayer === undefined
      ? 0
      : Math.min(1, Math.max(0, jetPlayer.fuel / JETPACK_FUEL_MAX));
  setJetting(jetting, fuelRatio);
  const kills = killsFromDiff(
    prevScores,
    world.scores,
    prevAlive,
    world.players.map((p) => p.alive),
  );
  for (const kill of kills) {
    const killer =
      kill.killerId === null
        ? null
        : playerName(kill.killerId, cachedProfile.name);
    if (kill.victimId === 0) {
      lastLocalKiller = killer;
    }
    while (deaths.length < world.players.length) {
      deaths.push(0);
    }
    deaths[kill.victimId] = (deaths[kill.victimId] ?? 0) + 1;
  }
  // Match-end stinger plays once on the matchEnd edge (not on the sticky
  // matchOver flag); the jet loop is silenced with the final whistle.
  // Progression awards once on the same authoritative edge: the local
  // kill count plus the win/complete bonuses persist to the profile and
  // repaint the menu badge (the sticky matchOver flag below cannot
  // double-award: running flips false and the loop stops stepping).
  if (events.includes("matchEnd")) {
    playMatchEnd();
    playEndStinger();
    setJetting(false, 0);
    try {
      const ids = world.players.map((p) => p.id);
      const win = standingsFor(world.scores, ids)[0] === 0;
      const localKills = world.scores[0] ?? 0;
      const next = awardMatchXp(loadProfile(storage), {
        win,
        kills: localKills,
        completed: true,
      });
      saveProfile(storage, next);
      cachedProfile = next;
      updateProfileBadge(document, next);
      // Daily challenges (issue #211): the dune-win row completes only
      // on a win in the running dune setup; due rewards auto-award
      // once via their claimed flags (kill rows banked mid-match above
      // re-collect to 0 here by construction).
      try {
        const store = challengeStore();
        if (recordWin(store, { win, map: matchConfig.map })) {
          saveChallenges(storage, store);
          updateChallengesPanel(document, store);
        }
        bankChallengeXp(store);
      } catch {
        // Challenge banking best-effort: the end screen still shows.
      }
    } catch {
      // Progression best-effort: the end screen still shows.
    }
  }
  if (events.includes("matchEnd") || world.matchOver) {
    running = false;
    window.__game.state = "over";
    showEndScreen();
  }
  return events;
}

function frame(now: number): void {
  if (!running || world === null) {
    return;
  }
  // Gamepad auto-detect: polled every animation frame so a late-plugged
  // (or virtual) controller toasts within a frame of arrival.
  checkGamepadToast();
  const dt = Math.min(MAX_FRAME_DT, Math.max(0, (now - last) / 1000));
  last = now;
  accumulator += dt;
  let steps = 0;
  const eventsThisFrame: string[] = [];
  while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
    const stepEvents = stepOnce();
    for (const event of stepEvents) {
      eventsThisFrame.push(event);
    }
    if (!running) {
      break;
    }
    accumulator -= STEP;
    steps += 1;
  }
  if (steps >= MAX_STEPS_PER_FRAME) {
    accumulator = 0;
  }
  if (camera === null) {
    camera = createCamera(world.map.widthPixels, world.map.heightPixels);
  }
  updateCameraFromLocal(dt);
  refreshAimOrigin();
  if (renderer !== null && camera !== null) {
    // Shaken copy for paint only: the aim origin above stays jitter-free
    // while the drawn frame (and the debug cameraX/Y mirror) kicks.
    const renderCam: Camera = {
      ...camera,
      x: camera.x + camera.shakeX / camera.scale,
      y: camera.y + camera.shakeY / camera.scale,
    };
    renderer.draw(
      world.state,
      world.map,
      renderCam,
      eventsThisFrame,
      shotsThisFrame,
      damagesThisFrame,
      killsThisFrame,
      explodesThisFrame,
      pickupsThisFrame,
    );
  }
  // Authoritative camera probe mirror (zoom multiplier, scale, trauma,
  // screen-px shake, and the clamped world-px view size).
  if (camera !== null) {
    window.__camera = {
      x: camera.x,
      y: camera.y,
      scale: camera.scale,
      zoom: camera.zoom,
      targetZoom: camera.targetZoom,
      trauma: camera.trauma,
      shakeX: camera.shakeX,
      shakeY: camera.shakeY,
      view: viewSize(camera, LOGICAL_W, LOGICAL_H),
    };
  }
  shotsThisFrame.length = 0;
  damagesThisFrame.length = 0;
  killsThisFrame.length = 0;
  explodesThisFrame.length = 0;
  pickupsThisFrame.length = 0;
  const local = world.players[0];
  hudFrame += 1;
  if (local !== undefined && hudFrame % 3 === 1) {
    if (local.alive) {
      lastLocalKiller = null;
    }
    updateHud(
      hud,
      {
        hp: local.hp,
        fuel: local.fuel,
        magAmmo: local.magAmmo,
        weaponName: local.weapon,
        grenades: local.grenades ?? 0,
        killedBy: lastLocalKiller,
        scores: world.scores,
        ids: world.players.map((p) => p.id),
        tick: world.tick,
        timeLimitTicks: world.timeLimitTicks,
        localAlive: local.alive,
        respawnTicks: local.respawnTicks,
      },
      cachedProfile.name,
    );
  }
  // Bottom-right weapon module (issue #152): mirrored every
  // animation frame (change-guarded in the binder) so mag and grenade
  // deltas land within a frame, well inside the 500ms probe budget.
  // Floating name tags (issue #153): reconciled every animation frame
  // from the live player rows, gated by the cached setting flag
  // (issue #184: refreshed on toggle/match-start, never read from
  // storage here so the 60 Hz loop stays storage-free).
  if (local !== undefined) {
    updateAmmo(
      {
        module: hud.ammoModule,
        icon: hud.ammoIcon,
        name: hud.ammoName,
        counts: hud.ammoCounts,
        pips: hud.ammoPips,
      },
      {
        magAmmo: local.magAmmo,
        weapon: local.weapon,
        grenades: local.grenades ?? GRENADE_MAX,
      },
    );
  }
  if (world !== null) {
    updateNametags(nametags, {
      players: world.players,
      camera,
      canvasW: LOGICAL_W,
      canvasH: LOGICAL_H,
      show: cachedShowNameTags,
      localName: cachedProfile.name,
      localPalette: cachedProfile.palette,
    });
    // Floating pad labels (issue #154): reconciled every animation
    // frame from the live pickup rows (change-guarded in the binder)
    // so weapon swaps land within a frame, well inside the 500ms probe
    // budget.
    updatePadlabels(padlabels, {
      pickups: world.pickups,
      camera,
      canvasW: LOGICAL_W,
      canvasH: LOGICAL_H,
    });
  }
  window.__scraplineTick = world.tick;
  // Generative soundtrack tension follows match progress (clock plus
  // the leader's score fraction); best-effort next to the HUD write.
  try {
    let top = 0;
    for (const score of world.scores) {
      if (score > top) {
        top = score;
      }
    }
    setTension01(
      musicTensionFor(world.tick, world.scoreLimit, world.timeLimitTicks, top),
    );
  } catch {
    // Soundtrack best-effort: the sim and HUD still advance.
  }
  // Merge, never replace: the renderer-published probe fields
  // (players, colors, bounds, muzzle) share this same object.
  Object.assign(window.__game, { tick: world.tick });
  if (running) {
    rafId = requestAnimationFrame(frame);
  }
}

/**
 * Fill the end screen with the winner callout plus a kills/deaths
 * standings table. The overlay persists until the player picks
 * Play again or Menu.
 */
function showEndScreen(): void {
  if (world === null) {
    return;
  }
  while (deaths.length < world.players.length) {
    deaths.push(0);
  }
  const rows = endStandingsRows(
    world.scores,
    deaths,
    world.players.map((p) => p.id),
    cachedProfile.name,
  );
  const winnerEl = document.getElementById("end-winner");
  if (winnerEl instanceof HTMLElement) {
    const winner = rows[0];
    winnerEl.textContent =
      winner === undefined ? "Winner: -" : `Winner: ${winner.name}`;
  }
  if (hud.endStandings !== null) {
    hud.endStandings.replaceChildren();
    const doc = hud.endStandings.ownerDocument;
    const table = doc.createElement("table");
    const head = doc.createElement("thead");
    const headRow = doc.createElement("tr");
    for (const label of ["Player", "Kills", "Deaths"]) {
      const cell = doc.createElement("th");
      cell.textContent = label;
      headRow.appendChild(cell);
    }
    head.appendChild(headRow);
    table.appendChild(head);
    const body = doc.createElement("tbody");
    for (const row of rows) {
      const tr = doc.createElement("tr");
      if (row.winner) {
        tr.setAttribute("class", "winner");
      }
      const nameCell = doc.createElement("td");
      nameCell.textContent = row.name;
      const killsCell = doc.createElement("td");
      killsCell.textContent = String(row.kills);
      const deathsCell = doc.createElement("td");
      deathsCell.textContent = String(row.deaths);
      tr.appendChild(nameCell);
      tr.appendChild(killsCell);
      tr.appendChild(deathsCell);
      body.appendChild(tr);
    }
    table.appendChild(body);
    hud.endStandings.appendChild(table);
  }
  if (hud.hud !== null) {
    hud.hud.style.display = "none";
  }
  if (hud.ammoModule !== null) {
    hud.ammoModule.style.display = "none";
  }
  if (hud.respawn !== null) {
    hud.respawn.style.display = "none";
  }
  if (hud.endScreen !== null) {
    hud.endScreen.style.display = "";
  }
}

/** Null-safe localStorage surface; null when storage is unavailable. */
function browserStorage(): SetupStorage | null {
  try {
    const ls = window.localStorage;
    return {
      getItem: (key: string): string | null => {
        try {
          return ls.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key: string, value: string): void => {
        try {
          ls.setItem(key, value);
        } catch {
          // Private-mode storage: the match still starts, just not persisted.
        }
      },
    };
  } catch {
    return null;
  }
}

/** Last chosen setup; restart replays it, first visit uses defaults. */
let matchConfig: SetupConfig = { ...DEFAULT_SETUP };
/** Per-bot brains for the running match (index k drives player k + 1). */
let brains: BotBrain[] = [];
/** Cached bot inputs between 12 Hz replans. */
let botCached: WorldInput[] = [];
/** Per-match death counts indexed by player id/position. */
let deaths: number[] = [];
/** Display name of the local player's most recent killer; cleared on respawn. */
let lastLocalKiller: string | null = null;
/** In-memory daily-challenge progress (local-day identity, persisted). */
let challengeState: ChallengeState | null = null;

/**
 * Rollover-safe challenge store: reloads from storage whenever the
 * local day id drifted (a midnight crossing mid-session resets
 * progress). Never throws; falls back to fresh zeros.
 */
function challengeStore(): ChallengeState {
  try {
    const today = dayIdFor();
    if (challengeState !== null && challengeState.dayId === today) {
      return challengeState;
    }
    challengeState = loadChallenges(storage);
    if (challengeState.dayId !== today) {
      challengeState = defaultChallengeState(today);
    }
    return challengeState;
  } catch {
    try {
      challengeState = defaultChallengeState(dayIdFor());
    } catch {
      challengeState = defaultChallengeState("1970-01-01");
    }
    return challengeState;
  }
}

/**
 * Bank freshly completed challenge rewards onto the persisted profile:
 * sums done-but-unclaimed rows (each pays once per day via its claimed
 * flag) and repaints the badge. No-op when nothing newly completed.
 */
function bankChallengeXp(store: ChallengeState): void {
  const due = collectDueXp(store);
  if (due <= 0) {
    return;
  }
  saveChallenges(storage, store);
  updateChallengesPanel(document, store);
  const current = loadProfile(storage);
  const boosted: Profile = { ...current, xp: current.xp + due };
  saveProfile(storage, boosted);
  cachedProfile = boosted;
  updateProfileBadge(document, boosted);
}

/**
 * Optional `?seed=` override for the match seed: a finite int query value
 * wins so harnesses can reload a deterministic scatter layout; absent or
 * corrupt values fall back to the random match seed below.
 */
function matchSeedFromUrl(): number | null {
  try {
    const search = typeof window !== "undefined" ? window.location.search : "";
    if (typeof search !== "string" || search.length < 2) {
      return null;
    }
    const raw = new URLSearchParams(search).get("seed");
    if (raw === null || raw.trim() === "") {
      return null;
    }
    const parsed = Math.floor(Number(raw));
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Hide the menu, build the offline World plus tiered bots, start. */
function startMatch(config: SetupConfig, options?: { persist?: boolean }): void {
  // Gesture unlock: the AudioContext is created/resumed here, never at
  // import time. Click-driven starts unlock autoplay; the load-time
  // auto-join safely yields a suspended context (or null headless) and
  // the one-shot gesture listeners resume it on first input.
  ensureAudioOnGesture();
  playMatchStart();
  startMatchMusic();
  setTension01(0);
  cancelAnimationFrame(rafId);
  const parsed = parseSetup(config);
  matchConfig = parsed;
  window.__matchConfig = {
    bots: parsed.bots,
    tier: parsed.tier,
    map: parsed.map,
  };
  try {
    setCurrentTheme(parsed.map);
  } catch {
    // Headless/shorn theme store: the renderer falls back to __game.theme.
  }
  window.__game = seedGame("playing", parsed.bots + 1, parsed.map);
  const seed = matchSeedFromUrl() ?? Math.floor(Math.random() * SEED_RANGE);
  try {
    const query = setupSearchParams(parsed);
    // The seed rides the URL so a reload replays the same match seed
    // (and the same scatter layout) instead of rolling a fresh one.
    window.history.replaceState(null, "", `${window.location.pathname}?${query}&seed=${seed}`);
  } catch {
    // Non-http hosts (file://): the mirror still carries the config.
  }
  if (options?.persist !== false) {
    saveSetup(browserStorage(), parsed);
  }
  // Seeded enemy identity plus the local persisted pick: merged, never
  // replacing window.__game, so tick/state probes survive the publish.
  // Cosmetics locker (issue #212): the equipped locker row owns the
  // local soldier accent (helmet tint); the legacy cosmetics pick is
  // the fallback when no locker row resolves. The accent override is
  // applied before the first draw so both backends tint identically.
  const enemyCosmetics = enemyCosmeticsFor(seed, parsed.bots);
  let playerCosmetics = loadCosmetics(browserStorage());
  try {
    const lockerId = loadLockerSelection(browserStorage());
    const lockerItem = lockerItemFor(lockerId) ?? lockerItemFor(DEFAULT_LOCKER_ID);
    if (lockerItem !== undefined) {
      setLocalAccent(lockerItem.palette);
      playerCosmetics = {
        helmet: lockerItem.helmet as typeof playerCosmetics.helmet,
        visor: lockerItem.visor as typeof playerCosmetics.visor,
        palette: lockerItem.palette,
      };
      try {
        saveCosmetics(browserStorage(), playerCosmetics);
      } catch {
        // Legacy sync best-effort: the __game mirror below still lands.
      }
    }
  } catch {
    // Locker unreadable: the legacy cosmetics pick stands.
  }
  Object.assign(window.__game, { enemyCosmetics, playerCosmetics });
  const rows = mapRowsFor(parsed.map);
  const match = rows !== null ? new World({ seed, map: rows }) : new World({ seed });
  // Clustered spawns inside one camera view; index 0 stays the local player.
  for (const x of matchSpawnXs(match.map.widthPixels, parsed.bots + 1)) {
    match.addPlayer({ x });
  }
  brains = [];
  for (let i = 0; i < parsed.bots; i += 1) {
    brains.push(
      new BotBrain({ tier: parsed.tier, seed: seed + i + 1, id: i + 1 }),
    );
  }
  botCached = brains.map((brain, k) => brain.tick(match, k + 1));
  world = match;
  window.__scraplineWorld = world;
  hud = buildHud(document);
  nametags = buildNametags(document);
  // Backstop (issue #184): pick up a mid-session external write to the
  // persisted name-tag flag at match start; steady-state frames use the
  // cache without touching storage.
  refreshShowNameTags();
  // Menu profile edits land in storage via the binder; re-read them here
  // so the opening nametags already carry the fresh pilot name.
  refreshCachedProfile();
  padlabels = buildPadlabels(document);
  if (hud.endScreen !== null) {
    hud.endScreen.style.display = "none";
  }
  if (hud.hud !== null) {
    hud.hud.style.display = "";
  }
  if (hud.ammoModule !== null) {
    hud.ammoModule.style.display = "";
  }
  if (hud.killfeed !== null) {
    hud.killfeed.replaceChildren();
  }
  deaths = new Array(match.players.length).fill(0);
  lastLocalKiller = null;
  camera = createCamera(world.map.widthPixels, world.map.heightPixels);
  window.__camera = {
    x: camera.x,
    y: camera.y,
    scale: camera.scale,
    zoom: camera.zoom,
    targetZoom: camera.targetZoom,
    trauma: camera.trauma,
    shakeX: camera.shakeX,
    shakeY: camera.shakeY,
    view: viewSize(camera, LOGICAL_W, LOGICAL_H),
  };
  // Snap the fresh camera onto the local player so the match opens
  // framed (updateCamera eases 10%/frame; ~120 steps converges fully).
  const local = world.players[0];
  if (local !== undefined) {
    const target = cameraTarget(
      local.x + PLAYER_WIDTH / 2,
      local.y + PLAYER_HEIGHT / 2,
      local.aim,
    );
    for (let i = 0; i < 120; i += 1) {
      updateCamera(
        camera,
        target.x,
        target.y,
        world.map.widthPixels,
        world.map.heightPixels,
      );
    }
  }
  if (menu instanceof HTMLElement) {
    menu.style.display = "none";
  }
  refreshAimOrigin();
  window.__scraplineTick = 0;
  accumulator = 0;
  hudFrame = 0;
  last = performance.now();
  running = true;
  rafId = requestAnimationFrame(frame);
}

const storage = browserStorage();
matchConfig = loadSetup(storage);
const setupBinder = bindSetup(document, storage, (config: SetupConfig) => {
  startMatch(config);
});
const settingsBinder = bindSettings(document, storage);
// Seed the frame-loop name-tag cache once at boot (issue #184): the
// persisted default/ON fallback is captured here, before the first
// frame() — the 60 Hz loop below never touches storage itself.
refreshShowNameTags();
// Local profile editor plus the `Lv N` menu badge (issue #210): prefill
// from storage, persist edits, repaint the badge, and keep the
// frame-loop cache fresh via the change callback. Never gates boot.
refreshCachedProfile();
try {
  void bindProfile(document, storage, (next) => {
    cachedProfile = next;
  });
} catch {
  // Editor optional: defaults still render as You / Lv 1.
}
// Animated menu art scene plus the Quick Play summary chip (issue
// #155): owns the #menu-scene hover loop and repaints the chip from
// the live setup (stepper readout, pressed buttons, URL, storage)
// every 100ms, well inside the 500ms probe budget. Canvas backdrop
// stays owned by the match renderer; the soldier rides above it.
const menuScene = bindMenuScene(document, storage);
void menuScene;
// Honest-mode online room (issue #216): `Play online` hides the menu,
// hellos the same-origin /room endpoint, sends quantized inputs at
// 60 Hz, and paints snapshot-interpolated states through the live
// renderer with no local prediction. The offline frame loop is parked
// while a session owns the canvas (mirrors the matchEnd edge above).
try {
  void bindOnline(document, {
    getRenderer: () => renderer,
    getView: () => matchConfig.map,
    // Roster identity (issue #217): the persisted pilot name hellos
    // with the session so the server roster reads Alice/Bob and every
    // remote soldier renders its server nametag.
    getName: () => cachedProfile.name,
    sampleInput: () => {
      const intent = localInput();
      return { moveX: intent.moveX, aim: intent.aim, buttons: intent.buttons };
    },
    onStart: () => {
      running = false;
      cancelAnimationFrame(rafId);
    },
  });
} catch {
  // Online entry optional: offline Quick Play still boots.
}
// Map carousel with live headless thumbnails (issue #156): builds one
// card per arena inside #menu, paints each thumbnail synchronously
// from core map data, and persists card clicks as the setup default so
// Quick Play loads the selected map. Never gates boot: a shorn DOM or
// missing 2d context degrades to unpainted cards.
try {
  void bindCarousel(document, storage);
} catch {
  // Carousel optional: Quick Play still loads the stored setup.
}
// Rotating menu tips (issue #157): one small mechanics line under the
// menu buttons, advancing every 10s with a fade while the menu is
// visible (paused while hidden). Never gates boot.
try {
  void bindMenuTips(document);
} catch {
  // Tips optional: the static skeleton already names a mechanic.
}
// Daily challenges panel (issue #211): fixed 3-template local-day set
// progressed from sim kill/match-end edges with one-shot XP banking.
// Never gates boot.
try {
  void bindChallenges(document, storage);
} catch {
  // Challenges optional: the static skeleton still lists the rows.
}
// Cosmetics locker (issue #212): level/challenge-gated grid with the
// setup-reused preview; equips persist to `scrapline.cosmetic` and own
// the local soldier accent at the next match start. Never gates boot.
try {
  const locker = bindLocker(document, storage);
  void locker;
  // Apply the stored pick before the first draw so a reloaded equip
  // tints the opening match without waiting for a locker click.
  try {
    const item = lockerItemFor(loadLockerSelection(storage));
    if (item !== undefined) {
      setLocalAccent(item.palette);
    }
  } catch {
    // Accent seeding best-effort: startMatch re-applies it anyway.
  }
} catch {
  // Locker optional: the static skeleton still lists the rows.
}
// The F key and the Settings button share one persisted toggle path.
fullscreenToggle = () => {
  void settingsBinder.toggleFullscreen();
};
// The settings slider stays the single volume surface: seed the engine
// gain from the persisted volume and track the slider live (0 mutes).
setVolume(settingsBinder.volume);
// The music slider stays the single music surface: seed the generative
// bus from the persisted music volume (0 silences, never suspends).
setMusicVolume(settingsBinder.music);
// The quality button owns storage + label (bindSettings); forward the
// persisted level to the live renderer after every toggle.
const qualityButton = document.getElementById("btn-quality");
if (qualityButton instanceof HTMLButtonElement) {
  qualityButton.addEventListener("click", () => {
    if (renderer !== null) {
      try {
        renderer.setQuality(loadQuality(storage));
      } catch {
        // Storage unreadable mid-toggle: keep the renderer level.
      }
    }
  });
}
const volumeSlider = document.getElementById("volume");
// The name-tags button owns storage + label (bindSettings); refresh the
// frame-loop cache after every toggle (issue #184). This listener is
// attached after bindSettings, so the binder-owned toggle (which
// persists synchronously) has already run and the next frame sees it.
const nametagsButton = document.getElementById("btn-nametags");
if (nametagsButton instanceof HTMLButtonElement) {
  nametagsButton.addEventListener("click", () => {
    refreshShowNameTags();
  });
}
if (volumeSlider instanceof HTMLInputElement) {
  volumeSlider.addEventListener("input", () => {
    setVolume(parseVolume(volumeSlider.value));
  });
}
const musicSlider = document.getElementById("music-volume");
if (musicSlider instanceof HTMLInputElement) {
  musicSlider.addEventListener("input", () => {
    setMusicVolume(parseVolume(musicSlider.value));
  });
}
// Autoplay-guard fallback: unlock on the first gesture even outside
// startMatch (creation still only ever happens in a gesture stack).
// The same gesture starts the loop for the live state: the auto-join
// match is already running underneath, otherwise the menu loop plays.
function unlockMusicForState(): void {
  if (running && world !== null && !world.matchOver) {
    startMatchMusic();
  } else {
    startMenuMusic();
  }
}
window.addEventListener(
  "pointerdown",
  () => {
    ensureAudioOnGesture();
    unlockMusicForState();
  },
  { once: true },
);
window.addEventListener(
  "keydown",
  () => {
    ensureAudioOnGesture();
    unlockMusicForState();
  },
  { once: true },
);

/** Reveal a menu overlay by id; missing elements are no-ops. */
function showOverlay(id: string): void {
  const overlay = document.getElementById(id);
  if (overlay instanceof HTMLElement) {
    overlay.style.display = "";
  }
}

/** Hide a menu overlay by id; missing elements are no-ops. */
function hideOverlay(id: string): void {
  const overlay = document.getElementById(id);
  if (overlay instanceof HTMLElement) {
    overlay.style.display = "none";
  }
}

const quickPlayButton = document.getElementById("quick-play");
if (quickPlayButton instanceof HTMLButtonElement) {
  quickPlayButton.addEventListener("click", () => {
    startMatch(loadSetup(storage));
  });
}

if (playButton instanceof HTMLButtonElement) {
  playButton.addEventListener("click", () => {
    if (menu instanceof HTMLElement) {
      menu.style.display = "none";
    }
    setupBinder.show();
  });
}

const settingsOpen = document.getElementById("settings-open");
if (settingsOpen instanceof HTMLButtonElement) {
  settingsOpen.addEventListener("click", () => {
    settingsBinder.show();
  });
}

const settingsClose = document.getElementById("settings-close");
if (settingsClose instanceof HTMLButtonElement) {
  settingsClose.addEventListener("click", () => {
    settingsBinder.hide();
  });
}

const howtoOpen = document.getElementById("howto-open");
if (howtoOpen instanceof HTMLButtonElement) {
  howtoOpen.addEventListener("click", () => {
    showOverlay("howto");
  });
}

const howtoClose = document.getElementById("howto-close");
if (howtoClose instanceof HTMLButtonElement) {
  howtoClose.addEventListener("click", () => {
    hideOverlay("howto");
  });
}

const restartButton = document.getElementById("restart");
if (restartButton instanceof HTMLButtonElement) {
  restartButton.addEventListener("click", () => {
    startMatch(matchConfig);
  });
}

const endMenuButton = document.getElementById("end-menu");
if (endMenuButton instanceof HTMLButtonElement) {
  endMenuButton.addEventListener("click", () => {
    if (hud.endScreen !== null) {
      hud.endScreen.style.display = "none";
    }
    if (menu instanceof HTMLElement) {
      menu.style.display = "";
    }
    // Back on the menu: the calm loop resumes behind the overlay.
    try {
      startMenuMusic();
    } catch {
      // Soundtrack best-effort: the menu still shows.
    }
    // Daily challenges (issue #211): a midnight crossing while the
    // end screen sat open resets the rows before the panel reopens.
    try {
      updateChallengesPanel(document, challengeStore());
    } catch {
      // Panel optional: the menu still shows.
    }
  });
}

// Letterbox-fit before the first frame so probes read the CSS box
// synchronously on load (the async renderer continuation re-applies
// density once the backend exists).
applyResponsiveSize();
// Aim origin in CSS pixels (rect-based) before the first event or frame.
refreshAimOrigin();
refreshInput();
// Offline-first PWA (issue #159): register the service worker behind
// the loading screen. Fire-and-forget by contract — the helper resolves
// false (warn-only) instead of rejecting, so boot never blocks on it.
void registerServiceWorker().catch(() => {
  // Unreachable by contract (already warned inside); guards the type.
});

/**
 * Auto-join setup: the walking-skeleton 1-bot kilima default, overridden
 * by a valid `?map=` (`?bots=&tier=&map=`) query so harnesses can load an
 * arena directly via URL. Invalid values fall back per field.
 */
function autoJoinSetup(): SetupConfig {
  const fallback: SetupConfig = { bots: 1, tier: "normal", map: "kilima" };
  try {
    const search =
      typeof window !== "undefined" ? window.location.search : "";
    if (typeof search !== "string" || search.length < 2) {
      return fallback;
    }
    const query = new URLSearchParams(search);
    const rawMap = query.get("map");
    const rawBots = query.get("bots");
    const rawTier = query.get("tier");
    if (rawMap === null && rawBots === null && rawTier === null) {
      return fallback;
    }
    const parsed = parseSetup({
      bots: rawBots === null ? 1 : Number(rawBots),
      tier: rawTier,
      map: rawMap,
    });
    if (rawBots === null) {
      parsed.bots = 1;
    }
    if (rawTier === null) {
      parsed.tier = "normal";
    }
    return parsed;
  } catch {
    return fallback;
  }
}

// Walking skeleton: drop straight into a local 1-bot match on load so a
// clean clone is playable (and probeable via `window.__game`) with no
// clicks. The setup screen keeps its own persisted defaults; this
// auto-join never writes them (`persist: false`).
startMatch(autoJoinSetup(), { persist: false });
