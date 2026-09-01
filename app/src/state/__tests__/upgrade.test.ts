// @vitest-environment jsdom
/**
 * A record written by an older build still opens.
 *
 * This is the only defect class in the app with no undo. A student who has
 * carried four semesters since v0.1.0 installs an update, and if the newer
 * build cannot read what the older one wrote, the honest outcomes are a crash
 * on launch or a silently empty record - and the update is automatic, so they
 * did not choose the moment.
 *
 * The payload below is the shape v0.1.0 actually wrote, read off the `AppState`
 * interface at that tag rather than assumed: `version`, `scheme`, `student`,
 * `activeSemester`, `etlab`, `semesters`, `history`, and optional `goal`,
 * `onboarded`, `theme` and `lastSync`. Everything the app has grown since -
 * `timetable`, `daywiseAttendance`, `changes` - is absent, because in a real
 * v0.1.0 file it is absent.
 *
 * The assertion is not "it does not throw". It is that the numbers are still
 * the same numbers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "targetx.state.v1";

/** Exactly what a v0.1.0 build wrote, and nothing a later one added. */
const V0_1_0 = {
  version: 1,
  scheme: "KTU 2024",
  student: { name: "A Student", reg_no: "MUT24CS130", branch: "CSE", college: "MITS" },
  activeSemester: "S5",
  etlab: {},
  semesters: {
    S5: {
      courses: [
        {
          code: "PCCST501", name: "Computer Networks", credits: 4, type: "TH 40/60",
          s1: 30, s2: 28, other: 8, attended: 44, held: 50, dl: 0,
        },
        {
          code: "PCCST503", name: "Compiler Design", credits: 4, type: "TH 40/60",
          s1: 22, s2: 20, other: 6, attended: 33, held: 50, dl: 2,
        },
      ],
    },
  },
  history: {
    S3: { sgpa: 8.2, creditsRegistered: 20, creditsEarned: 20, source: "gradecard", conflict: null },
    S4: { sgpa: 7.6, creditsRegistered: 22, creditsEarned: 22, source: "gradecard", conflict: null },
  },
  goal: { cgpa: 8.5 },
  onboarded: true,
  theme: "dark",
  lastSync: "2026-08-30T09:00:00.000Z",
};

async function open(payload: unknown) {
  localStorage.clear();
  localStorage.setItem(KEY, JSON.stringify(payload));
  vi.resetModules();
  return await import("../store");
}

beforeEach(() => { localStorage.clear(); });

describe("a v0.1.0 record opens in this build", () => {
  it("keeps every semester, subject and mark", async () => {
    const { state } = await open(V0_1_0);

    expect(state.activeSemester).toBe("S5");
    expect(state.semesters["S5"]!.courses).toHaveLength(2);

    const cn = state.semesters["S5"]!.courses[0]!;
    // Marks, not just presence. A record that loads with the subjects intact
    // and the numbers zeroed is the same loss wearing a better face.
    expect(cn.code).toBe("PCCST501");
    expect(cn.s1).toBe(30);
    expect(cn.s2).toBe(28);
    expect(cn.attended).toBe(44);
    expect(cn.held).toBe(50);
  });

  it("keeps published history, which is the part that cannot be re-fetched", async () => {
    const { state } = await open(V0_1_0);
    expect(Object.keys(state.history).sort()).toEqual(["S3", "S4"]);
    expect(state.history["S3"]!.sgpa).toBe(8.2);
    expect(state.history["S4"]!.creditsRegistered).toBe(22);
  });

  it("keeps the CGPA target the student set", async () => {
    const { state } = await open(V0_1_0);
    // `goal` held only `cgpa` at v0.1.0 and holds a whole target set now.
    // `normaliseTargets` fills the rest without moving the one that was set.
    expect(state.goal?.cgpa).toBe(8.5);
  });

  it("fills in what did not exist yet without inventing data", async () => {
    const { state } = await open(V0_1_0);
    // Genuinely new since v0.1.0, so absent from the file. Each must arrive as
    // "nothing yet" rather than as a value that reads like a fact about this
    // student - the timetable especially, since Tex prices tomorrow off it.
    expect(state.timetable).toBeUndefined();
    expect(state.changes).toBeUndefined();
    expect(state.daywiseAttendance).toBeUndefined();
  });

  it("does not drag a returning student back through onboarding", async () => {
    const { state } = await open(V0_1_0);
    // `onboarded` DID exist at v0.1.0, so somebody upgrading has it set and
    // must land in the app rather than in first-run setup. If it were ever
    // dropped from a save, `needsSetup` would put onboarding in front of a
    // student with two semesters of history already on file.
    expect(state.onboarded).toBe(true);
    const { needsSetup } = await import("../nav");
    expect(needsSetup()).toBe(false);
  });

  it("keeps the preferences a student had already chosen", async () => {
    const { state } = await open(V0_1_0);
    expect(state.theme).toBe("dark");
    expect(state.lastSync).toBe("2026-08-30T09:00:00.000Z");
  });
});

describe("a damaged record does not take the app down with it", () => {
  it("starts clean rather than throwing when the file is not JSON", async () => {
    localStorage.clear();
    localStorage.setItem(KEY, "{ this is not json");
    vi.resetModules();
    const { state } = await import("../store");
    expect(state.semesters).toBeDefined();
  });

  it("keeps the damaged payload so it can be recovered", async () => {
    localStorage.clear();
    localStorage.setItem(KEY, "{ this is not json");
    vi.resetModules();
    await import("../store");
    // The student's response to "TargetX will not open" is to uninstall it,
    // which is why the bad payload is set aside rather than overwritten.
    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe("{ this is not json");
  });

  it("starts clean when the shape is wrong rather than half-loading it", async () => {
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify({ version: 1, scheme: "KTU 2024" }));
    vi.resetModules();
    const { state } = await import("../store");
    // No `semesters` key at all: not a record this build can reason about.
    expect(state.semesters).toBeDefined();
  });
});
