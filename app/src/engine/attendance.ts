import {
  ATTENDANCE_MARK_BANDS, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN, DL_CAP_PCT,
} from "./constants";
import type { AttendanceBand, AttendancePlan, MarkInput } from "./types";
import { ceil, floor, round, toFloat, toOptionalFloat } from "./util";

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

/** Duty leave credited toward attendance, capped at `dlCapPct` of classes held. */
function creditDutyLeave(held: number, dutyLeave: MarkInput, dlCapPct: number) {
  const claimed = Math.max(0, toFloat(dutyLeave, 0));
  const allowed = held * (dlCapPct / 100);
  return { claimed, allowed, credited: Math.min(claimed, allowed) };
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

  const { credited } = creditDutyLeave(held, dutyLeave, dlCapPct);
  const effective = Math.min(attended + credited, held);
  const current = (effective / held) * 100;
  const earned = attendanceMarks(current) ?? 0;

  for (let i = ATTENDANCE_MARK_BANDS.length - 1; i >= 0; i -= 1) {
    const band = ATTENDANCE_MARK_BANDS[i]!;
    const [floorPct, marks] = band;
    if (marks <= earned) continue;
    const fraction = floorPct / 100;
    if (fraction >= 1) continue;
    // Consecutive attendance: each class attended raises both numerator and
    // denominator, so the requirement is (f*held - effective)/(1 - f).
    const need = ceil((fraction * held - effective) / (1 - fraction));
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
 *     it.  attended / (held + skip) >= f   ->   skip <= attended/f - held
 *   - Below the line: how many must be attended CONSECUTIVELY to climb back.
 *     (attended + n) / (held + n) >= f     ->   n >= (f*held - attended)/(1-f)
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

  const fraction = floorPct / 100;
  const base = {
    raw: round((attended / held) * 100, 2),
    current: round((effective / held) * 100, 2),
    dlClaimed: claimed,
    dlCredited: round(credited, 2),
    dlWasted: round(Math.max(0, claimed - allowed), 2),
  };

  if (base.current >= floorPct) {
    return { ...base, state: "surplus", skip: Math.max(0, floor(effective / fraction - held)), attend: 0 };
  }
  if (fraction >= 1) {
    return { ...base, state: "deficit", skip: 0, attend: null };
  }
  const need = ceil((fraction * held - effective) / (1 - fraction));
  return { ...base, state: "deficit", skip: 0, attend: Math.max(0, need) };
}
