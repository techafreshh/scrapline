import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Absolute root: the workspace build runs with this package as its cwd,
// so derive the client dir from this file's own URL instead of relying
// on the caller's working directory.
const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  root,
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
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
