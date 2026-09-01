import {
  ATTENDANCE_MARK_BANDS, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN, DL_CAP_PCT,
} from "./constants";
import type {
  AbsenceCost, AttendanceBand, AttendancePlan, Course, MarkInput,
} from "./types";
import { ceil, clamp, floor, round, toFloat, toOptionalFloat } from "./util";

/** CIE marks earned by attendance alone, per R 7.5.ii. */
export function attendanceMarks(
  percent: MarkInput, maxMarks: number = ATTENDANCE_MARK_MAX,
): number | null {
  const value = toOptionalFloat(percent);
  if (value === null) return null;
  for (const [floorPct, marks] of ATTENDANCE_MARK_BANDS) {
    if (value >= floorPct) {
      return maxMarks === ATTENDANCE_MARK_MAX
        ? marks
        : round((marks / ATTENDANCE_MARK_MAX) * maxMarks, 2);
    }
  }
  return 0;
}

/**
 * Duty leave credited toward attendance today, capped at `dlCapPct` of held.
 *
 * Today only. Every forward-looking question moves `held`, and the cap moves
 * with it - see `skipBudget` and `consecutiveNeed`, which solve for the cap
 * and the target together rather than spending this figure on a denominator
 * that no longer applies.
 */
function creditDutyLeave(held: number, dutyLeave: MarkInput, dlCapPct: number) {
  const claimed = Math.max(0, toFloat(dutyLeave, 0));
  const allowed = held * (dlCapPct / 100);
  return { claimed, allowed, credited: Math.min(claimed, allowed) };
}

/**
 * Classes that may still be skipped before attendance falls under `fraction`.
 *
 * A skipped class raises `held`, and R 6.3.ii's relaxation is a percentage of
 * held, so the duty leave a student may spend grows as they spend it. After
 * `s` skips, with cap `c` and `k` classes of DL claimed, the figure the
 * college would compute is
 *
 *     min(attended + k, attended + c*(held+s), held+s) / (held+s)
 *
 * The numerator is a minimum of three terms, so all three have to clear
 * `fraction`, and the budget is the tightest bound they give:
 *
 *   claim fits under the cap:  (attended+k)/(held+s) >= f
 *                                ->  s <= (attended+k)/f - held
 *   cap binds:                 (attended + c*(held+s))/(held+s) >= f
 *                                ->  s <= attended/(f-c) - held
 *   never above 100%:          1 >= f, which any f <= 1 clears for free.
 *
 * Crediting DL up front freezes two of those terms at s = 0 - the relaxation
 * at 10% of today's held, and the 100% ceiling at today's held - and only
 * then divides, which understates the room. Either frozen term can be the one
 * that moves. With a claim above the cap it is `atCap`. With a claim that
 * fits under the cap but already carries the student past 100% today it is
 * `underCap`, because the frozen ceiling discards claim that a larger `held`
 * has room for: 95/100 with 10 claimed is exactly at the cap, so the cap
 * never binds, and the answer is still 40 skips rather than 33.
 */
function skipBudget(
  attended: number, held: number, claimed: number, cap: number, fraction: number,
): number {
  const underCap = (attended + claimed) / fraction - held;
  // f <= c means the relaxation alone clears the floor: that bound never binds.
  const atCap = fraction > cap ? attended / (fraction - cap) - held : Infinity;
  return Math.max(0, floor(Math.min(underCap, atCap)));
}

/**
 * Consecutive classes needed to reach `fraction`, with the cap growing too.
 *
 * The same solve from below the line. Attending `n` raises numerator and
 * denominator together and lifts the cap along with them:
 *
 *     min(attended + n + k, attended + n + c*(held+n), held+n) / (held+n)
 *
 * Each term must clear `fraction`, so the requirement is the loosest bound:
 *
 *   claim fits under the cap:  n >= (f*held - attended - k)/(1 - f)
 *   cap binds:                 n >= ((f-c)*held - attended)/(1 - f + c)
 *
 * Callers guarantee f < 1, which keeps both denominators positive. Charging
 * the whole climb against a cap frozen at today's held overstates it: the
 * traced case (60/100, 100 claimed) asks for 20 classes where 15 suffice.
 */
