// Window augmentation for the skeleton tick counter. Kept in a separate
// declaration file so main.ts stays in the JavaScript subset of TypeScript
// (no type syntax) while still typechecking under strict DOM lib settings.
interface Window {
  __scraplineTick: number;
}
