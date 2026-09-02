import { absenceCost, courseLabel, freeSkips, requiredEseCell } from "../engine";
import type { Course, Evaluation } from "../engine";
import { goalPlan, goalRequirement, overall, rows, state, summary, targets } from "./store";
import type { View } from "./nav";
import { lookupCapability, lookupTerm } from "./glossary";

/**
 * What the assistant is called.
 *
 * It needed a name because it now says things rather than only opening screens,
 * and an answer that appears with no attribution reads as the app asserting a
 * fact rather than as something having worked it out.
 *
 * Tex is already inside TargetX, which is why it does not need explaining, and
 * it is one syllable so it fits a button label without being shortened again.
 * Every user-facing use of the name reads this constant - renaming it is a one
 * line change, and no string anywhere spells it out.
 */
export const ASSISTANT = "Tex";

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
  "attendance_now", "marks_now", "need_to_pass", "standing",
] as const;
export type Topic = (typeof TOPICS)[number];

export interface Answer {
  /** The sentence. Every figure in it came from the engine. */
  headline: string;
  /**
   * True when this is a definition rather than a figure about this student.
   *
   * Rendered differently because it is a different KIND of claim: a definition
   * is the regulation, and a figure is this student's record. Presenting them
   * identically would let "condonation is available down to 60%" read as
   * something computed about them.
   */
  isDefinition?: boolean;
  /**
   * True when this says what the app is MISSING rather than what it knows.
   *
   * "Can I skip tomorrow" is the headline feature and it returned silence for
   * any student without a timetable - the question fell through to the router
   * and the box offered a screen, so the app looked like it had never heard of
   * its own advertised trick. Saying which record is absent is an answer; a
   * blank is not. Attributed differently because it asserts nothing about this
   * student, so it must not read as though it were computed from their record.
   */
  isGap?: boolean;
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

/**
 * What a course has scored internally, and what it could still reach.
 *
 * Both ends, because `cie` alone reads as a verdict on a semester that is not
 * over: a course sitting at 39 with an unwritten series exam has not lost the
 * other 11 marks, it has not been given them yet. `cieCeiling` is the engine's
 * own name for that distinction and this sentence is the only place a student
 * sees the two side by side.
 */
function cieLine(row: { course: Course; ev: Evaluation }): string {
  const label = courseLabel(row.course);
  const { cie, cieMax, cieCeiling } = row.ev;
  if (cieMax <= 0) return `${label} — no internal marks recorded`;
  // One decimal, the same as the ledger's CIE column. A student reads this
  // sentence and then goes and looks at the table; two roundings of the same
  // figure would read as two different figures.
  const mk = (v: number) => v.toFixed(1).replace(/\.0$/, "");
  const scored = `${label} — ${mk(cie)} of ${mk(cieMax)} internal`;
  return cieCeiling > cie
    ? `${scored}, up to ${mk(cieCeiling)} with everything still to come`
    : `${scored}, and that is settled`;
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
 * Where a subject's attendance stands right now.
 *
 * The plainest question a student can ask, and the one that fell through: the
 * detector only fired on forward-looking words - skip, miss, eligible - so
 * "what is my attendance in CN" was routed to a screen while "can I miss one"
 * was answered outright. The counts are included because a percentage without
 * its numerator and denominator is a figure the student cannot check.
 */
function standingLine(course: Course): string {
  const label = courseLabel(course);
  const cost = absenceCost(course.attended, course.held, course.dl ?? 0, 0);
  if (cost === null) return `${label} — attendance not recorded`;
  const counts = `${course.attended} of ${course.held}`;
  const mark = `${marks(cost.marksBefore)} of the attendance CIE`;
  return cost.eligibleBefore
    ? `${label} — ${pct(cost.before)} (${counts}), earning ${mark}`
    : `${label} — ${pct(cost.before)} (${counts}), below 75% and not eligible`;
}

/**
 * What this subject still needs in the end-semester exam.
 *
 * `requiredEseCell` is the engine's own answer and is already what the Ledger
 * prints; this states it in a sentence instead of a table cell. `bound` means
 * the passing mark is not what binds - the student's own target grade is - and
 * saying which is the difference between "you need 28" and "you need 28 for the
 * grade you asked for, 19 to pass".
 */
function needLine(course: Course, ev: Evaluation): string {
  const label = courseLabel(course);
  if (ev.grade !== null && ev.ese !== null && ev.ese !== undefined) {
    // Already sat and marked: there is nothing left to need.
    return `${label} — already graded ${ev.grade}`;
  }
  const pass = requiredEseCell(ev.needPass, ev.needPassBest);
  if (!pass.shown.possible) {
    return `${label} — cannot pass on the marks recorded so far`;
  }
  const target = requiredEseCell(ev.needTarget, ev.needTargetBest);
  const base = `${label} — needs ${pass.shown.value} of ${ev.eseMax} in the final to pass`;
  // Only mention the target when it asks for MORE than passing does; a target
  // already satisfied is not a thing to go and do.
  return target.shown.possible && target.shown.value > pass.shown.value
    ? `${base}, ${target.shown.value} for your target`
    : base;
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
    if (courses.length === 0) {
      const haveGrid = (state.timetable?.grid ?? []).length > 0;
      return {
        headline: haveGrid
          ? "Nothing scheduled tomorrow, so there is nothing to miss."
          : "I need your timetable before I can price tomorrow — sync it and ask again.",
        lines: [], view: "attendance", isGap: !haveGrid,
      };
    }
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

  if (topic === "standing") {
    // The one topic that is not per-subject: a CGPA is a fact about the whole
    // record, and listing it per course would be answering a different question.
    const cgpa = overall();
    if (cgpa.credits <= 0) return null;
    const need = goalRequirement();
    const plan = goalPlan();
    const lines: string[] = [
      `${cgpa.credits} registered credits counted, ${cgpa.percent.toFixed(1)}%`,
    ];
    const target = targets().cgpa;
    if (target !== null && target !== undefined && need !== null) {
      lines.push(need.possible && need.required !== null
        ? `To reach ${target.toFixed(1)}, you need ${need.required.toFixed(2)} SGPA from here on`
        : `${target.toFixed(1)} is no longer reachable in the semesters left`);
      // Three states, not two. `reachable: false` explicitly does NOT mean
      // impossible - goals.ts:395 says it means "this route does not guarantee
      // it", and `conditional` is the case where the target is still open on a
      // harder route or on marks the plan cannot price yet. Collapsing those
      // into "not reachable" would tell a student their target is gone when it
      // is not.
      if (plan !== null) {
        lines.push(plan.reachable
          ? "This semester's subjects can carry it"
          : plan.conditional
            ? "Still open, but today's marks do not guarantee it"
            : "This semester's subjects cannot carry it");
      }
    }
    const sem = summary();
    if (sem.assessed > 0) {
      lines.push(`This semester projects to ${sem.sgpaProjected.toFixed(2)} SGPA`);
    }
    return { headline: `CGPA ${cgpa.cgpa.toFixed(2)}`, lines, view: "home" };
  }

  if (topic === "need_to_pass") {
    const lines = picked.map((r) => needLine(r.course, r.ev));
    if (lines.length === 0) return null;
    if (picked.length === 1) {
      return { headline: lines[0]!, lines: [], view: "ledger" };
    }
    return {
      headline: "What each subject needs in the final:",
      lines, view: "ledger",
    };
  }

  if (topic === "marks_now") {
    const lines = picked.map(cieLine);
    if (picked.length === 1) {
      return { headline: lines[0]!, lines: [], view: "ledger" };
    }
    return { headline: "Your internal marks so far:", lines, view: "ledger" };
  }

  const line = topic === "skip_cost" ? skipLine
    : topic === "attendance_now" ? standingLine
    : budgetLine;
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
      : topic === "attendance_now"
        ? "Where your attendance stands:"
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
/**
 * A definition, when the question is asking what a word means.
 *
 * Tried BEFORE the topic detector and works with an empty record, because "what
 * is CIE" has the same answer for a student who has synced nothing. It is also
 * what stops the misfires: "what is condonation" used to match the eligibility
 * topic and reply with the student's own miss budget.
 */
export function defineFor(query: string): Answer | null {
  // A definition first, then a fact about the app. Definitions are the
  // narrower test, so trying them first means "what is CIE" is never mistaken
  // for a question about the product.
  const term = lookupTerm(query) ?? lookupCapability(query);
  if (!term) return null;
  return {
    headline: term.name, lines: [term.body], view: "ledger", isDefinition: true,
  };
}

export function detectTopic(query: string): Topic | null {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  const has = (...words: string[]) => words.some((w) => q.includes(` ${w} `));

  /**
   * A question about the RULE is not a question about this student.
   *
   * "How is SGPA calculated" contains "sgpa" and was being answered with the
   * student's own CGPA - a confident reply to a question nobody asked, which is
   * worse than routing, because a route at least lands somewhere the answer
   * might be. These fall through so the caller can send them to the glossary.
   *
   * The test is possessive: "how badly would it affect MY attendance" is about
   * this student and is answered; "how does attendance affect marks" is about
   * the regulation and is not.
   */
  const personal = has("my", "i", "me", "mine", "im") || q.includes(" am i ");
  const explains = has("calculated", "calculate", "computed", "compute",
                       "explain", "explained", "works", "work", "mean", "means",
                       "definition", "formula", "affect", "affects", "why")
    || q.includes(" pass mark ") || q.includes(" pass marks ");
  if (explains && !personal) return null;

  /**
   * An exam is not a class, and missing one is not an absence.
   *
   * "What happens if I miss the series exam" was answered with what one more
   * ABSENCE costs, and "what if I miss an exam" with how many classes are free
   * to skip. Both are confident answers to a question nobody asked, and both
   * come from the attendance branches below, which count classes and know
   * nothing about exams. When the thing being missed is named as an exam, none
   * of them apply and the question belongs to the router.
   *
   * Deliberately narrow: only the MISSING verbs are gated. "What do I need to
   * pass the exam" names an exam too and is answered exactly, so gating on the
   * exam word alone would trade two misfires for a worse silence.
   */
  if (has("exam", "exams", "test", "series", "viva", "practical")
      && has("miss", "missed", "skip", "skipped", "bunk", "absent")) {
    return null;
  }

  if (has("tomorrow", "tmrw", "tommorow", "tommorw")) return "tomorrow";

  // Ordered before the attendance branches: "what do i need to pass" contains
  // no attendance word, but "how many marks do i need" and "am i failing" would
  // otherwise be caught by nothing at all.
  if (has("pass", "passing", "fail", "failing", "final", "ese", "endsem")
      || (has("need", "needed") && has("marks", "mark", "exam", "grade"))) {
    return "need_to_pass";
  }
  if (has("cgpa", "sgpa", "gpa", "percentage") || q.includes(" first class ")
      || q.includes(" where do i stand ") || has("standing", "distinction")) {
    return "standing";
  }
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
  // The plainest question there is, and the one that used to fall through: the
  // detector only fired on forward-looking words, so "can i miss one" was
  // answered and "what is my attendance" was routed to a screen.
  // After every attendance branch, because "how many marks does one absence
  // cost" is a question about skipping that happens to say "marks". Placed
  // here it catches only what is left: "ml marks", "my internals", "what did i
  // score" - the plainest question a student types, and one that used to fall
  // all the way through to the router.
  if (has("marks", "mark", "score", "scored", "internal", "internals", "cie")) {
    return "marks_now";
  }
  if (has("attendance", "attended", "present")) return "attendance_now";
  return null;
}
