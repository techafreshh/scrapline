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
    __game: {
      state: "menu" | "playing" | "over";
      playerCount: number;
      tick: number;
      rendererResolution: number;
      /** Composed-sprite probe players (live Pixi containers or stubs). */
      players: {
        index: number;
        node: { name: string; children: { name: string; label?: string }[] };
        color: number;
        colorCss: string;
      }[];
      /** Named sprite parts per player node (>= 6). */
      spritePartCount: number;
      /** Local player team color (cyan #00E5FF). */
      localPlayerColor: string;
      /** First enemy team color (warm #FF6B35 or #FFB347). */
      firstEnemyColor: string;
      /** Authored player bounds in world units (26x58, zoom-independent). */
      playerBounds: { w: number; h: number; width: number; height: number };
      /** Live barrel-tip muzzle in backing-store px. */
      muzzle: { x: number; y: number };
      /** Live weapon tip in backing-store px (coincides with muzzle). */
      weaponTip: { x: number; y: number };
      muzzleX: number;
      muzzleY: number;
      weaponTipX: number;
      weaponTipY: number;
    };
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
    /** Synthesized-SFX probe mirror (engine.ts upkeep, gesture-gated). */
    __audio:
      | {
          lastPlayed: Array<{ name: string; baseFreq: number; at: number }>;
          /** Post-master analyser tap (null-safe probe for RMS checks). */
          analyser?: AnalyserNode | null;
          /** Mirrored jet-loop target gain (follows setJetting). */
          jetGain?: number;
        }
      | undefined;
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
