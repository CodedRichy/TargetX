import { createMemo } from "solid-js";
import {
  ATTENDANCE_FULL_MARKS_PCT, DEFAULT_ATTENDANCE_TARGET, PASSING_GPA_MIN,
} from "../engine";
import {
  KTU_2024, courseTypesOf, gradeMinOf, gradePointsOf, setActiveScheme,
} from "../engine/scheme";
import type { Scheme } from "../engine/scheme";
import type { CourseSpec, Grade, Letter, TypeKey } from "../engine/types";
import { edit, resolveScheme, state } from "./store";

/**
 * Profile management: picking, copying, editing and dropping scheme profiles.
 *
 * `AppState.scheme` (an ID) and `AppState.customSchemes` are the one source
 * of truth - see `engine/course.ts` - so every read here is a memo over
 * `state` rather than a duplicate signal, and every write goes through
 * `edit()` so it rides the same debounced save as everything else a student
 * types. What is NOT derivable from `state` is which profile the engine is
 * computing against: that lives in `engine/scheme.ts`'s own module-level
 * holder, on purpose (see the comment on `activeScheme` there), and every
 * function below that changes the active profile calls `setActiveScheme`
 * in the same breath it edits `state`. Skipping either half is the bug this
 * file exists to make impossible: a UI that re-renders against the old
 * numbers, or an engine that silently keeps computing against them.
 */

/** The student's own profiles, each a duplicate of some profile at the time
 * it was made. Empty, not absent, when there are none. */
export const customProfiles = createMemo<Scheme[]>(() => state.customSchemes ?? []);

/** Every profile a student can pick from: the built-ins, then their own. */
export const allProfiles = createMemo<Scheme[]>(() => [KTU_2024, ...customProfiles()]);

/**
 * The profile `state.scheme` currently names, resolved against this state's
 * own `customSchemes` - the same resolution `store.ts` runs at load, so a
 * screen reading this and the engine computing off `activeScheme()` are
 * always looking at the same profile.
 */
export const activeProfile = createMemo<Scheme>(() =>
  resolveScheme(state.scheme, state.customSchemes));

function freshId(): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-${rnd}`;
}

/**
 * Switch the active profile.
 *
 * Resolves `id` before writing anything, so `state.scheme` can never end up
 * holding an ID this build cannot resolve: an unknown ID (a stale bookmark,
 * a corrupt call site) lands on `KTU_2024` instead, in the store and in the
 * engine together.
 */
export function selectProfile(id: string): void {
  const target = resolveScheme(id, state.customSchemes);
  edit((s) => { s.scheme = target.id; });
  setActiveScheme(target);
}

/**
 * Duplicate a profile under a new name and select the copy.
 *
 * The only way to get an editable profile onto disk. Built-in profiles ship
 * checked against a published regulation (see `KTU_2024` in
 * `engine/scheme.ts`) and are not editable in place - a student who wants a
 * different attendance rule or pass mark gets their OWN copy to change,
 * never a silent edit of the numbers that were verified.
 */
export function createProfile(baseId: string, name: string): Scheme {
  const base = resolveScheme(baseId, state.customSchemes);
  const id = freshId();
  edit((s) => {
    s.customSchemes = [...(s.customSchemes ?? []), { ...base, id, name, builtIn: false }];
    s.scheme = id;
  });
  // Read back through the store rather than handing the engine the plain
  // object built above: Solid wraps everything `edit` writes in a reactive
  // proxy, and `engine/scheme.ts` caches derived data by the `Scheme`
  // object's own identity (`derivedCache`, a WeakMap). Activating the
  // pre-store object here and the store's copy on the next `selectProfile`
  // would be two different keys for what is supposed to be one profile.
  const stored = resolveScheme(id, state.customSchemes);
  setActiveScheme(stored);
  return stored;
}

/**
 * Change a custom profile's numbers in place.
 *
 * Refuses anything that is not already a custom profile - a built-in `id`,
 * or one that names nothing at all - rather than quietly turning the call
 * into a `createProfile`. A caller asking to edit a specific profile and
 * silently getting a different one back (a new copy, a different ID) is a
 * worse failure than nothing happening; the UI is expected to route an edit
 * of a built-in through `createProfile` itself, deliberately.
 */
export function updateProfile(id: string, patch: Partial<Omit<Scheme, "id" | "builtIn">>): void {
  const current = state.customSchemes?.find((s) => s.id === id);
  if (!current) return;
  edit((s) => {
    s.customSchemes = (s.customSchemes ?? [])
      .map((sch) => (sch.id === id ? { ...sch, ...patch, id, builtIn: false } : sch));
  });
  // Only the active profile drives the engine; an edit to some other custom
  // profile is stored but changes nothing this session is computing against.
  // Read back through the store for the same identity reason `createProfile`
  // does.
  if (state.scheme === id) {
    const stored = state.customSchemes?.find((sch) => sch.id === id);
    if (stored) setActiveScheme(stored);
  }
}

/**
 * Remove a custom profile.
 *
 * A built-in `id` is a no-op: `customSchemes` never holds one, so the
 * filter removes nothing. Deleting the ACTIVE profile falls back to
 * `KTU_2024` in the same edit that removes it - never a state naming a
 * profile that no longer exists, not even for the instant before something
 * else notices.
 */
export function deleteProfile(id: string): void {
  const wasActive = state.scheme === id;
  edit((s) => {
    s.customSchemes = (s.customSchemes ?? []).filter((sch) => sch.id !== id);
    if (wasActive) s.scheme = KTU_2024.id;
  });
  if (wasActive) setActiveScheme(KTU_2024);
}

/**
 * The active profile's derived values, for screens.
 *
 * A component MUST reach the scheme through these and never through the
 * engine's own `activeScheme()` / `courseTypes()` / `gradeMin()`. Those read
 * a plain module variable - correct, but invisible to Solid, so a screen
 * built on them shows the right numbers on first paint and then never
 * changes them again. Switching profile would repaint nothing and look like
 * a broken button.
 *
 * Each of these reads `activeProfile()` instead, which is a memo over
 * `state.scheme`, so every screen that calls one re-runs when the student
 * picks a different profile. The values are identical either way; only the
 * reactivity differs, which is exactly why the wrong one is so easy to reach
 * for and so hard to notice.
 */
export const schemeCourseTypes = (): Record<TypeKey, CourseSpec> =>
  courseTypesOf(activeProfile());

export const schemeGradePoints = (): Record<Grade, number> =>
  gradePointsOf(activeProfile());

export const schemeGradeMin = (): Record<Letter, number> =>
  gradeMinOf(activeProfile());

/** Lowest attendance earning every attendance mark, under the active profile. */
export const fullMarksPct = (): number => ATTENDANCE_FULL_MARKS_PCT(activeProfile());

/** The attendance target a student starts with, under the active profile. */
export const defaultAttendanceTarget = (): number =>
  DEFAULT_ATTENDANCE_TARGET(activeProfile());

/** The lowest grade point a pass can carry, under the active profile. */
export const passingGpaMin = (): number => PASSING_GPA_MIN(activeProfile());
