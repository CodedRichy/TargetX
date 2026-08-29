// @vitest-environment jsdom
/**
 * The file behind the marks.
 *
 * Before this branch a semester of typed marks existed only in `localStorage`
 * and a failed write was caught and discarded. Everything below is about the
 * two halves of that: that a real file is written, atomically, with prior
 * copies kept; and that when it cannot be, somebody is told.
 *
 * The Tauri modules are replaced with an in-memory filesystem that RECORDS
 * every call, because the property that matters here is not "the bytes ended
 * up right" - it is the ORDER of the operations that got them there. A
 * truncate-then-write leaves the same bytes and loses a semester on a crash.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const fail: { write: string | null; rename: string | null; copy: string | null } =
    { write: null, rename: null, copy: null };
  return { files, calls, fail };
});

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "APPDATA",
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: async () => { /* the folder is assumed to exist in memory */ },
  exists: async (p: string) => fake.files.has(p),
  readTextFile: async (p: string) => {
    const v = fake.files.get(p);
    if (v === undefined) throw new Error(`no such file: ${p}`);
    return v;
  },
  writeTextFile: async (p: string, c: string) => {
    fake.calls.push(`write ${p}`);
    if (fake.fail.write) throw new Error(fake.fail.write);
    fake.files.set(p, c);
  },
  rename: async (a: string, b: string) => {
    fake.calls.push(`rename ${a} -> ${b}`);
    if (fake.fail.rename) throw new Error(fake.fail.rename);
    const v = fake.files.get(a);
    if (v === undefined) throw new Error(`no such file: ${a}`);
    // Matches what was measured of `std::fs::rename` on Windows 11: the
    // destination is replaced if it exists, rather than the call failing.
    fake.files.set(b, v);
    fake.files.delete(a);
  },
  copyFile: async (a: string, b: string) => {
    fake.calls.push(`copy ${a} -> ${b}`);
    if (fake.fail.copy) throw new Error(fake.fail.copy);
    const v = fake.files.get(a);
    if (v === undefined) throw new Error(`no such file: ${a}`);
    fake.files.set(b, v);
  },
}));

const KEY = "targetx.state.v1";
const FILE = "APPDATA/state.json";
const TEMP = "APPDATA/state.json.tmp";

/** A minimal but well-shaped save, stamped at a chosen moment. */
function saved(semester: string, attendance: number, savedAt: string) {
  return JSON.stringify({
    version: 1, scheme: "KTU 2024",
    student: { name: "", reg_no: "", branch: "", college: "" },
    activeSemester: semester, etlab: {},
    semesters: { [semester]: { courses: [
      { code: "PCCST301", name: "Data Structures", credits: 4, type: "TH 40/60",
        s1: "", s2: "", other: "", s1_max: "", s2_max: "", other_max: "",
        attendance, attended: "", held: "", dl: "",
        ese: "", target: "B+", cie_override: "", portal_grade: null },
    ] } },
    history: {}, savedAt,
  });
}

/** A fresh module graph, so `store.ts` builds its store from scratch. */
async function boot() {
  vi.resetModules();
  return await import("../store");
}

/**
 * Pay the cold import once, before any test is being timed.
 *
 * `boot()` calls `vi.resetModules()` and re-imports `../store`, which pulls
 * the whole engine graph behind it. Measured on this machine: the FIRST such
 * import costs 922 ms and every later one is under a millisecond, because what
 * is expensive is resolving and transforming the graph, not re-executing it -
 * and `resetModules` clears the module registry but not Vite's transform
 * cache.
 *
 * Whichever test ran first therefore carried ~922 ms that had nothing to do
 * with it. Alone that fits inside the 5 s limit; in the full 22-file run, with
 * the 144-test engine suite saturating the CPU in parallel workers, it does
 * not - the first test in this file timed out roughly one run in seven. That
 * is a flake in a suite CI now gates on, so the cost is moved here rather than
 * hidden under a raised timeout: a real 5-second hang should still fail.
 */
beforeAll(async () => { await import("../store"); });

