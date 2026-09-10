// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Which platforms have somewhere to put the portal password.
 *
 * This gate is load-bearing far beyond the checkbox it draws. `autosync`
 * refuses to run without a stored login, so for as long as `canRemember` was
 * false on Android the refresh button contacted no portal at all and reopening
 * the app brought nothing down - the two symptoms reported in issue #16, which
 * looked like separate faults and were one missing store.
 *
 * The opposite failure is the one that made the gate necessary in the first
 * place: a checkbox offered where nothing is behind it silently stores nothing
 * and unticks itself, and a student reasonably concludes their password is in
 * a vault. So this is pinned per platform rather than left to a boolean that
 * happened to read correctly on the machine it was written on.
 */
/**
 * jsdom's own window is patched rather than replaced: `platform.ts` attaches a
 * listener at import time, so a bare object stands in for a window only until
 * the module actually uses one.
 */
const load = async (ua: string, shell = true) => {
  vi.resetModules();
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
  if (shell) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  return import("../creds");
};

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("canRemember", () => {
  it("is true on Android, which now has a Keystore-backed store", async () => {
    const { canRemember } = await load(ANDROID);
    expect(canRemember()).toBe(true);
  });

  it("is true in the desktop shell", async () => {
    const { canRemember } = await load(DESKTOP);
    expect(canRemember()).toBe(true);
  });

  it("is false in a plain browser, which has no vault of any kind", async () => {
    // Not a theoretical case: the same bundle runs in a browser during
    // development, and offering to "remember" there would mean localStorage,
    // which is exactly where this password must never go.
    const { canRemember } = await load(DESKTOP, false);
    expect(canRemember()).toBe(false);
  });
});

describe("vaultName", () => {
  it("names the Android store on Android", async () => {
    // The copy used to say "Windows Credential Manager" everywhere, which on a
    // phone was a promise about something that does not exist there.
    const { vaultName } = await load(ANDROID);
    expect(vaultName()).toBe("the Android Keystore");
  });

  it("names Credential Manager on the desktop", async () => {
    const { vaultName } = await load(DESKTOP);
    expect(vaultName()).toBe("Windows Credential Manager");
  });
});
