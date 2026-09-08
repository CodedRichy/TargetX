/**
 * A STAND-IN, and deliberately the smallest one that compiles.
 *
 * The Tex work was written on `scheme-profiles`, where this file is a real
 * module: a student picks the regulation their college uses, and every rule
 * the engine applies is read off that profile rather than off a constant. Two
 * of its exports are load-bearing for the code cherry-picked onto this branch
 * - `activeProfile().attendanceMin`, which replaced a hardcoded 75 in three
 * places, and `fullMarksPct()`, which is how Tex knows a subject is losing CIE
 * marks while still being eligible.
 *
 * Neither the picker nor the profiles themselves are here, and neither should
 * be: the Android port has no business shipping half of somebody else's
 * feature, and the two branches are meant to meet in one merge rather than in
 * a race to write the same file twice.
 *
 * So this answers those two questions from the constants this branch actually
 * has, and it exists AT THE SAME PATH, under the SAME NAMES, as the real
 * module. That is the whole point of it. Every call site on this branch is
 * byte-identical to the one on `scheme-profiles`, so when the two merge, the
 * conflict is this file and nothing else - resolved by deleting it and taking
 * theirs. Importing `engine/constants` directly at each call site would have
 * compiled just as well and left four files disagreeing with the branch they
 * have to merge with.
 *
 * DELETE ON MERGE. Nothing here is a design; it is a compilation shim with a
 * known expiry.
 */
import { ATTENDANCE_MARK_BANDS, ATTENDANCE_MIN } from "../engine/constants";

/** Only the fields the cherry-picked code reads. Not the real `Scheme`. */
interface ProfileStandIn {
  /** The eligibility line - KTU R 6.2, 75%. */
  attendanceMin: number;
  /**
   * True, always, and not a placeholder value: this branch has exactly one
   * regulation compiled into it, so the citation the copy prints beside the
   * figure is always the right citation. On `scheme-profiles` it is false for
   * a scheme a student wrote themselves, where quoting R 6.2 would be a lie.
   */
  builtIn: boolean;
}

export const activeProfile = (): ProfileStandIn => ({
  attendanceMin: ATTENDANCE_MIN,
  builtIn: true,
});

/**
 * The attendance above which no CIE marks are being forfeited.
 *
 * Read off the top band rather than written as 85, for the reason
 * `constants.ts` gives about per-type values: the day a course type scores
 * attendance differently, a literal here would quietly start lying about which
 * subjects are bleeding marks, and Tex's face is the thing that would say so.
 */
export const fullMarksPct = (): number => ATTENDANCE_MARK_BANDS[0]![0];
