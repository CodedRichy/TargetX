/**
 * The diagnostics path.
 *
 * Every one of these is about the failure path, not the happy one. This is the
 * code a student reaches only when something is already broken, so the way it
 * fails matters more than the way it works.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const asTauri = () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
};

describe("logDir", () => {
  beforeEach(() => { invoke.mockReset(); });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("returns null in a browser build without calling the backend", async () => {
    const { logDir } = await import("../diagnostics");
    expect(await logDir()).toBeNull();
    // The invoke bridge does not exist here. Calling it would throw inside
    // `npm run dev`, where the whole UI is otherwise usable.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns the folder the backend reports", async () => {
    asTauri();
    invoke.mockResolvedValue("C:\Users\a\AppData\Local\cv.codedrichy.targetx\logs");
    const { logDir } = await import("../diagnostics");
    expect(await logDir()).toBe("C:\Users\a\AppData\Local\cv.codedrichy.targetx\logs");
  });

  it("returns null rather than throwing when the command fails", async () => {
    asTauri();
    invoke.mockRejectedValue(new Error("no log dir"));
    const { logDir } = await import("../diagnostics");
    // A diagnostics feature that raises its own error dialog helps nobody.
    await expect(logDir()).resolves.toBeNull();
  });

  it("treats an empty path as nothing to show", async () => {
    asTauri();
    invoke.mockResolvedValue("");
    const { logDir } = await import("../diagnostics");
    expect(await logDir()).toBeNull();
  });
});
