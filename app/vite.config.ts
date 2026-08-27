/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  // Tauri runs the dev server; do not let Vite wipe its output.
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "esnext", sourcemap: true },
  // vite-plugin-solid picks Solid's SSR build unless the resolver is told to
  // prefer the browser/dev condition. Without this, any component test run
  // under Vitest (which runs in Node, not a browser) throws "Client-only API
  // called on the server side" the moment it renders anything reactive.
  resolve: { conditions: ["development", "browser"] },
  test: {
    // The engine is pure arithmetic, so it needs no DOM. UI tests opt into
    // jsdom per file with a `@vitest-environment` comment.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
