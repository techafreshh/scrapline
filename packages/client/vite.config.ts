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
        // Fixed entry name so the server.js /main.js route stays stable
        // across builds; the lazy PixiJS chunk lands as a separate
        // pixi-<hash>.js file (>200kB) instead of a synchronously-loaded
        // vendor bundle. No manualChunks: Vite's automatic code-splitting
        // already isolates the dynamic import("pixi.js") in
        // renderer/index.ts into its own chunk with a truly async import
        // (manualChunks hoists the vite preload helper into the pixi
        // chunk and entry gains a blocking static `from pixi-*.js`
        // import). The chunkFileNames function only renames the
        // pixi-containing chunk to pixi-[hash].js; entry stays main.js.
        entryFileNames: "main.js",
        chunkFileNames(chunkInfo) {
          // The automatic split names the dynamic pixi.js chunk "lib"
          // (after the package entry dir); rename just that chunk so
          // the bundle exposes assets/pixi-[hash].js (>200kB).
          if (chunkInfo.name === "lib") {
            return "assets/pixi-[hash].js";
          }
          return "assets/[name]-[hash].js";
        },
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