function consecutiveNeed(
  attended: number, held: number, claimed: number, cap: number, fraction: number,
): number {
  const underCap = (fraction * held - attended - claimed) / (1 - fraction);
  const atCap = ((fraction - cap) * held - attended) / (1 - fraction + cap);
  return Math.max(0, ceil(Math.max(underCap, atCap)));
}

/**
 * What the next attendance mark costs, in classes.
 *
 * Turns "you are at 76%" into "three classes in a row earns one more CIE
 * mark" - the only form of that fact a student can act on.
 */
export function nextAttendanceBand(
  attendedIn: MarkInput, heldIn: MarkInput,
  dutyLeave: MarkInput = 0, dlCapPct: number = DL_CAP_PCT,
): AttendanceBand | null {
  const attended = toOptionalFloat(attendedIn);
  const held = toOptionalFloat(heldIn);
  if (attended === null || held === null || held <= 0) return null;

  const { claimed, credited } = creditDutyLeave(held, dutyLeave, dlCapPct);
  const effective = Math.min(attended + credited, held);
  const current = (effective / held) * 100;
  const earned = attendanceMarks(current) ?? 0;
  const cap = dlCapPct / 100;

  for (let i = ATTENDANCE_MARK_BANDS.length - 1; i >= 0; i -= 1) {
    const band = ATTENDANCE_MARK_BANDS[i]!;
    const [floorPct, marks] = band;
    if (marks <= earned) continue;
    const fraction = floorPct / 100;
    if (fraction >= 1) continue;
    const need = consecutiveNeed(attended, held, claimed, cap, fraction);
    if (need > 0) {
      return { earned, nextMarks: marks, attend: need, atPct: floorPct };
    }
  }
  return { earned, nextMarks: null, attend: 0, atPct: null };
}

/**
 * Turn "you are at 83%" into the number the student actually wants.
 *
 * Portals universally show attended/held and stop there, leaving everyone to
 * do this arithmetic in their head - badly, because the two directions are
 * not symmetric:
 *
 *   - Above the line: how many classes can be skipped and still stay above
 *     it, which grows `held` alone.        -> `skipBudget`
 *   - Below the line: how many must be attended CONSECUTIVELY to climb back,
 *     which grows both counts.             -> `consecutiveNeed`
 *
 * Both move `held`, and duty leave is capped at a percentage of it, so both
 * solve for the cap and the target at once rather than reusing the credit
 * computed for today.
 *
 * Returns null when the portal gave no raw counts - a percentage alone cannot
 * answer either question.
 */
export function attendancePlan(
  attendedIn: MarkInput, heldIn: MarkInput, dutyLeave: MarkInput = 0,
  floorPct: number = ATTENDANCE_MIN, dlCapPct: number = DL_CAP_PCT,
): AttendancePlan | null {
  const attended = toOptionalFloat(attendedIn);
  const held = toOptionalFloat(heldIn);
  if (attended === null || held === null || held <= 0) return null;

  // Approved duty leave (NSS, sports, fests, placement drives) counts as
  // present, but only up to a cap. Students routinely panic over a raw
  // percentage their DL already covers - and just as often assume DL is
  // unlimited, which it is not. Both errors are worth killing.
  const { claimed, allowed, credited } = creditDutyLeave(held, dutyLeave, dlCapPct);
  const effective = Math.min(attended + credited, held);

  const cap = dlCapPct / 100;
  const fraction = floorPct / 100;
  const base = {
    raw: round((attended / held) * 100, 2),
    current: round((effective / held) * 100, 2),
    dlClaimed: claimed,
    dlCredited: round(credited, 2),
    dlWasted: round(Math.max(0, claimed - allowed), 2),
  };

  if (base.current >= floorPct) {
    return {
      ...base, state: "surplus", attend: 0,
      skip: skipBudget(attended, held, claimed, cap, fraction),
    };
  }
  if (fraction >= 1) {
    return { ...base, state: "deficit", skip: 0, attend: null };
  }
  return {
    ...base, state: "deficit", skip: 0,
    attend: consecutiveNeed(attended, held, claimed, cap, fraction),
  };
}

/**
 * The one attendance percentage the rest of the engine may use.
 *
 * Eligibility and CIE marks both hang off this number, so it is derived here
 * once rather than in each place that needs it - two derivations that drift
 * apart would have the ledger flag a shortage the marks do not reflect.
 *
 * Duty leave changes the figure, so raw counts plus approved DL beat a
 * percentage the portal printed before the DL was credited. Null when the
 * college has published neither: a blank field is not a full record.
 */
