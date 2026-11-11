// Scrapline browser client: PixiJS v8 app driving the exact deterministic
// core at 60 Hz. The menu overlay and the input mirror are plain DOM/JS
// wired synchronously at load; the renderer is a bundled progressive
// enhancement (Pixi v8 with a 2D canvas fallback) that never gates input.

import { PLAYER_HEIGHT, PLAYER_WIDTH } from "../../core/src/constants";
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
import {
  createRenderer,
  viewTransform,
  worldToScreen,
  type Renderer,
} from "./renderer/index";

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
refreshInput();

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
let running = false;
let rafId = 0;
let last = 0;
let accumulator = 0;

const menu = document.getElementById("menu");
const playButton = document.getElementById("play");

/**
 * Point the aim origin at the local player's screen position (canvas CSS
 * pixels, matching the stored mouse coordinates). Canvas center before
 * any match starts.
 */
function refreshAimOrigin(): void {
  const rect = canvas.getBoundingClientRect();
  const local = world?.players[0];
  if (world === null || world === undefined || local === undefined) {
    aimOrigin.x = rect.width / 2;
    aimOrigin.y = rect.height / 2;
    return;
  }
  const t = viewTransform(
    canvas.width,
    canvas.height,
    world.map.widthPixels,
    world.map.heightPixels,
  );
  const center = worldToScreen(
    local.x + PLAYER_WIDTH / 2,
    local.y + PLAYER_HEIGHT / 2,
    t,
  );
  aimOrigin.x = (center.x * rect.width) / canvas.width;
  aimOrigin.y = (center.y * rect.height) / canvas.height;
}

/** Advance one fixed 60 Hz step; stop and reopen the menu on matchEnd. */
function stepOnce(): void {
  if (world === null) {
    return;
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
  const events = world.step(inputs);
  if (events.includes("matchEnd")) {
    running = false;
    if (menu instanceof HTMLElement) {
      menu.style.display = "";
    }
  }
}

function frame(now: number): void {
  if (!running || world === null) {
    return;
  }
  const dt = Math.min(MAX_FRAME_DT, Math.max(0, (now - last) / 1000));
  last = now;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
    stepOnce();
    if (!running) {
      break;
    }
    accumulator -= STEP;
    steps += 1;
  }
  if (steps >= MAX_STEPS_PER_FRAME) {
    accumulator = 0;
  }
  refreshAimOrigin();
  if (renderer !== null) {
    renderer.draw(world.state, world.map);
  }
  window.__scraplineTick = world.tick;
  if (running) {
    rafId = requestAnimationFrame(frame);
  }
}

/** Hide the menu, build the offline World plus scripted bots, start. */
function startMatch(): void {
  cancelAnimationFrame(rafId);
  const seed = Math.floor(Math.random() * SEED_RANGE);
  const match = new World({ seed });
  match.addPlayer({ x: 100 });
  match.addPlayer({ x: 400 });
  match.addPlayer({ x: 700 });
  match.addPlayer({ x: 1000 });
  world = match;
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

// Aim origin in CSS pixels (rect-based) before the first event or frame.
refreshAimOrigin();
refreshInput();
