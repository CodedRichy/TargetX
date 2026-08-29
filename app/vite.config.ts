/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/**
 * The version, taken from the one file that decides it.
 *
 * `tauri.conf.json` is what the updater compares against, so it is the only
 * honest answer to "which build is this". Reading it here rather than keeping
 * a second copy in `package.json` means the number a student reads off the
 * Data screen and the number an update is offered against cannot disagree.
 */
const version = JSON.parse(
  readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf-8"),
).version as string;

export default defineConfig({
  plugins: [solid()],
  define: { __APP_VERSION__: JSON.stringify(version) },
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
