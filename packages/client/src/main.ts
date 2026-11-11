// Scrapline browser client: PixiJS v8 app driving the exact deterministic
// core at 60 Hz. The menu overlay and the input mirror are plain DOM/JS
// wired synchronously at load; the renderer is a bundled progressive
// enhancement (Pixi v8 with a 2D canvas fallback) that never gates input.

import {
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "../../core/src/constants";
import { TICK_HZ, World, type WorldInput } from "../../core/src/world";
import { scriptedInput } from "../../core/src/replay";
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
import {
  cameraTarget,
  createCamera,
  projectCamera,
  updateCamera,
  type Camera,
} from "./renderer/camera";
import {
  buildHud,
  killsFromDiff,
  playerName,
  pushKillfeed,
  standingsRows,
  updateHud,
  type HudHandles,
} from "./hud/hud";

/** Fixed-timestep sim step in seconds. */
const STEP = 1 / TICK_HZ;
/** Clamp for tab-switch frame gaps. */
const MAX_FRAME_DT = 0.25;
/** Max sim steps per animation frame; overflow resets the accumulator. */
const MAX_STEPS_PER_FRAME = 5;
/** Per-bot tick offset so scripted bots diverge from each other. */
const BOT_TICK_OFFSET = 173;
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
]);

const el = document.getElementById("game");
if (!(el instanceof HTMLCanvasElement)) {
  throw new Error('scrapline: missing <canvas id="game">');
}
const canvas = el;

const keys = createKeyState();
/** Aim origin in canvas CSS pixels (canvas center before match start). */
const aimOrigin = { x: canvas.width / 2, y: canvas.height / 2 };

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

