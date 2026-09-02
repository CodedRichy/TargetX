/// <reference types="vitest/config" />
/**
 * Config for the ask-box evaluator.
 *
 * Standalone rather than a merge of `vite.config.ts`: `mergeConfig` CONCATENATES
 * arrays, so extending it ran the whole 794-test suite alongside the evaluator.
 * The include list has to replace, not append.
 *
 * Kept out of the main config so the evaluator stays out of CI - it prints a
 * table for a human to read and asserts nothing.
 *
 *   npx vitest run --config vitest.eval.config.ts
 */
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

const version = JSON.parse(
  readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf-8"),
).version as string;

export default defineConfig({
  plugins: [solid()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { conditions: ["development", "browser"] },
  test: {
    environment: "node",
    include: ["src/**/*.eval.tsx"],
    testTimeout: 30000,
  },
});
