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
    };
  }
}

export {};
