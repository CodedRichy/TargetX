/**
 * Refreshing both portals.
 *
 * The preconditions matter more than the happy path. This runs without anybody
 * asking for it, using passwords out of the OS vault, against two colleges'
 * servers - so the cases worth pinning are the ones where it must decline to
 * run, the guarantee that one portal cannot sink the other, and the guarantee
 * that nothing ever throws into an `onMount` that has no catch around it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const canSync = vi.fn(() => true);
const canSyncKtu = vi.fn(() => true);
const fullSync = vi.fn();
const syncKtu = vi.fn();
const canRemember = vi.fn(() => true);
const loadCreds = vi.fn();
const applySync = vi.fn();

vi.mock("../../sync/etlab", () => ({
  canSync: () => canSync(),
  fullSync: (...a: unknown[]) => fullSync(...a),
  EtlabError: class extends Error {},
}));
vi.mock("../../sync/ktu", () => ({ canSyncKtu: () => canSyncKtu() }));
vi.mock("../creds", () => ({
  KTU_CRED_KEY: "https://app.ktu.edu.in",
  canRemember: () => canRemember(),
  loadCreds: (...a: unknown[]) => loadCreds(...a),
}));
vi.mock("../actions", () => ({
  applySync: (...a: unknown[]) => applySync(...a),
  syncKtu: (...a: unknown[]) => syncKtu(...a),
}));

const {
  AUTO_SYNC_GAP_MS, autoRefresh, refreshAll, refreshFailures, syncIsStale,
} = await import("../autosync");
const { edit } = await import("../store");

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const of = (r: { results: Array<{ source: string; status: string }> }, source: string) =>
  r.results.find((x) => x.source === source)!;

beforeEach(() => {
  vi.clearAllMocks();
  canSync.mockReturnValue(true);
  canSyncKtu.mockReturnValue(true);
  canRemember.mockReturnValue(true);
  loadCreds.mockResolvedValue({ username: "24CS211", password: "secret" });
  fullSync.mockResolvedValue({ semesters: {}, history: {} });
  syncKtu.mockResolvedValue({ fetched: ["S4"], courses: 7, semesters: 1, mismatched: [] });
  edit((s) => {
    s.student.college = "https://portal.example.edu";
    s.lastSync = ago(AUTO_SYNC_GAP_MS + 60_000);
  });
});

describe("preconditions", () => {
  it("does nothing in a build that cannot reach either portal", async () => {
    canSync.mockReturnValue(false);
    canSyncKtu.mockReturnValue(false);
    const r = await refreshAll();

    expect(of(r, "etlab").status).toBe("unavailable");
    expect(of(r, "ktu").status).toBe("unavailable");
    expect(loadCreds).not.toHaveBeenCalled();
  });

  it("does not touch etlab before a college address is configured", async () => {
    edit((s) => { s.student.college = ""; });
    const r = await refreshAll();

    expect(of(r, "etlab").status).toBe("unavailable");
    expect(fullSync).not.toHaveBeenCalled();
    // KTU has its own fixed address and is unaffected by that gap.
    expect(of(r, "ktu").status).toBe("ok");
  });

  it("never prompts and never syncs a portal with no saved login", async () => {
    loadCreds.mockResolvedValue(null);
    const r = await refreshAll();

    expect(of(r, "etlab").status).toBe("no-creds");
    expect(of(r, "ktu").status).toBe("no-creds");
    expect(fullSync).not.toHaveBeenCalled();
    expect(syncKtu).not.toHaveBeenCalled();
  });

  it("treats a vault that will not answer as simply absent", async () => {
    loadCreds.mockRejectedValue(new Error("vault locked"));
    const r = await refreshAll();

    // Not "failed": the student never asked for this, and the answer either way
    // is that there is nothing to log in with.
    expect(of(r, "etlab").status).toBe("no-creds");
    expect(refreshFailures()).toEqual([]);
  });

  it("reads each portal's login under its own vault key", async () => {
    await refreshAll();
    const keys = loadCreds.mock.calls.map((c) => c[0]);
    expect(keys).toContain("https://portal.example.edu");
    expect(keys).toContain("https://app.ktu.edu.in");
  });
});

describe("independence", () => {
  it("still refreshes attendance when KTU is down", async () => {
    syncKtu.mockRejectedValue(new Error("KTU login rejected."));
    const r = await refreshAll();

    expect(of(r, "etlab").status).toBe("ok");
    expect(applySync).toHaveBeenCalledOnce();
    expect(of(r, "ktu").status).toBe("failed");
  });

  it("still fetches results when etlab is down", async () => {
    fullSync.mockRejectedValue(new Error("etlab is down"));
    const r = await refreshAll();

    expect(of(r, "ktu").status).toBe("ok");
    expect(syncKtu).toHaveBeenCalledOnce();
    expect(of(r, "etlab").status).toBe("failed");
  });

  it("reports one row per failed portal, never a merged failure", async () => {
    fullSync.mockRejectedValue(new Error("etlab is down"));
    syncKtu.mockRejectedValue(new Error("KTU login rejected."));
    await refreshAll();

    expect(refreshFailures().map((f) => f.source).sort()).toEqual(["etlab", "ktu"]);
    expect(refreshFailures().map((f) => f.detail))
      .toEqual(expect.arrayContaining(["etlab is down", "KTU login rejected."]));
  });

  it("never throws, because onMount has nothing to catch it", async () => {
    fullSync.mockRejectedValue(new Error("etlab is down"));
    syncKtu.mockRejectedValue(new Error("KTU login rejected."));
    await expect(refreshAll()).resolves.toBeDefined();
  });

  it("clears an earlier failure once a later run works", async () => {
    fullSync.mockRejectedValue(new Error("etlab is down"));
    await refreshAll();
    expect(refreshFailures()).toHaveLength(1);

    fullSync.mockResolvedValue({ semesters: {}, history: {} });
    await refreshAll();
    expect(refreshFailures()).toEqual([]);
  });
});

describe("throttling", () => {
  it("skips an automatic refresh that just happened", async () => {
    edit((s) => { s.lastSync = ago(60_000); });
    expect(await autoRefresh()).toBeNull();
    expect(fullSync).not.toHaveBeenCalled();
    expect(syncKtu).not.toHaveBeenCalled();
  });

  it("runs automatically once the gap has passed", async () => {
    expect(await autoRefresh()).not.toBeNull();
    expect(fullSync).toHaveBeenCalledOnce();
  });

  it("does not throttle a manual refresh - the student just pressed it", async () => {
    edit((s) => { s.lastSync = ago(60_000); });
    const r = await refreshAll();

    expect(of(r, "etlab").status).toBe("ok");
    expect(fullSync).toHaveBeenCalledOnce();
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
