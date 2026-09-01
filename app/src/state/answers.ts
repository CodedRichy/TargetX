import { absenceCost, courseLabel, freeSkips } from "../engine";
import type { Course } from "../engine";
import { rows, state } from "./store";
import type { View } from "./nav";

/**
 * Answers, computed here, said in the box.
 *
 * The search box used to route: a question got you a screen, and the screen had
 * the number on it somewhere. For "where are my marks" that is the right answer.
 * For "if I skip tomorrow, how badly does it hurt" it is not an answer at all -
 * it is a filing cabinet, and the student still has to do the arithmetic the app
 * exists to do for them.
 *
 * THE MODEL STILL NEVER STATES A FIGURE. It names which question this is and
 * which subject it is about - a topic and a code, both from fixed enums - and
 * every number in the sentence below is computed by the engine on this machine
 * from this student's own records. That is the same guarantee as before; what
 * changed is that the answer is now shown where it was asked instead of two
 * clicks away.
 *
 * A topic is only added here when the engine can already answer it exactly.
 * There is deliberately no "general" topic and no free-text field: a question
 * shape that has no solver behind it must fall through to a route, because the
 * alternative is a sentence nobody can show the working for.
 */

/** The question shapes the engine can answer outright. */
export const TOPICS = [
  "skip_cost", "budget", "eligibility", "tomorrow",
] as const;
export type Topic = (typeof TOPICS)[number];

export interface Answer {
  /** The sentence. Every figure in it came from the engine. */
  headline: string;
  /** Supporting lines, one per subject where the question spans several. */
  lines: string[];
  /** Where to go for the full working. The answer is not a substitute for it. */
  view: View;
}

const pct = (value: number) => `${value.toFixed(0)}%`;
/** "1 mark", "2 marks" - and "half a mark" never appears, marks are integral. */
const marks = (value: number) => `${value} ${value === 1 ? "mark" : "marks"}`;

/**
 * What one more absence costs a single course, in a sentence.
 *
 * Both sides of the change, never a bare delta: "86% and 4 marks becomes 84%
 * and 3" is a figure a student can check against their own portal. "You lose a
 * mark" is one they have to take on trust.
 */
function skipLine(course: Course): string | null {
  const label = courseLabel(course);
  const cost = absenceCost(course.attended, course.held, course.dl ?? 0, 1);
  if (cost === null) return `${label} — attendance not recorded`;

  if (!cost.eligibleBefore) {
    return `${label} — already below the line at ${pct(cost.before)}`;
  }
  if (!cost.eligibleAfter) {
    // The one case where a single class is not a matter of marks at all.
    return `${label} — one more takes you to ${pct(cost.after)} and you lose exam eligibility`;
  }
  if (cost.marksLost > 0) {
    return `${label} — ${pct(cost.before)} becomes ${pct(cost.after)}, costs ${marks(cost.marksLost)}`;
  }
  const free = freeSkips(course.attended, course.held, course.dl ?? 0);
  return free === null || free <= 1
    ? `${label} — free, but the next one is not`
    : `${label} — free (${free} to spare before it costs a mark)`;
}

/** The classes a student can still miss for nothing, per course. */
function budgetLine(course: Course): string {
  const label = courseLabel(course);
  const free = freeSkips(course.attended, course.held, course.dl ?? 0);
  const cost = absenceCost(course.attended, course.held, course.dl ?? 0, 1);
  if (cost === null || free === null) return `${label} — attendance not recorded`;
  if (!cost.eligibleBefore) return `${label} — below 75%, nothing to spare`;
  return free === 0
    ? `${label} — none free, the next one costs ${marks(Math.max(1, cost.marksLost))}`
    : `${label} — ${free} free before it costs a mark`;
}

