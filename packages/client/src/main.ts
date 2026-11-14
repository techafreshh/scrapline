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
} from "./cosmetics";
import { bindSettings, loadQuality, loadShowNameTags, parseVolume } from "./settings";
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
  applyKeyEvent,
  applyMouseButton,
  applyMouseMove,
  createKeyState,
  stateAim,
  stateButtons,
  stateMoveX,
  toInput,
} from "./input";
import { createRenderer, type Renderer } from "./renderer/index";
import { loadAtlas } from "./atlas";
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

/** Recompute the quantized input mirror from the live key/mouse state. */
function refreshInput(): void {
  window.__scraplineInput = toInput({
    moveX: stateMoveX(keys),
    aim: stateAim(keys, aimOrigin.x, aimOrigin.y),
    buttons: stateButtons(keys),
  });
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

canvas.addEventListener("contextmenu", (e: MouseEvent) => {
  e.preventDefault();
});

window.__scraplineTick = 0;
window.__scraplineWorld = null;
window.__matchConfig = null;
window.__camera = null;
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

/** Cached canvas CSS rect: refreshAimOrigin runs every frame, so the
 * layout read is cached and only refreshed on resize (plus once). */
let cachedRect: { left: number; top: number; width: number; height: number } | null = null;
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
  const local = toInput({
    moveX: stateMoveX(keys),
    aim: stateAim(keys, aimOrigin.x, aimOrigin.y),
    buttons: stateButtons(keys),
  });
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
      kill.killerId === null ? null : playerName(kill.killerId),
      playerName(kill.victimId),
      kill.weapon ?? liveWeapon,
      knownKiller ? killerIdx : null,
      kill.victim,
    );
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
    const killer = kill.killerId === null ? null : playerName(kill.killerId);
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
  if (events.includes("matchEnd")) {
    playMatchEnd();
    setJetting(false, 0);
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
    updateHud(hud, {
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
    });
  }
  // Bottom-right weapon module (issue #152): mirrored every
  // animation frame (change-guarded in the binder) so mag and grenade
  // deltas land within a frame, well inside the 500ms probe budget.
  // Floating name tags (issue #153): reconciled every animation frame
  // from the live player rows, gated by the persisted setting.
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
      show: loadShowNameTags(storage),
    });
  }
  window.__scraplineTick = world.tick;
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

/** Hide the menu, build the offline World plus tiered bots, start. */
function startMatch(config: SetupConfig, options?: { persist?: boolean }): void {
  // Gesture unlock: the AudioContext is created/resumed here, never at
  // import time. Click-driven starts unlock autoplay; the load-time
  // auto-join safely yields a suspended context (or null headless) and
  // the one-shot gesture listeners resume it on first input.
  ensureAudioOnGesture();
  playMatchStart();
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
  try {
    const query = setupSearchParams(parsed);
    window.history.replaceState(null, "", `${window.location.pathname}?${query}`);
  } catch {
    // Non-http hosts (file://): the mirror still carries the config.
  }
  if (options?.persist !== false) {
    saveSetup(browserStorage(), parsed);
  }
  const seed = Math.floor(Math.random() * SEED_RANGE);
  // Seeded enemy identity plus the local persisted pick: merged, never
  // replacing window.__game, so tick/state probes survive the publish.
  const enemyCosmetics = enemyCosmeticsFor(seed, parsed.bots);
  const playerCosmetics = loadCosmetics(browserStorage());
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
// The F key and the Settings button share one persisted toggle path.
fullscreenToggle = () => {
  void settingsBinder.toggleFullscreen();
};
// The settings slider stays the single volume surface: seed the engine
// gain from the persisted volume and track the slider live (0 mutes).
setVolume(settingsBinder.volume);
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
if (volumeSlider instanceof HTMLInputElement) {
  volumeSlider.addEventListener("input", () => {
    setVolume(parseVolume(volumeSlider.value));
  });
}
// Autoplay-guard fallback: unlock on the first gesture even outside
// startMatch (creation still only ever happens in a gesture stack).
window.addEventListener(
  "pointerdown",
  () => {
    ensureAudioOnGesture();
  },
  { once: true },
);
window.addEventListener(
  "keydown",
  () => {
    ensureAudioOnGesture();
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
  });
}

// Letterbox-fit before the first frame so probes read the CSS box
// synchronously on load (the async renderer continuation re-applies
// density once the backend exists).
applyResponsiveSize();
// Aim origin in CSS pixels (rect-based) before the first event or frame.
refreshAimOrigin();
refreshInput();

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