export function effectiveAttendance(
  course: Course,
  plan: AttendancePlan | null = attendancePlan(course.attended, course.held, course.dl ?? 0),
): number | null {
  if (plan !== null) return plan.current;
  const stated = toOptionalFloat(course.attendance);
  return stated === null ? null : clamp(stated, 0, 100);
}

/**
 * What the next absence actually costs.
 *
 * The question this app exists to answer, and the one every other system
 * refuses: not "am I above 75%" but "if I skip tomorrow, what does it take from
 * me". A student at 86% is told by every portal that they are fine. Missing two
 * classes puts them at 84% and costs a CIE mark under R 7.5.ii, and nothing
 * anywhere tells them that until the mark is gone.
 *
 * Composition, not new arithmetic: the percentage after `n` more absences is
 * the same effective figure the rest of the engine uses, recomputed with the
 * classes added to `held` and none of them attended, and the marks on each side
 * come from `attendanceMarks`. There is deliberately no second opinion here
 * about what a percentage is worth.
 *
 * Duty leave is NOT re-credited against the larger denominator. `creditDutyLeave`
 * caps DL at a fraction of held, so a bigger `held` could mathematically allow
 * more DL to count - but the student is not acquiring new duty leave by missing
 * a class, and letting the cap rise here would report a skip as cheaper than it
 * is. The credited figure is held at today's value.
 *
 * Returns null when the portal gave no raw counts. A percentage alone cannot
 * answer this: without `held` there is no denominator to move.
 */
export function absenceCost(
  attendedIn: MarkInput, heldIn: MarkInput, dutyLeave: MarkInput = 0,
  skips: number = 1,
  maxMarks: number = ATTENDANCE_MARK_MAX,
  floorPct: number = ATTENDANCE_MIN,
  dlCapPct: number = DL_CAP_PCT,
): AbsenceCost | null {
  const attended = toOptionalFloat(attendedIn);
  const held = toOptionalFloat(heldIn);
  if (attended === null || held === null || held <= 0) return null;
  const n = Math.max(0, Math.floor(skips));

  const { credited } = creditDutyLeave(held, dutyLeave, dlCapPct);
  const pctAt = (extra: number) => {
    const denominator = held + extra;
    if (denominator <= 0) return 0;
    return round((Math.min(attended + credited, denominator) / denominator) * 100, 2);
  };

  const before = pctAt(0);
  const after = pctAt(n);
  const marksBefore = attendanceMarks(before, maxMarks) ?? 0;
  const marksAfter = attendanceMarks(after, maxMarks) ?? 0;

  return {
    skips: n,
    before, after,
    marksBefore, marksAfter,
    marksLost: round(Math.max(0, marksBefore - marksAfter), 2),
    eligibleBefore: before >= floorPct,
    eligibleAfter: after >= floorPct,
  };
}

/**
 * The largest number of absences that costs nothing.
 *
 * Distinct from `AttendancePlan.skip`, which solves for eligibility alone and
 * so answers "before I am barred from the exam". This solves for the marks: the
 * last skip that leaves the CIE attendance mark untouched. For most students
 * the two are far apart, and the smaller one is the one that binds first.
 *
 * Bounded rather than closed-form because the band table is a list of steps,
 * not a formula, and a loop over it cannot disagree with `attendanceMarks` the
 * way a re-derivation could. `held` is the bound: skipping every remaining
 * class is the most anyone can do.
 */
export function freeSkips(
  attendedIn: MarkInput, heldIn: MarkInput, dutyLeave: MarkInput = 0,
  maxMarks: number = ATTENDANCE_MARK_MAX,
  dlCapPct: number = DL_CAP_PCT,
): number | null {
  const first = absenceCost(attendedIn, heldIn, dutyLeave, 0, maxMarks, ATTENDANCE_MIN, dlCapPct);
  if (first === null) return null;
  const held = toFloat(heldIn);
  let n = 0;
  while (n < held) {
    const next = absenceCost(attendedIn, heldIn, dutyLeave, n + 1, maxMarks,
                             ATTENDANCE_MIN, dlCapPct);
    if (next === null || next.marksAfter < first.marksBefore) break;
    n += 1;
  }
  return n;
}