/**
 * Tomorrow's classes, priced individually.
 *
 * The timetable and the attendance budget have always both been in the app,
 * two hundred pixels apart, and nothing multiplied them. This is that join: the
 * subjects that actually run tomorrow, each with what missing it would take.
 *
 * The subject strings come from the portal as printed, so they are matched back
 * to the student's own courses by code first and by name second. A period that
 * matches nothing is dropped rather than guessed at - naming a subject the
 * student does not have would be worse than a shorter list.
 */
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function tomorrowCourses(now: Date = new Date()): Course[] {
  const grid = state.timetable?.grid ?? [];
  if (grid.length === 0) return [];
  const wanted = DAYS[(now.getDay() + 1) % 7]!;
  const day = grid.find((d) => d.day.trim().toLowerCase().startsWith(wanted.slice(0, 3)));
  if (!day) return [];

  const out: Course[] = [];
  const seen = new Set<string>();
  for (const period of day.periods) {
    const printed = period.subject?.trim().toLowerCase();
    if (!printed) continue;
    const hit = rows().find((r) => {
      const code = (r.course.code ?? "").trim().toLowerCase();
      const name = courseLabel(r.course).trim().toLowerCase();
      return (code !== "" && printed.includes(code))
        || (name !== "" && printed.includes(name));
    });
    if (!hit) continue;
    const key = hit.course.code ?? courseLabel(hit.course);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit.course);
  }
  return out;
}

/**
 * Answer a topic, or decline.
 *
 * Null when the engine cannot answer it for this student - no courses, no
 * attendance recorded, no timetable. Declining is the correct outcome there,
 * and the caller falls back to routing: a screen that shows nothing is more
 * honest than a sentence built from nothing.
 */
export function answerFor(topic: Topic, code?: string): Answer | null {
  const all = rows();
  if (all.length === 0) return null;

  const picked = code
    ? all.filter((r) => r.course.code === code)
    : all;
  if (picked.length === 0) return null;

  if (topic === "tomorrow") {
    const courses = tomorrowCourses();
    if (courses.length === 0) return null;
    const lines = courses.map(skipLine).filter((l): l is string => l !== null);
    if (lines.length === 0) return null;
    const free = courses.every((c) => {
      const cost = absenceCost(c.attended, c.held, c.dl ?? 0, 1);
      return cost !== null && cost.marksLost === 0 && cost.eligibleAfter;
    });
    return {
      headline: free
        ? `Tomorrow is free — missing any of ${courses.length} would cost nothing.`
        : `Tomorrow costs you something.`,
      lines, view: "attendance",
    };
  }

  if (topic === "eligibility") {
    const short = picked.filter((r) => {
      const cost = absenceCost(r.course.attended, r.course.held, r.course.dl ?? 0, 0);
      return cost !== null && !cost.eligibleBefore;
    });
    return {
      headline: short.length === 0
        ? `Eligible in all ${picked.length} — every subject is above 75%.`
        : `${short.length} of ${picked.length} below 75%.`,
      lines: (short.length === 0 ? picked : short).map((r) => budgetLine(r.course)),
      view: "attendance",
    };
  }

  const line = topic === "skip_cost" ? skipLine : budgetLine;
  const lines = picked
    .map((r) => line(r.course))
    .filter((l): l is string => l !== null);
  if (lines.length === 0) return null;

  // With one subject named, the sentence IS the answer and repeating it as a
  // heading says the same thing twice.
  if (picked.length === 1) {
    return { headline: lines[0]!, lines: [], view: "attendance" };
  }
  return {
    headline: topic === "skip_cost"
      ? "What one more absence costs, per subject:"
      : "Classes you can still miss for free:",
    lines, view: "attendance",
  };
}

/**
 * Recognise a question shape without asking anybody.
 *
 * Cheap keyword detection, run before the model and before the subject matcher.
 * It exists because the questions worth answering are asked in a small number
 * of ways, and a student typing "can i skip tomorrow" should not wait on a
 * network round trip for a sentence this machine can produce immediately.
 *
 * Only fires on an unambiguous phrase. Anything it is not sure about falls
 * through to the router, which is allowed to be slower and is allowed to say no.
 */
export function detectTopic(query: string): Topic | null {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  const has = (...words: string[]) => words.some((w) => q.includes(` ${w} `));

  if (has("tomorrow", "tmrw", "tommorow", "tommorw")) return "tomorrow";
  if (has("eligible", "eligibility", "debar", "debarred", "condonation")) {
    return "eligibility";
  }
  // "one more", "another class", "if i miss" - all the ways of asking what the
  // NEXT absence costs, as opposed to how many are left.
  if ((has("one", "another", "1") && has("miss", "skip", "bunk", "cut", "leave"))
      || q.includes(" one more ") || q.includes(" what happens if ")) {
    return "skip_cost";
  }
  if (has("miss", "skip", "bunk", "cut", "leave", "leaves", "absent")) {
    return "budget";
  }
  return null;
}