window.addEventListener("keydown", (e: KeyboardEvent) => {
  const id = eventKey(e);
  if (GAME_KEYS.has(id) || id === " ") {
    e.preventDefault();
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
refreshInput();

/** Live overlay handles; rebuilt idempotently on every match start. */
let hud: HudHandles = buildHud(document);
/** Pending end-screen timeout returning to the menu (restart cancels). */
let endTimer: number | null = null;

let renderer: Renderer | null = null;
void createRenderer(canvas)
  .then((r: Renderer) => {
    renderer = r;
    if (world === null) {
      renderer.draw(new World({ seed: 0 }).state);
    }
  })
  .catch(() => {
    renderer = null;
  });

let world: World | null = null;
let camera: Camera | null = null;
let running = false;
let rafId = 0;
let last = 0;
let accumulator = 0;

const menu = document.getElementById("menu");
const playButton = document.getElementById("play");

/** Ease the shared camera toward the local player plus aim look-ahead. */
function updateCameraFromLocal(): void {
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
  );
}

/**
 * Point the aim origin at the local player's screen position (canvas CSS
 * pixels, matching the stored mouse coordinates). Canvas center before
 * any match starts.
 */
function refreshAimOrigin(): void {
  const rect = canvas.getBoundingClientRect();
  const local = world?.players[0];
  if (world === null || world === undefined || local === undefined || camera === null) {
    aimOrigin.x = rect.width / 2;
    aimOrigin.y = rect.height / 2;
    return;
  }
  const height = local.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
  const center = projectCamera(
    camera,
    canvas.width,
    canvas.height,
    local.x + PLAYER_WIDTH / 2,
    local.y + height / 2,
  );
  aimOrigin.x = (center.x * rect.width) / canvas.width;
  aimOrigin.y = (center.y * rect.height) / canvas.height;
}

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
  const botCount = Math.max(0, world.players.length - 1);
  const inputs: WorldInput[] = [local];
  for (let i = 0; i < botCount; i += 1) {
    inputs.push(scriptedInput(world.tick + BOT_TICK_OFFSET * (i + 1)));
  }
  const prevScores = world.scores.slice();
  const prevAlive = world.players.map((p) => p.alive);
  const events = world.step(inputs);
  const kills = killsFromDiff(
    prevScores,
    world.scores,
    prevAlive,
    world.players.map((p) => p.alive),
  );
  for (const kill of kills) {
    const killer = kill.killerId === null ? null : playerName(kill.killerId);
    pushKillfeed(hud, killer, playerName(kill.victimId));
  }
  if (events.includes("matchEnd") || world.matchOver) {
    running = false;
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
  updateCameraFromLocal();
  refreshAimOrigin();
  if (renderer !== null && camera !== null) {
    renderer.draw(world.state, world.map, camera, eventsThisFrame);
  }
  const local = world.players[0];
  if (local !== undefined) {
    updateHud(hud, {
      hp: local.hp,
      fuel: local.fuel,
      magAmmo: local.magAmmo,
      reserveAmmo: local.reserveAmmo,
      weaponName: local.weapon,
      scores: world.scores,
      ids: world.players.map((p) => p.id),
      tick: world.tick,
      timeLimitTicks: world.timeLimitTicks,
      localAlive: local.alive,
      respawnTicks: local.respawnTicks,
    });
  }
  window.__scraplineTick = world.tick;
  if (running) {
    rafId = requestAnimationFrame(frame);
  }
}

/**
 * Fill the end screen with ordinal standings, show it for 6 s, then
 * fall back to the menu. Restart cancels the pending timeout.
 */
function showEndScreen(): void {
  if (world === null) {
    return;
  }
  const rows = standingsRows(
    world.scores,
    world.players.map((p) => p.id),
  );
  if (hud.endStandings !== null) {
    hud.endStandings.replaceChildren();
    for (const row of rows) {
      const line = document.createElement("div");
      line.textContent = `${row.rank} ${row.name}: ${row.score}`;
      hud.endStandings.appendChild(line);
    }
  }
  if (hud.hud !== null) {
    hud.hud.style.display = "none";
  }
  if (hud.respawn !== null) {
    hud.respawn.style.display = "none";
  }
  if (hud.endScreen !== null) {
    hud.endScreen.style.display = "";
  }
  if (endTimer !== null) {
    window.clearTimeout(endTimer);
  }
  endTimer = window.setTimeout(() => {
    endTimer = null;
    if (hud.endScreen !== null) {
      hud.endScreen.style.display = "none";
    }
    if (menu instanceof HTMLElement) {
      menu.style.display = "";
    }
  }, 6000);
}

/** Hide the menu, build the offline World plus scripted bots, start. */
function startMatch(): void {
  cancelAnimationFrame(rafId);
  if (endTimer !== null) {
    window.clearTimeout(endTimer);
    endTimer = null;
  }
  const seed = Math.floor(Math.random() * SEED_RANGE);
  const match = new World({ seed });
  match.addPlayer({ x: 100 });
  match.addPlayer({ x: 400 });
  match.addPlayer({ x: 700 });
  match.addPlayer({ x: 1000 });
  world = match;
  window.__scraplineWorld = world;
  hud = buildHud(document);
  if (hud.endScreen !== null) {
    hud.endScreen.style.display = "none";
  }
  if (hud.hud !== null) {
    hud.hud.style.display = "";
  }
  if (hud.killfeed !== null) {
    hud.killfeed.replaceChildren();
  }
  camera = createCamera(world.map.widthPixels, world.map.heightPixels);
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
  last = performance.now();
  running = true;
  rafId = requestAnimationFrame(frame);
}

if (playButton instanceof HTMLButtonElement) {
  playButton.addEventListener("click", startMatch);
}

const restartButton = document.getElementById("restart");
if (restartButton instanceof HTMLButtonElement) {
  restartButton.addEventListener("click", () => {
    if (endTimer !== null) {
      window.clearTimeout(endTimer);
      endTimer = null;
    }
    startMatch();
  });
}

// Aim origin in CSS pixels (rect-based) before the first event or frame.
refreshAimOrigin();
refreshInput();
