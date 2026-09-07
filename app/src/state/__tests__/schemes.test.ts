// @vitest-environment jsdom
/**
 * Scheme profiles, persisted and wired to the engine.
 *
 * `engine/scheme.ts` already lets the arithmetic run against any `Scheme`;
 * nothing before this file ever called `setActiveScheme`, and no profile
 * choice survived a reload. Two things are pinned here: that picking,
 * copying, editing and dropping a profile always keeps `state.scheme` /
 * `state.customSchemes` and the engine's active scheme in agreement, and
 * that a save from any point in this app's history - no `scheme` field, the
 * old literal display name, or a proper ID - opens to `KTU_2024` with no
 * error and no lost data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeScheme, KTU_2024, resetActiveScheme } from "../../engine/scheme";
import {
  activeProfile, createProfile, customProfiles, deleteProfile, selectProfile, updateProfile,
} from "../schemes";
import { edit, state } from "../store";

function reset() {
  edit((s) => {
    s.scheme = KTU_2024.id;
    s.customSchemes = [];
  });
}

beforeEach(reset);
afterEach(resetActiveScheme);

describe("selecting a profile", () => {
  it("updates state and the engine together", () => {
    const mine = createProfile(KTU_2024.id, "My College");
    selectProfile(KTU_2024.id);
    expect(state.scheme).toBe(KTU_2024.id);
    expect(activeScheme()).toBe(KTU_2024);

    selectProfile(mine.id);
    expect(state.scheme).toBe(mine.id);
    expect(activeScheme()).toBe(activeProfile());
    expect(activeProfile().id).toBe(mine.id);
  });

  it("falls back to KTU_2024 for an ID nothing recognises", () => {
    selectProfile("no-such-profile");
    expect(state.scheme).toBe(KTU_2024.id);
    expect(activeScheme()).toBe(KTU_2024);
  });
});

describe("creating a profile", () => {
  it("duplicates the base under a new id, marks it non-built-in, and selects it", () => {
    const mine = createProfile(KTU_2024.id, "My College");
    expect(mine.id).not.toBe(KTU_2024.id);
    expect(mine.builtIn).toBe(false);
    expect(mine.name).toBe("My College");
    // Copied numbers, not references to the built-in's own arrays.
    expect(mine.gradeBands).toEqual(KTU_2024.gradeBands);
    expect(mine.totalPassMark).toBe(KTU_2024.totalPassMark);

    expect(customProfiles().map((s) => s.id)).toContain(mine.id);
    expect(state.scheme).toBe(mine.id);
    expect(activeScheme()).toBe(mine);
  });

  it("can duplicate a custom profile, not only a built-in", () => {
    const first = createProfile(KTU_2024.id, "First");
    const second = createProfile(first.id, "Second");
    expect(second.totalPassMark).toBe(first.totalPassMark);
    expect(second.id).not.toBe(first.id);
  });
});

describe("editing a profile", () => {
  it("changes a custom profile's numbers, and follows the engine if it is active", () => {
    const mine = createProfile(KTU_2024.id, "My College");
    updateProfile(mine.id, { totalPassMark: 45 });

    const stored = customProfiles().find((s) => s.id === mine.id);
    expect(stored?.totalPassMark).toBe(45);
    expect(activeScheme().totalPassMark).toBe(45);
  });

  it("does not touch the engine when the edited profile is not active", () => {
    const mine = createProfile(KTU_2024.id, "My College");
    selectProfile(KTU_2024.id);
    updateProfile(mine.id, { totalPassMark: 45 });

    expect(customProfiles().find((s) => s.id === mine.id)?.totalPassMark).toBe(45);
    expect(activeScheme()).toBe(KTU_2024);
  });

  it("refuses to edit a built-in profile in place", () => {
    updateProfile(KTU_2024.id, { totalPassMark: 1 });
    expect(KTU_2024.totalPassMark).toBe(50);
    expect(activeScheme().totalPassMark).toBe(50);
  });

  it("refuses to edit an id that names nothing", () => {
    updateProfile("no-such-profile", { totalPassMark: 1 });
    expect(customProfiles()).toEqual([]);
  });
});

describe("deleting a profile", () => {
  it("falls back to KTU_2024, in state and in the engine, when the active profile is deleted", () => {
    const mine = createProfile(KTU_2024.id, "My College");
    expect(state.scheme).toBe(mine.id);

    deleteProfile(mine.id);
    expect(state.scheme).toBe(KTU_2024.id);
    expect(activeScheme()).toBe(KTU_2024);
    expect(customProfiles()).toEqual([]);
  });

  it("leaves the active profile alone when a different one is deleted", () => {
    const first = createProfile(KTU_2024.id, "First");
    const second = createProfile(KTU_2024.id, "Second");
    selectProfile(first.id);

    deleteProfile(second.id);
    expect(state.scheme).toBe(first.id);
    expect(activeScheme()).toBe(first);
    expect(customProfiles().map((s) => s.id)).toEqual([first.id]);
  });

  it("is a no-op against a built-in id", () => {
    deleteProfile(KTU_2024.id);
    expect(activeScheme()).toBe(KTU_2024);
  });
});

/**
 * Migration: every shape a save's `scheme` field has ever had must open to
 * `KTU_2024`, and a save this build writes must read back unchanged.
 *
 * A fresh module graph per case, the way `upgrade.test.ts` does it, because
 * `store.ts` resolves the active scheme once at import time (`load()`) and
 * that is exactly the behaviour under test here.
 */