beforeEach(() => {
  fake.files.clear();
  fake.calls.length = 0;
  fake.fail.write = fake.fail.rename = fake.fail.copy = null;
  localStorage.clear();
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("the record is a file, and localStorage is the spare", () => {
  it("writes the file from localStorage on the first run of this build", async () => {
    // The whole installed base is here: data in localStorage, no file yet.
    localStorage.setItem(KEY, saved("S3", 82, "2026-08-20T10:00:00.000Z"));
    const store = await boot();
    await store.hydrate();

    expect(fake.files.has(FILE)).toBe(true);
    const onDisk = JSON.parse(fake.files.get(FILE)!) as {
      semesters: Record<string, { courses: Array<{ attendance: number }> }>;
    };
    expect(onDisk.semesters["S3"]!.courses[0]!.attendance).toBe(82);
  });

  it("leaves the localStorage copy in place after that migration", async () => {
    // Deliberate for at least this version: the file is new and unproven on
    // every machine it has never run on, and the copy it was built from costs
    // nothing to keep.
    localStorage.setItem(KEY, saved("S3", 82, "2026-08-20T10:00:00.000Z"));
    const store = await boot();
    await store.hydrate();
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it("prefers the file over the localStorage copy", async () => {
    localStorage.setItem(KEY, saved("S3", 40, "2026-08-20T10:00:00.000Z"));
    fake.files.set(FILE, saved("S3", 91, "2026-08-21T10:00:00.000Z"));
    const store = await boot();
    await store.hydrate();
    expect(store.state.semesters["S3"]!.courses[0]!.attendance).toBe(91);
  });

  it("takes the localStorage copy when it is provably the later one", async () => {
    // How a run that was killed between the synchronous localStorage write and
    // the file landing looks on the next launch. Showing the student the file
    // here would delete a mark they had already typed.
    localStorage.setItem(KEY, saved("S3", 55, "2026-08-21T10:00:05.000Z"));
    fake.files.set(FILE, saved("S3", 40, "2026-08-21T10:00:00.000Z"));
    const store = await boot();
    await store.hydrate();
    expect(store.state.semesters["S3"]!.courses[0]!.attendance).toBe(55);
    // And it is put back on disk, so the two do not disagree a second time.
    const onDisk = JSON.parse(fake.files.get(FILE)!) as {
      semesters: Record<string, { courses: Array<{ attendance: number }> }>;
    };
    expect(onDisk.semesters["S3"]!.courses[0]!.attendance).toBe(55);
  });

  it("does not overwrite a file it could not read", async () => {
    fake.files.set(FILE, "{ this is not json");
    const store = await boot();
    await store.hydrate();
    expect(fake.files.get(FILE)).toBe("{ this is not json");
    expect(store.saveFault()?.kind).toBe("file");
  });
});

describe("every write is a temp file and a rename", () => {
  it("never writes into the record itself", async () => {
    fake.files.set(FILE, saved("S3", 40, "2026-08-01T10:00:00.000Z"));
    const store = await boot();
    await store.hydrate();
    fake.calls.length = 0;
    store.edit((s) => { s.activeSemester = "S4"; });
    await store.flush();

    // Truncate-then-write is the thing being ruled out: the only call naming
    // the record is the rename that lands on it.
    // Exact, not a prefix: `state.json.tmp` starts with `state.json`.
    expect(fake.calls.filter((c) => c === `write ${FILE}`)).toEqual([]);
    expect(fake.calls).toContain(`write ${TEMP}`);
    expect(fake.calls).toContain(`rename ${TEMP} -> ${FILE}`);
    expect(fake.calls.indexOf(`write ${TEMP}`))
      .toBeLessThan(fake.calls.indexOf(`rename ${TEMP} -> ${FILE}`));
  });

  it("leaves the previous record readable if the write of the new one fails", async () => {
    const before = saved("S3", 40, "2026-08-01T10:00:00.000Z");
    fake.files.set(FILE, before);
    const store = await boot();
    await store.hydrate();
    fake.fail.write = "no space left on device";
    store.edit((s) => { s.activeSemester = "S4"; });
    await store.flush();

    expect(fake.files.get(FILE)).toBe(before);
    expect(store.saveFault()?.kind).toBe("file");
  });
});

describe("backups", () => {
  it("keeps exactly BACKUP_COUNT prior copies, cascading them", async () => {
    const { BACKUP_COUNT } = await import("../persist");
    fake.files.set(FILE, saved("S3", 40, "2026-08-01T10:00:00.000Z"));
    for (let n = 1; n <= BACKUP_COUNT; n++) {
      fake.files.set(`APPDATA/state.bak${n}.json`, `older-${n}`);
    }
    const store = await boot();
    await store.hydrate();
    store.edit((s) => { s.activeSemester = "S4"; });
    await store.flush();

    // Slot 1 becomes what the record held on launch; every other slot has
    // shifted one along, and the oldest has gone. Counting them here means a
    // change to BACKUP_COUNT that does not change the cascade fails this test.
    expect(fake.files.get("APPDATA/state.bak1.json"))
      .toBe(saved("S3", 40, "2026-08-01T10:00:00.000Z"));
    expect(fake.files.get("APPDATA/state.bak2.json")).toBe("older-1");
    expect(fake.files.get("APPDATA/state.bak3.json")).toBe("older-2");
    expect(fake.files.has(`APPDATA/state.bak${BACKUP_COUNT + 1}.json`)).toBe(false);
  });

  it("takes one backup per launch, not one per keystroke", async () => {
    fake.files.set(FILE, saved("S3", 40, "2026-08-01T10:00:00.000Z"));
    const store = await boot();
    await store.hydrate();
    for (const sem of ["S4", "S5", "S6", "S7"]) {
      store.edit((s) => { s.activeSemester = sem; });
      await store.flush();
    }
    // Five saves in this session (the migration check plus four edits), one
    // copy. Per-save backups would hold the same file three times over.
    expect(fake.calls.filter((c) => c.startsWith("copy "))).toHaveLength(1);
  });

  it("still writes the record when the backup copy cannot be taken", async () => {
    fake.files.set(FILE, saved("S3", 40, "2026-08-01T10:00:00.000Z"));
    const store = await boot();
    await store.hydrate();
    fake.fail.copy = "Access is denied. (os error 5)";
    store.edit((s) => { s.activeSemester = "S9"; });
    await store.flush();

    const onDisk = JSON.parse(fake.files.get(FILE)!) as { activeSemester: string };
    expect(onDisk.activeSemester).toBe("S9");
    expect(store.saveFault()?.kind).toBe("backup");
  });
});

describe("a failed save is reported, not swallowed", () => {
  it("clears the warning once a save gets through", async () => {
    fake.files.set(FILE, saved("S3", 40, "2026-08-01T10:00:00.000Z"));
    const store = await boot();
    await store.hydrate();
    fake.fail.rename = "Access is denied. (os error 5)";
    store.edit((s) => { s.activeSemester = "S4"; });
    await store.flush();
    expect(store.saveFault()?.kind).toBe("file");

    fake.fail.rename = null;
    store.edit((s) => { s.activeSemester = "S5"; });
    await store.flush();
    expect(store.saveFault()).toBeNull();
  });

  it("reports a browser with no storage and no file behind it", async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const store = await boot();
    const setItem = vi.spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => { throw new Error("QuotaExceededError"); });
    try {
      store.edit((s) => { s.activeSemester = "S4"; });
      await store.flush();
    } finally {
      setItem.mockRestore();
    }
    expect(store.saveFault()?.kind).toBe("browser");
  });

  it("says nothing when a browser without Tauri saves fine", async () => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const store = await boot();
    await store.hydrate();
    store.edit((s) => { s.activeSemester = "S4"; });
    await store.flush();
    expect(store.saveFault()).toBeNull();
    expect(localStorage.getItem(KEY)).toContain("S4");
    // Nothing reached the filesystem: a browser has none, and pretending
    // otherwise is what would break `npm run dev` and every test above.
    expect(fake.calls).toEqual([]);
  });
});

describe("the debounce", () => {
  it("collapses a typed field into one save, and flushes on demand", async () => {
    vi.useFakeTimers();
    try {
      fake.files.set(FILE, saved("S3", 40, "2026-08-01T10:00:00.000Z"));
      const store = await boot();
      await store.hydrate();
      fake.calls.length = 0;

      // Three keystrokes 200 ms apart - typing "82" into an attendance box.
      // The measured window is SAVE_DEBOUNCE_MS; assert against the constant
      // so lowering it below a typing cadence fails here rather than in
      // production.
      expect(store.SAVE_DEBOUNCE_MS).toBeGreaterThan(3 * 200);
      for (let i = 0; i < 3; i++) {
        store.edit((s) => { s.activeSemester = `S${i + 4}`; });
        vi.advanceTimersByTime(200);
      }
      expect(fake.calls).toEqual([]);

      vi.advanceTimersByTime(store.SAVE_DEBOUNCE_MS);
      await vi.runAllTimersAsync();
      expect(fake.calls.filter((c) => c.startsWith(`rename ${TEMP}`))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
