// Walking-skeleton client loop. This file is written in the JavaScript subset
// of TypeScript ONLY — no type annotations, interfaces, enums, or imports —
// until a bundler lands, so it is served verbatim as /main.js with no build.

const TICK_HZ = 60;
let tick = 0;

const el = document.getElementById("game");
if (!(el instanceof HTMLCanvasElement)) {
  throw new Error('scrapline: missing <canvas id="game">');
}
// Fresh bindings so the narrowed types survive inside the hoisted step/paint
// functions below (control-flow narrowing alone does not reach closures).
const canvas = el;
const maybeCtx = canvas.getContext("2d");
if (!maybeCtx) {
  throw new Error("scrapline: 2d canvas context unavailable");
}
const ctx = maybeCtx;

function paint() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, w, h);
  const x = (tick * 4) % w;
  ctx.fillStyle = "#7df9ff";
  ctx.fillRect(x - 20, h / 2 - 10, 40, 20);
}

function step() {
  tick += 1;
  window.__scraplineTick = tick;
  paint();
}

window.__scraplineTick = 0;
setInterval(step, 1000 / TICK_HZ);
