/**
 * The launch sync.
 *
 * Its preconditions matter more than its happy path. This runs without anybody
 * asking for it, using a password out of the OS vault, against a college's
 * server - so the cases worth pinning are the ones where it must decline to
 * run, and the guarantee that it never throws into an `onMount` that has no
 * catch around it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const canSync = vi.fn(() => true);
const fullSync = vi.fn();
const canRemember = vi.fn(() => true);
const loadCreds = vi.fn();
const applySync = vi.fn();

vi.mock("../../sync/etlab", () => ({
  canSync: () => canSync(),
  fullSync: (...a: unknown[]) => fullSync(...a),
  EtlabError: class extends Error {},
}));
vi.mock("../creds", () => ({
  canRemember: () => canRemember(),
  loadCreds: (...a: unknown[]) => loadCreds(...a),
}));
vi.mock("../actions", () => ({ applySync: (...a: unknown[]) => applySync(...a) }));

const { AUTO_SYNC_GAP_MS, autoSync, autoSyncError, syncIsStale } =
  await import("../autosync");
const { edit } = await import("../store");

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  canSync.mockReturnValue(true);
  canRemember.mockReturnValue(true);
  loadCreds.mockResolvedValue({ username: "24CS211", password: "secret" });
  fullSync.mockResolvedValue({ semesters: {}, history: {} });
  edit((s) => {
    s.student.college = "https://portal.example.edu";
    s.lastSync = ago(AUTO_SYNC_GAP_MS + 60_000);
  });
});

describe("preconditions", () => {
  it("does nothing in a build that cannot sync at all", async () => {
    canSync.mockReturnValue(false);
    expect(await autoSync()).toBe("unavailable");
    expect(loadCreds).not.toHaveBeenCalled();
  });

  it("does nothing where there is no credential vault", async () => {
    canRemember.mockReturnValue(false);
    expect(await autoSync()).toBe("unavailable");
    expect(loadCreds).not.toHaveBeenCalled();
  });

  it("does nothing before a college address is configured", async () => {
    edit((s) => { s.student.college = ""; });
    expect(await autoSync()).toBe("unavailable");
    expect(loadCreds).not.toHaveBeenCalled();
  });

  it("never prompts and never syncs without a saved login", async () => {
    loadCreds.mockResolvedValue(null);
    expect(await autoSync()).toBe("no-creds");
    expect(fullSync).not.toHaveBeenCalled();
  });

  it("treats a vault that will not answer as simply unavailable", async () => {
    loadCreds.mockRejectedValue(new Error("vault locked"));
    expect(await autoSync()).toBe("unavailable");
    expect(fullSync).not.toHaveBeenCalled();
    // Not the student's problem: they never asked for this sync.
    expect(autoSyncError()).toBeNull();
  });
});

describe("throttling", () => {
  it("skips a sync that just happened", async () => {
    edit((s) => { s.lastSync = ago(60_000); });
    expect(await autoSync()).toBe("fresh");
    expect(fullSync).not.toHaveBeenCalled();
  });

  it("runs once the gap has passed", async () => {
    expect(await autoSync()).toBe("ok");
    expect(fullSync).toHaveBeenCalledOnce();
    expect(applySync).toHaveBeenCalledOnce();
  });

  it("treats a record that was never synced as stale", () => {
    edit((s) => { s.lastSync = undefined; });
    expect(syncIsStale()).toBe(true);
  });

  it("treats an unparseable timestamp as never synced rather than as fresh", () => {
    edit((s) => { s.lastSync = "not a date"; });
    expect(syncIsStale()).toBe(true);
  });
});

describe("failure", () => {
  it("reports rather than throws, because nothing catches it", async () => {
    fullSync.mockRejectedValue(new Error("etlab is down"));
    await expect(autoSync()).resolves.toBe("failed");
    expect(autoSyncError()).toBe("etlab is down");
    expect(applySync).not.toHaveBeenCalled();
  });

  it("clears the previous failure when a later sync works", async () => {
    fullSync.mockRejectedValue(new Error("etlab is down"));
    await autoSync();
    expect(autoSyncError()).not.toBeNull();

    fullSync.mockResolvedValue({ semesters: {}, history: {} });
    edit((s) => { s.lastSync = ago(AUTO_SYNC_GAP_MS + 60_000); });
    await autoSync();
    expect(autoSyncError()).toBeNull();
  });
});
