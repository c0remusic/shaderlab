import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Single source of truth for the `@`→./src alias, shared with vitest.config.ts.
export const alias = {
  "@": path.resolve(__dirname, "./src"),
};

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias,
  },

  // Vite options tailored for Tauri to prevent too much magic
  clearScreen: false,

  // Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Using polling since fsEvents doesn't work on all platforms
      usePolling: true,
    },
  },

  // To make use of `TAURI_DEBUG` and other env variables
  // https://tauri.app/2/reference/rust-api/tauri/struct.Config#env
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri supports es2021
    target:
      process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));
