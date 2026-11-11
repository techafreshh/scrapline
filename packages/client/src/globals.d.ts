// Window augmentation for the client mirrors. Kept in a separate
// declaration file so main.ts stays modular while still typechecking
// under strict DOM lib settings.
import type { InputMirror } from "./input";

declare global {
  interface Window {
    __scraplineTick: number;
    __scraplineInput: InputMirror;
  }
}

export {};
