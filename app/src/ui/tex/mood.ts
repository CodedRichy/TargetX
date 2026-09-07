import { rows, summary } from "../../state/store";
import { fullMarksPct } from "../../state/schemes";
import type { Mood } from "./definition";

/**
 * Which face Tex wears, read off the verdicts the engine already computed.
 *
 * Never his own judgement, and deliberately in one place rather than per
 * screen. Tex appears on Home and inside the assistant, and two screens each
 * deriving a mood is two chances to disagree - a worried face in the palette
 * above a Home that says everything is fine is worse than no face at all,
 * because the student cannot tell which one to believe.
 *
 * The order is severity. `concerned` is the interesting one: those subjects
 * are ELIGIBLE and still losing CIE marks every week, which is the thing no
 * portal says out loud. A face that only reacted to the eligibility line
 * would be exactly as silent about it as the portal the student already has.
 */
export function overallMood(): Mood {
  const s = summary();
  if (s.credits === 0) return "neutral";
  if (s.lowAttendance.length > 0 || s.impossible.length > 0) return "alarmed";
  const bleeding = rows().filter(
    (r) => r.ev.attendance !== null && r.ev.attendance < fullMarksPct(),
  ).length;
  return bleeding > 0 ? "concerned" : "pleased";
}

/** What a screen reader should hear instead of a shape. */
export function moodLabel(mood: Mood): string {
  switch (mood) {
    case "alarmed": return "Tex, concerned about your attendance";
    case "concerned": return "Tex, watching your attendance";
    case "pleased": return "Tex, happy with where you stand";
    case "attentive": return "Tex, reading what you are typing";
    case "thinking": case "thinking-away": return "Tex is thinking";
    default: return "Tex";
  }
}
