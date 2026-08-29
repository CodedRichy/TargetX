// @vitest-environment jsdom
/**
 * Update checking.
 *
 * Two things here are worth holding down with tests rather than intentions.
 *
 * The first is that the check FAILS SILENT. A student opening the app in a
 * lecture hall with no signal must see nothing at all - not a toast, not a
 * red banner, not a thrown error that reaches the launch path. Every failure
 * mode has to come back as the same plain null, and there is no way to see
 * from the call site whether that null meant "up to date" or "GitHub is down".
 *
 * The second is the progress arithmetic, which is the only real computation in
 * the module and is exactly the kind of thing that looks obviously right and
 * divides by zero in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const check = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

/** Pretend to be inside the desktop shell. */
function inShell(yes: boolean) {
  if (yes) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

beforeEach(() => { check.mockReset(); inShell(true); });
afterEach(() => { inShell(false); });

/** A stand-in for the plugin's Update object. */
function fakeUpdate(body: string | undefined, events: unknown[] = []) {
  return {
    version: "0.2.0",
    body,
    downloadAndInstall: vi.fn(async (onEvent?: (e: unknown) => void) => {
      for (const e of events) onEvent?.(e);
    }),
  };
}

describe("the check never surfaces a failure", () => {
  it("returns null outside the desktop shell without calling the plugin", async () => {
    inShell(false);
    const { checkForUpdate, canUpdate } = await import("../update");
    expect(canUpdate()).toBe(false);
    expect(await checkForUpdate()).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it("returns null when the network call throws", async () => {
    check.mockRejectedValue(new Error("getaddrinfo ENOTFOUND github.com"));
    const { checkForUpdate } = await import("../update");
    // Explicitly NOT a rejection: an offline student is not an error state.
    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it("returns null when there is simply no update", async () => {
    check.mockResolvedValue(null);
    const { checkForUpdate } = await import("../update");
    expect(await checkForUpdate()).toBeNull();
  });
});

describe("what it reports when an update exists", () => {
  it("carries the version and the release notes", async () => {
    check.mockResolvedValue(fakeUpdate("Fixes the attendance bug."));
    const { checkForUpdate } = await import("../update");
    const found = await checkForUpdate();
    expect(found?.version).toBe("0.2.0");
    expect(found?.notes).toBe("Fixes the attendance bug.");
  });

  it("treats a blank or missing body as no notes, not as an empty string", async () => {
    // An empty string would render an empty tooltip attribute rather than
    // none, which is the sort of thing that only shows up on a real release.
    check.mockResolvedValue(fakeUpdate("   "));
    const { checkForUpdate } = await import("../update");
    expect((await checkForUpdate())?.notes).toBeNull();

    check.mockResolvedValue(fakeUpdate(undefined));
    expect((await checkForUpdate())?.notes).toBeNull();
  });
});

describe("download progress", () => {
  const run = async (events: unknown[]) => {
    check.mockResolvedValue(fakeUpdate("x", events));
    const { checkForUpdate } = await import("../update");
    const found = await checkForUpdate();
    const seen: (number | null)[] = [];
    await found!.install((f) => seen.push(f));
    return seen;
  };

  it("reports a fraction of the declared length", async () => {
    expect(await run([
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 25 } },
      { event: "Progress", data: { chunkLength: 25 } },
      { event: "Finished" },
    ])).toEqual([0, 0.25, 0.5, 1]);
  });

  it("reports null - not zero - when the server declares no length", async () => {
    // Zero would render a bar sitting at 0% for the whole download, which
    // reads as a stall. Null is the caller's cue to show movement instead.
    expect(await run([
      { event: "Started", data: { contentLength: 0 } },
      { event: "Progress", data: { chunkLength: 4096 } },
    ])).toEqual([null, null]);
  });

  it("survives a Started event with no contentLength field at all", async () => {
    expect(await run([
      { event: "Started", data: {} },
      { event: "Progress", data: { chunkLength: 10 } },
    ])).toEqual([null, null]);
  });

  it("clamps at 1 when the server under-reports its own length", async () => {
    // Measured: 60 + 60 over a declared 100 is 1.2, and a bar past full reads
    // as a fault rather than as a nearly-finished download.
    expect(await run([
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 60 } },
      { event: "Progress", data: { chunkLength: 60 } },
    ])).toEqual([0, 0.6, 1]);
  });
});