describe("a saved scheme value always resolves to a real profile", () => {
  const KEY = "targetx.state.v1";

  async function open(payload: unknown) {
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify(payload));
    vi.resetModules();
    return { store: await import("../store"), scheme: await import("../../engine/scheme") };
  }

  const MINIMAL = {
    version: 1,
    student: { name: "", reg_no: "", branch: "", college: "" },
    activeSemester: "S1",
    etlab: {},
    semesters: { S1: { courses: [] } },
    history: {},
  };

  beforeEach(() => { localStorage.clear(); });

  it("opens a save with no scheme field at all", async () => {
    const { store, scheme } = await open(MINIMAL);
    expect(store.state.scheme).toBe(scheme.KTU_2024.id);
    expect(scheme.activeScheme()).toBe(scheme.KTU_2024);
  });

  it("opens a save holding the old literal display name", async () => {
    const { store, scheme } = await open({ ...MINIMAL, scheme: "KTU 2024" });
    expect(store.state.scheme).toBe(scheme.KTU_2024.id);
    expect(scheme.activeScheme()).toBe(scheme.KTU_2024);
  });

  it("opens a save already holding the built-in's id, unchanged", async () => {
    const { store, scheme } = await open({ ...MINIMAL, scheme: "ktu-2024" });
    expect(store.state.scheme).toBe("ktu-2024");
    expect(scheme.activeScheme()).toBe(scheme.KTU_2024);
  });

  it("falls back to KTU_2024 for a custom id this save carries no profile for", async () => {
    const { store, scheme } = await open({ ...MINIMAL, scheme: "custom-ghost" });
    expect(store.state.scheme).toBe(scheme.KTU_2024.id);
    expect(scheme.activeScheme()).toBe(scheme.KTU_2024);
  });

  it("resolves a custom profile this save does carry, and activates it", async () => {
    const mine = {
      id: "custom-abc", name: "My College", source: "test", builtIn: false,
      gradeBands: [{ letter: "P", minPct: 40, points: 4 }],
      totalPassMark: 40, esePassFraction: 0.4,
      attendanceMin: 75, attendanceCondone: 60, dlCapPct: 10,
      attendanceMarkBands: [{ minPct: 75, marks: 3 }], attendanceMarkMax: 3,
      courseTypes: {}, defaultType: "TH 40/60", targetChoices: ["P"],
    };
    const { store, scheme } = await open({
      ...MINIMAL, scheme: "custom-abc", customSchemes: [mine],
    });
    expect(store.state.scheme).toBe("custom-abc");
    expect(scheme.activeScheme().id).toBe("custom-abc");
    expect(scheme.activeScheme().totalPassMark).toBe(40);
  });
});
