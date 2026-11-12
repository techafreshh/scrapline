import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Absolute root: the workspace build runs with this package as its cwd,
// so derive the client dir from this file's own URL instead of relying
// on the caller's working directory.
const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  root,
  // Relative asset URLs so the staged root dist/ plays offline from
  // file:// and subpath static hosts; served-at-/ still resolves.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // No sourcemaps in the shipped bundle: keeps dist/ small for the
    // <50MB static-hosting budget and server.js routes stable.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Fixed names so server.js routes stay stable across builds.
        entryFileNames: "main.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
