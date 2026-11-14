// Window augmentation for the client mirrors. Kept in a separate
// declaration file so main.ts stays modular while still typechecking
// under strict DOM lib settings.
import type { World } from "../../core/src/world";
import type { InputMirror } from "./input";
import type { AtlasIndex } from "./atlas";
import type { QualityLevel } from "./fx/filters";

declare global {
  interface Window {
    __scraplineTick: number;
    __scraplineInput: InputMirror;
    __scraplineAtlas: AtlasIndex | null;
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
        /** Selected soldier frame id (additive; defaults sensibly pre-draw). */
        frame?: string;
        /** Equipped weapon id (additive; defaults sensibly pre-draw). */
        weapon?: string;
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
      /** Wall-clock run-cycle phase in radians for the local player. */
      legPhase: number;
      /** True while the local player is alive and jetting. */
      isFlameVisible: boolean;
      /** Always false: the jet flame is two circles, never a rect. */
      isFlickerRectVisible: boolean;
      /** Local player height scale (crouch ratio, else 1). */
      playerHeightScale: number;
      /** True while inside the 150ms white hurt-flash window. */
      isHurtFlash: boolean;
      /** Seeded per-bot cosmetics (helmet/visor/palette, length = bot count). */
      enemyCosmetics?: { helmet: string; visor: string; palette: string }[];
      /** Local player's persisted cosmetic pick. */
      playerCosmetics?: { helmet: string; visor: string; palette: string };
      /** Active tile theme (arena name: kilima | dune | frostbite). */
      theme: string;
      /** Visible tiles drawn this frame (all kinds; >0 when map loaded). */
      tileDrawCalls: number;
      /** Alias of tileDrawCalls (visible tiles drawn). */
      tilesDrawn: number;
      /** Total bounce pads in the map (>=1 when `^` present). */
      bouncePadCount: number;
      /** Total backwall tiles in the map (>=1 when `:` present). */
      backwallCount: number;
      /** Total one-way planks in the map. */
      oneWayCount: number;
      /** Backwall render order (always below solid). */
      backwallZ: number;
      /** Solid render order (always above backwall). */
      solidZ: number;
      /** Bounce render order (above solids). */
      bounceZ: number;
      /** One-way render order (above solids). */
      oneWayZ: number;
      /** Bounce pad height in world units (8 idle, squashes on bounce). */
      bounceTileH: number;
      /** Live pad squash scale (1 idle, 0.6 at the 300ms peak). */
      padSquash?: number;
      /** Live prop count (probe count). */
      propCount?: number;
      /** Live pickup count (probe count). */
      pickupCount?: number;
      /** One-way plank height in world units (8). */
      oneWayTileH: number;
      /** Solid tile height in world units (32). */
      solidTileH: number;
      /** Total decorations on the active map (>=3 per map). */
      decorationCount: number;
      /** Decoration rects intersecting solid collision (always 0). */
      occludedTiles: number;
      /** Top-stop channels of the per-theme sky grade. */
      skyTop: { r: number; g: number; b: number };
      /** Vignette rim alpha (0.25, inside [0.15, 0.35]). */
      vignetteAlpha: number;
      /** Active post-effect quality (high keeps the hurt pulse). */
      quality?: QualityLevel;
      /** Live shockwave ring count (one per blast, 500ms life). */
      shockwaveCount?: number;
      /** Hurt-pulse strength in [0, 1] (150ms window, high only). */
      hurtPulse?: number;
      /** Defensive lights/decoration handling (always true after paint). */
      lightsRespected: boolean;
      /** True when the sky band covers the full canvas. */
      skyCoversViewport: boolean;
      /** Renderer fps exponential moving average (one decimal). */
      fps: number;
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
      tileDrawCalls?: number;
      bouncePadCount?: number;
      backwallCount?: number;
      oneWayCount?: number;
      backwallZ?: number;
      solidZ?: number;
      theme?: string;
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
      /** Pooled bright particles (muzzle/impact/explosion/jet/death/pickup). */
      particles: {
        x: number;
        y: number;
        opacity: number;
        color: number;
        css: string;
      }[];
      /** Live pooled particle count (capped at particleCap). */
      particleCount: number;
      /** Hard cap on live pooled particles. */
      particleCap: number;
      /** Per-emitter live-particle caps (Pixi pixi-v8-particles side). */
      fxCaps: Record<string, number>;
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
        /** Wall-clock run-cycle phase in radians. */
        legPhase: number;
        /** Signed leg offset in local px. */
        swing: number;
        /** Vertical squash (crouch ratio, else 1). */
        heightScale: number;
        /** True while inside the 150ms white hurt-flash window. */
        hurtFlash: boolean;
        /** Selected soldier frame id (additive; defaults sensibly pre-draw). */
        frame?: string;
        /** Equipped weapon id (additive; defaults sensibly pre-draw). */
        weapon?: string;
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
      /** Live pad squash scale (1 idle, 0.6 at the 300ms peak). */
      padSquash?: number;
      /** Live bounce pad height in world units (8 idle). */
      bounceTileH?: number;
      /** Live prop boxes with hp states. */
      props?: {
        x: number;
        y: number;
        w: number;
        h: number;
        kind: string;
        alive: boolean;
        hp: number;
        maxHp: number;
      }[];
      /** Live pickup markers with held weapons. */
      pickups?: {
        x: number;
        y: number;
        kind: string;
        active: boolean;
        weapon: string | null;
      }[];
      /** Renderer post-effect quality (mirrors the settings toggle). */
      quality?: QualityLevel;
      /** Live shockwave rings (radius/alpha at the current draw). */
      shockwaves?: {
        x: number;
        y: number;
        radius: number;
        alpha: number;
      }[];
      /** Hurt-pulse strength (high quality while a hurt flash is live). */
      hurtPulse?: number;
    };
  }
}

export {};
