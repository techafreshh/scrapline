// Window augmentation for the client mirrors. Kept in a separate
// declaration file so main.ts stays modular while still typechecking
// under strict DOM lib settings.
import type { World } from "../../core/src/world";
import type { InputMirror } from "./input";

declare global {
  interface Window {
    __scraplineTick: number;
    __scraplineInput: InputMirror;
    __scraplineWorld: World | null;
    __matchConfig: { bots: number; tier: string; map: string } | null;
    __camera: {
      x: number;
      y: number;
      scale: number;
      zoom: number;
      targetZoom: number;
      trauma: number;
      shakeX: number;
      shakeY: number;
      view: { w: number; h: number };
    } | null;
    __scraplineDebug: {
      entitiesDrawn: number;
      tilesDrawn: number;
      cameraX: number;
      cameraY: number;
      fps: number;
      mode: string;
      barrels: {
        index: number;
        aim: number;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      }[];
      tracers: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        opacity: number;
        width: number;
      }[];
      muzzle: {
        x: number;
        y: number;
        ttl: number;
      }[];
      sparks: {
        x: number;
        y: number;
        opacity: number;
      }[];
      bursts: {
        x: number;
        y: number;
        opacity: number;
      }[];
      /** Per-player paint color in Pixi hex (victim red while flashing). */
      tints: number[];
      /** Structured per-player style node: rect, jet, blink, and flame. */
      players: {
        index: number;
        x: number;
        y: number;
        w: number;
        h: number;
        jetting: boolean;
        protected: boolean;
        alpha: number;
        color: number;
        colorCss: string;
        flame: { scale: number; alpha: number } | null;
      }[];
      /** Active zoom multiplier (1 / 0.8 / 0.64). */
      zoom: number;
      /** Effective world-to-screen scale. */
      scale: number;
      /** Screen-shake trauma in [0, 1]. */
      trauma: number;
      /** Current screen-px shake offset. */
      shakeX: number;
      /** Current screen-px shake offset. */
      shakeY: number;
    };
  }
}

export {};
