// Ambient for Vite `?raw` text imports. The client tsconfig sets
// `types: []` (no vite/client), so without this `tsc -b` rejects the
// static arena imports in maps.ts. Vite inlines the text at build time,
// keeping the staged dist/ self-contained.
declare module "*?raw" {
  const content: string;
  export default content;
}
