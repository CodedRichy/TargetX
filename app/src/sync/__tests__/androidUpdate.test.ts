// @vitest-environment jsdom
/**
 * The Android update check.
 *
 * Every failure here is silent by design, which is the same property that lets
 * a broken check sit unnoticed forever: an updater that never fires and an
 * updater that has nothing to offer look identical from outside. So the cases
 * are pinned rather than trusted - including the ones that must NOT offer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn(async () => {});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const getVersion = vi.fn(async () => "0.5.0");
vi.mock("@tauri-apps/api/app", () => ({ getVersion }));

let android = true;
vi.mock("../../state/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/platform")>()),
  isAndroid: () => android,
  isDesktopShell: () => false,
}));

import { checkForAndroidUpdate } from "../update";

const RELEASES = "https://github.com/CodedRichy/TargetX/releases/download/v0.6.0";

const feed = (body: unknown, ok = true) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok,
    json: async () => body,
  })));
};

beforeEach(() => {
  android = true;
  getVersion.mockResolvedValue("0.5.0");
  openUrl.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("offering an update", () => {
  it("offers a newer version, and opens its link in the browser", async () => {
    feed({ version: "0.6.0", url: `${RELEASES}/TargetX-0.6.0.apk`, notes: "  fixes  " });

    const found = await checkForAndroidUpdate();
    expect(found?.version).toBe("0.6.0");
    // Trimmed, because a feed written by hand will have stray whitespace and
    // it ends up in a tooltip.
    expect(found?.notes).toBe("fixes");

    await found!.open();
    expect(openUrl).toHaveBeenCalledWith(`${RELEASES}/TargetX-0.6.0.apk`);
  });

  it("says nothing when the newest release is the one running", async () => {
    feed({ version: "0.5.0", url: `${RELEASES}/TargetX-0.5.0.apk` });
    expect(await checkForAndroidUpdate()).toBeNull();
  });

  it("does not offer an older build as an update", async () => {
    getVersion.mockResolvedValue("0.7.0");
    feed({ version: "0.6.0", url: `${RELEASES}/TargetX-0.6.0.apk` });
    expect(await checkForAndroidUpdate()).toBeNull();
  });

  it("compares versions as numbers, so 0.10.0 beats 0.9.0", async () => {
    // The string comparison this looks like reports the opposite, and would
    // have stopped offering updates at the tenth minor release with no symptom
    // at all before then.
    getVersion.mockResolvedValue("0.9.0");
    feed({ version: "0.10.0", url: `${RELEASES}/TargetX-0.10.0.apk` });
    expect((await checkForAndroidUpdate())?.version).toBe("0.10.0");
  });
});

describe("refusing to act on a feed it does not trust", () => {
  it("ignores a link that is not a release of this project", async () => {
    // The feed is fetched over the network and its one job is to be handed to
    // `openUrl`. A tampered or mistaken entry pointing anywhere else is the
    // whole reason this check exists.
    feed({ version: "9.9.9", url: "https://example.com/evil.apk" });
    expect(await checkForAndroidUpdate()).toBeNull();
  });

  it("ignores a link to another GitHub project", async () => {
    feed({ version: "9.9.9", url: "https://github.com/someoneelse/app/releases/x.apk" });
    expect(await checkForAndroidUpdate()).toBeNull();
  });

  it("survives a feed with the fields missing", async () => {
    feed({ notes: "nothing useful here" });
    expect(await checkForAndroidUpdate()).toBeNull();
  });

  it("survives a feed that is not JSON at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => { throw new Error("not json"); },
    })));
    expect(await checkForAndroidUpdate()).toBeNull();
  });

  it("is silent when the network is gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await checkForAndroidUpdate()).toBeNull();
  });

  it("is silent when the file is not there yet", async () => {
    feed({ version: "0.6.0", url: `${RELEASES}/x.apk` }, false);
    expect(await checkForAndroidUpdate()).toBeNull();
  });
});

describe("staying off every other platform", () => {
  it("asks nothing at all when this is not a phone", async () => {
    android = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await checkForAndroidUpdate()).toBeNull();
    // Not merely a null answer: it must not reach the network either, because
    // this runs on every launch of every desktop build.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
