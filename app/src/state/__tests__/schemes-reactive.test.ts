// @vitest-environment jsdom
/**
 * Switching profile has to REPAINT, not just recompute.
 *
 * The engine holds its active scheme in a plain module variable, on purpose,
 * so that it stays free of Solid. That decision has a trap attached: a screen
 * reading `activeScheme()` or `courseTypes()` directly gets correct numbers on
 * first paint and then never hears about a profile change. Every test in
 * `schemes.test.ts` would still pass, the engine would compute perfectly, and
 * the student would watch a settings screen do nothing.
 *
 * So the wrappers in `state/schemes.ts` exist to be the reactive route, and
 * this file is the proof that they are one. Each case tracks a wrapper inside
 * a real reactive computation and asserts the computation re-runs - not merely
 * that the value would be right if something asked again.
 */
import { createComputed, createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeScheme, KTU_2024, resetActiveScheme } from "../../engine/scheme";
import {
  createProfile, fullMarksPct, schemeCourseTypes, selectProfile, updateProfile,
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

/**
 * Run `read` inside a tracked computation and collect every value it produces.
 *
 * `createComputed` rather than `createEffect` on purpose: effects are deferred
 * to a microtask, so a synchronous test disposes the root before they ever
 * fire and every assertion passes against an empty list - which is how this
 * file failed the first time it ran. What is being pinned is dependency
 * TRACKING: if the wrapper registers the store read, a change re-runs the
 * computation, and a renderer built on the same signal repaints for the same
 * reason.
 */
function track<T>(read: () => T, act: () => void): T[] {
  const seen: T[] = [];
  return createRoot((dispose) => {
    createComputed(() => { seen.push(read()); });
    act();
    dispose();
    return seen;
  });
}

describe("a screen re-runs when the profile changes", () => {
  it("re-reads the attendance threshold after a switch", () => {
    const mine = createProfile(KTU_2024.id, "Ninety College");
    updateProfile(mine.id, {
      attendanceMarkBands: [{ minPct: 90, marks: 5 }, { minPct: 70, marks: 2 }],
    });
    selectProfile(KTU_2024.id);

    const seen = track(() => fullMarksPct(), () => { selectProfile(mine.id); });

    // KTU pays full marks from 85; this profile from 90. Both must appear,
    // in that order - one value would mean the effect never re-ran.
    expect(seen[0]).toBe(85);
    expect(seen.at(-1)).toBe(90);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("re-reads course types after a switch", () => {
    const mine = createProfile(KTU_2024.id, "No Attendance Marks");
    updateProfile(mine.id, { attendanceMarkMax: 0 });
    selectProfile(KTU_2024.id);

    const seen = track(
      () => schemeCourseTypes()["TH 40/60"]!.attMax,
      () => { selectProfile(mine.id); },
    );

    expect(seen[0]).toBe(5);
    expect(seen.at(-1)).toBe(0);
  });

  it("re-runs when the ACTIVE profile is edited, not only when it is swapped", () => {
    // The subtler half. Picking a different profile changes `state.scheme`;
    // editing the one already active does not, so reactivity has to come from
    // `customSchemes` as well or an edit would save and show nothing.
    const mine = createProfile(KTU_2024.id, "Editable");

    const seen = track(() => fullMarksPct(), () => {
      updateProfile(mine.id, {
        attendanceMarkBands: [{ minPct: 95, marks: 5 }, { minPct: 60, marks: 1 }],
      });
    });

    expect(seen[0]).toBe(85);
    expect(seen.at(-1)).toBe(95);
  });

  it("keeps the engine and the reactive view agreeing throughout", () => {
    const mine = createProfile(KTU_2024.id, "Agreement");
    updateProfile(mine.id, { attendanceMin: 80 });
    selectProfile(mine.id);

    // Deliberately the ENGINE's own route, which is what the arithmetic uses.
    // The reactive view and the pure engine must name the same profile, or a
    // screen shows one college's rules while the grades use another's.
    expect(activeScheme().attendanceMin).toBe(80);
    expect(state.scheme).toBe(mine.id);
  });
});
