import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { courseLabel } from "../engine";
import { rows } from "../state/store";
import { VIEWS, setView } from "../state/nav";
import type { View } from "../state/nav";
import { askConfigured, askRemote } from "../state/ask";
import { ASSISTANT, answerFor, defineFor, detectTopic } from "../state/answers";
import { trace } from "../state/trace";
import type { Topic } from "../state/answers";
import { authBusy, authConfigured, signIn, signedIn } from "../state/auth";
import { morph } from "./morph";

/**
 * The command palette.
 *
 * The app had no keyboard route to anything and no way to find a subject: the
 * semester table is fourteen columns with no sort, no filter and no search, so
 * a student who knew exactly which subject they were worried about still had to
 * read down the grid for it. This is that route.
 *
 * It ROUTES, it does not answer. Every row here resolves to a view or a subject
 * that already exists, and the figures it prints beside a subject come from the
 * engine's own evaluation. Nothing is generated, summarised or inferred, which
 * is what makes it safe to put a question box at the top of an app whose whole
 * trust position is that it never states a number it cannot show its working
 * for. The model behind this box selects among these same rows - it does not
 * get to invent one.
 *
 * The remote route is deliberately the SECOND thing tried, and only on Enter.
 * Local matching is free, offline, instant and cannot hallucinate, so it answers
 * every question it can; calling a metered API per keystroke would be an
 * unbounded bill for answers the machine already had.
 */

interface Hit {
  kind: "view" | "subject" | "ask";
  label: string;
  /** The line under the label. Engine-computed for subjects. */
  detail: string;
  go: () => void;
}

/**
 * Words that open a question.
 *
 * Used to decide whether asking is the FIRST offer or the last one. Not used
 * to decide whether asking is offered at all - that would rebuild the trap
 * this exists to remove, just with a different gate.
 */
const OPENERS = new Set([
  "am", "are", "can", "could", "did", "do", "does", "how", "if", "is", "may",
  "should", "was", "were", "what", "when", "where", "which", "who", "why",
  "will", "would",
]);

/**
 * Does this read as a question rather than a search?
 *
 * Three signals, any of which is enough: it ends in a question mark, it opens
 * with a question word, or it is long enough that nobody types it to filter a
 * list. A student typing "cn" wants the subject; a student typing "what
 * happens if I miss the series exam" does not want a subject at all.
 */
/**
 * Things a student says to a person, not to a search box.
 *
 * Observed live: "hi" put History at the top of the list with the cursor on
 * it, because "hi" is a substring of "History" - a perfectly good match to a
 * word nobody was searching for. Enter then navigated. A greeting has no
 * result; it has a reply, so it goes to the one row that can give one.
 */
const GREETINGS = new Set([
  "hi", "hey", "hello", "yo", "hii", "hiii", "helo", "hlo", "sup",
  "thanks", "thank", "ty", "ok", "okay", "test", "testing",
]);

function isGreeting(q: string): boolean {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.length > 0 && words.length <= 2
    && words.every((w) => GREETINGS.has(w));
}

function readsAsQuestion(q: string): boolean {
  const trimmed = q.trim();
  if (trimmed === "") return false;
  if (trimmed.endsWith("?")) return true;
  const words = trimmed.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length >= 5) return true;
  return words.length > 0 && OPENERS.has(words[0]!);
}

/**
 * Words that carry no target.
 *
 * A student types a question, not a keyword: "how many classes can I miss in
 * ML". Matched literally that finds nothing, because no subject is called
 * "how". The question words are dropped and what is left - "classes", "miss",
 * "ml" - is matched term by term, so the sentence resolves to the same subject
 * the bare code would have. This is not language understanding and does not
 * pretend to be: it is a stop list, and every figure it leads to is one the
 * engine already computed.
 */
const STOP = new Set([
  "a", "am", "an", "and", "any", "are", "be", "can", "could", "do", "does",
  "for", "get", "have", "how", "i", "if", "in", "is", "it", "many", "me",
  "more", "much", "my", "of", "on", "or", "should", "show", "still", "take",
  "tell", "the", "this", "to", "what", "whats", "when", "where", "which",
  "will", "with", "you",
  // Domain words that describe the QUESTION rather than name a subject. They
  // are in every phrasing of it, so keeping them would match every subject.
  "attendance", "bunk", "class", "classes", "cut", "day", "days", "leave",
  "leaves", "mark", "marks", "miss", "percent", "percentage", "skip",
]);

/** The words in a query that could name something. */
function terms(q: string): string[] {
  return q.toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOP.has(w));
}

/**
 * Match a subject label against one term.
 *
 * `loose` allows a subsequence, so "cn" finds "Computer Networks". That is the
 * behaviour a student typing an abbreviation wants, and it is ONLY safe when
 * the abbreviation is the whole query.
 *
 * Applied to words pulled out of a sentence it matches almost anything, and
 * measurably did: "if i took a leave tomorrow how badly would it affect my
 * attendance" left the terms [took, tommorw, badly, would, affect], and "took"
 * subsequence-matched "Computer Networks" - t, o, o, k in order, scattered
 * across three words. The student got one arbitrary subject and no answer.
 *
 * Worse than a bad row: a local hit stops Enter from reaching the router, so a
 * phantom match silently disables the one path that could have answered.
 */
function rank(haystack: string, needle: string, loose = true): number {
  if (!needle) return RANK_NAMED;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return RANK_NAMED;
  // Initials, which work in a sentence because they cannot over-match: the
  // initials of "Computer Networks" are exactly "cn" and nothing else. Losing
  // this was the cost of the fix above - "what do i need to pass cn" is four
  // terms, so the loose path is closed and "cn" stopped resolving. This gives
  // it back without giving back "one" matching Computer Networks.
  if (n.length >= 2 && initials(h) === n) return RANK_NAMED;
  if (!loose) return 0;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i += 1;
    if (i === n.length) return RANK_SCATTERED;
  }
  return 0;
}

/**
 * A term that names the subject: its code, its name, or its initials exactly.
 */
const RANK_NAMED = 2;
/** A term whose letters merely appear in the name, in order, anywhere. */
const RANK_SCATTERED = 1;

function matches(haystack: string, needle: string, loose = true): boolean {
  return rank(haystack, needle, loose) > 0;
}

/** "Computer Networks" -> "cn". Words only; "and"/"of" are not initials. */
const SKIP_WORD = new Set(["and", "of", "the", "for", "in", "to", "a"]);
function initials(label: string): string {
  return label.toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !SKIP_WORD.has(w))
    .map((w) => w[0])
    .join("");
}

export function Palette(props: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = createSignal("");
  const [cursor, setCursor] = createSignal(0);
  const [asking, setAsking] = createSignal(false);
  /** What the remote route had to say, when it had to say anything. */
  const [remote, setRemote] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;
  let inflight: AbortController | undefined;
  let shell: HTMLDivElement | undefined;
  let scrim: HTMLDivElement | undefined;

  /**
   * Mounted, which is not the same as open.
   *
   * The palette has to outlive `props.open` by the length of the shrink, or
   * there is nothing left on screen to animate back into the pill. `alive` is
   * a plain variable rather than a second signal because the effect below both
   * reads and writes this state, and a signal would make that a loop.
   */
  const [mounted, setMounted] = createSignal(props.open);
  let alive = props.open;

  /**
   * The answer, when the question is one the engine can answer outright.
   *
   * Computed before routing and shown above the results, because it IS the
   * answer - the rows below it are where to go for the working. Detection is
   * local keywords, so "can i skip tomorrow" is answered without a network
   * round trip for a sentence this machine can produce immediately.
   */
  const answer = createMemo(() => {
    const q = query().trim();
    if (q === "") return null;
    // Definitions first, and they work with an empty record: "what is CIE" has
    // the same answer for a student who has synced nothing. This is also what
    // stops the misfires - "what is condonation" used to match the eligibility
    // topic and reply with the student's own miss budget.
    const defined = defineFor(q);
    if (defined) return defined;
    const topic = detectTopic(q);
    if (topic === null) return null;
    // A subject named in the question narrows the answer to it; otherwise the
    // question is about every subject and every subject answers.
    const words = terms(q);
    const loose = words.length === 1;
    // The BEST match, not the first one. "cn" is the initials of Computer
    // Networks and also a subsequence of Ma-c-hi-n-e Learning, and taking the
    // first row that matched by any rule made "cn attendance" answer about
    // Machine Learning - the wrong subject, stated with full confidence.
    let named: { course: { code?: string | null } } | undefined;
    let best = 0;
    for (const r of words.length === 0 ? [] : rows()) {
      let score = 0;
      for (const w of words) {
        score = Math.max(score, rank(courseLabel(r.course), w, loose),
                                rank(r.course.code ?? "", w, loose));
      }
      if (score > best) { best = score; named = r; }
    }
    return answerFor(topic, named?.course.code ?? undefined);
  });

  const hits = createMemo<Hit[]>(() => {
    const q = query().trim();
    // An empty box lists nothing. It used to open onto every view and every
    // subject, which is not a set of results - it is the whole app enumerated
    // in the one place a student came to narrow it down. There is nothing to
    // read there and nothing to choose between, so the list starts when the
    // typing does.
    if (q === "") return [];
    // A question with nothing nameable left in it - "how many can I miss" -
    // is not a failed search. It is a question about every subject, so every
    // subject answers it.
    const words = terms(q);
    // One term is an abbreviation and gets the loose match. Several terms are a
    // sentence, and a sentence's words have to appear literally - see `matches`.
    const loose = words.length === 1;
    const anyTerm = (hay: string) =>
      words.length === 0 || words.some((w) => matches(hay, w, loose));
    const out: Hit[] = [];

    // Views are matched on the RAW question, not on `terms`. The stop list
    // exists to stop domain words matching every subject, and those same words
    // - attendance, marks, results, sync - are the ones that name a screen. A
    // question stripped of them had nothing left to match a view with.
    const raw = new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    for (const v of VIEWS) {
      if (!matches(v.label, q) && !v.keys.some((k) => raw.has(k))) continue;
      out.push({
        kind: "view", label: v.label, detail: v.hint ?? "",
        go: () => setView(v.id as View),
      });
    }

    /*
     * Subject rows, ranked and then culled.
     *
     * Observed live: typing "hi" listed MACHINE LEARNING, because h and i
     * appear in that order somewhere inside "machine". A subject matched by
     * scattered letters is noise next to one matched by its actual name, and
     * it was pushing the row the student wanted further down a list they were
     * already complaining was in the way. Scattered matches are kept only
     * when nothing matched properly - there, a weak row still beats no row.
     */
    const scored: { hit: Hit; score: number }[] = [];
    for (const row of rows()) {
      const label = courseLabel(row.course);
      let score = 0;
      for (const w of words) {
        score = Math.max(score, rank(label, w, loose),
                                rank(row.course.code ?? "", w, loose));
      }
      // Nothing nameable left after the stop list means one of two things,
      // and they are opposites. "How many can I miss" is a question about
      // every subject, so every subject answers it. "What are you?" is a
      // question about none of them - and it listed all seven, observed live,
      // because both cases arrive here looking identical. The engine's answer
      // is what tells them apart: it spans the subjects, or there is nothing
      // for these rows to be the working for.
      if (words.length === 0) {
        const said = answer();
        // A definition is not about this student, so no subject is its
        // working. Observed live: "what can you do" was answered correctly
        // from the glossary and then listed all seven subjects underneath it,
        // because an answer of any kind was being read as an answer that
        // spans the subjects. Only a computed one does.
        if (said === null || said.isDefinition) continue;
        score = RANK_NAMED;
      }
      if (score === 0) continue;
      // Only facts the engine already settled. A subject with no attendance on
      // record says so rather than being given a percentage.
      const att = row.ev.attendance;
      const plan = row.ev.plan;
      // "How many classes can I miss" is the question this app was built to
      // answer, so it is the FIRST thing a subject row says - not a percentage
      // the student then has to do arithmetic on. Both halves come straight
      // from the engine's solver: `skip` is how many more classes can be
      // missed while staying eligible, `attend` is the run needed to climb
      // back. Neither is computed here.
      const budget = plan === null
        ? null
        : plan.state === "surplus"
          ? `can miss ${plan.skip} more`
          : plan.attend === null
            ? "cannot reach 75% this semester"
            : `must attend ${plan.attend} in a row`;
      const detail = att === null
        ? "attendance not recorded"
        : `${budget === null ? "" : budget + " · "}${att.toFixed(0)}% · CIE ${row.ev.cie} of ${row.ev.cieMax}`;
      scored.push({
        hit: { kind: "subject", label, detail, go: () => setView("ledger") },
        score,
      });
    }
    const strongest = scored.reduce((m, r) => Math.max(m, r.score), 0);
    for (const r of scored) if (r.score === strongest) out.push(r.hit);

    /*
     * Asking is a row, not a fallback.
     *
     * It used to be reachable only when this list came back EMPTY: Enter ran
     * the highlighted hit whenever there was one, and the "Press Enter to ask"
     * line lived in the no-results branch. Views match on raw words, and those
     * words are `attendance`, `marks`, `results`, `sync` - the vocabulary every
     * real question is made of. So a genuine question almost always produced a
     * hit, and the hit silently disabled the only route that could answer it.
     * The comment on `matches` predicted exactly this; it was the rule rather
     * than the edge case.
     *
     * As a row the ambiguity is gone: the student can see asking is available
     * and choose it, and Enter means one thing - run what is highlighted.
     */
    /*
     * Signed in only.
     *
     * A signed-out student gets the nudge in the no-results branch instead, and
     * that placement is deliberate: the account is worth mentioning at the
     * moment the assistant would have been used, not as a standing row over a
     * box that works perfectly well without one. Putting "Sign in" under every
     * query would be the banner that position exists to avoid.
     *
     * The trap this row removes only ever applied to someone who COULD ask.
     */
    if (askConfigured() && signedIn()) {
      // Named after what it would cost, when it would cost anything.
      //
      // Observed live: a student asked "who are you", the glossary answered it
      // on the spot, and they pressed Enter anyway - because the ask row was
      // the only row, so the cursor was on it. That spent a question from the
      // daily allowance to be told something already on screen. The row stays
      // selectable, because a second opinion is a legitimate thing to want;
      // it just stops looking like the way to get the first one.
      const answered = answer() !== null;
      const askRow: Hit = {
        kind: "ask",
        label: answered ? `Ask ${ASSISTANT} anyway` : `Ask ${ASSISTANT}`,
        // Still quotes the question - a test defends that, and rightly: the
        // row has to be about what was typed. The cost is appended, not
        // substituted for it.
        detail: answered
          ? `“${q}” · uses one of today's questions`
          : `“${q}”`,
        // Set by the component, which owns the request and its in-flight state.
        go: () => {},
      };
      // First when it reads as a question the engine could NOT answer; last
      // otherwise. Ordering is a preference about what is most likely wanted -
      // it never decides whether the option exists, which is the whole point of
      // the change.
      //
      // `answer()` is in the condition on purpose. When the engine has already
      // worked something out, it is on screen above this list, free, offline
      // and derived from the student's own record. Putting a metered round trip
      // under the cursor in front of an answer that is already displayed would
      // bill for a question that has been answered.
      const engineAnswered = answer() !== null;
      if (readsAsQuestion(q) && !engineAnswered) out.unshift(askRow);
      else out.push(askRow);
    }

    return out;
  });

  // A filtered list whose selection stayed put would run the wrong row on
  // Enter as soon as the results moved under it.
  createEffect(() => {
    query();
    setCursor(0);
    // A verdict about the previous question is worse than no verdict at all
    // once the question has changed under it.
    setRemote(null);
  });

  createEffect(() => {
    if (props.open) { setQuery(""); setCursor(0); queueMicrotask(() => input?.focus()); }
  });

  /**
   * Grow on open, shrink on close, and only then unmount.
   *
   * The header pill is hidden for as long as the palette stands in for it -
   * the two are one object, and showing both would give the morph something
   * to visibly separate from. It comes back at the end of the shrink, not the
   * start of it.
   */
  createEffect(() => {
    if (props.open) {
      alive = true;
      setMounted(true);
      document.documentElement.dataset.palette = "open";
      // After the element exists and has a box to measure.
      queueMicrotask(() => {
        if (shell && scrim) morph(shell, scrim, "in");
      });
      return;
    }
    if (!alive) return;
    alive = false;

    const gone = () => {
      setMounted(false);
      delete document.documentElement.dataset.palette;
    };
    const out = shell && scrim ? morph(shell, scrim, "out") : null;
    // No animation to wait for is not a failure - it is every case where the
    // pill is off screen, motion is off, or this is a test. Unmount now.
    if (!out) { gone(); return; }
    out.finished.then(gone, gone);
  });

  // A palette torn down mid-shrink would leave the header pill invisible for
  // the rest of the session.
  onCleanup(() => { delete document.documentElement.dataset.palette; });

  // A request whose palette has closed has nobody left to answer.
  onCleanup(() => inflight?.abort());

  const run = (hit: Hit | undefined) => {
    if (!hit) return;
    // What was asked, what the engine said about it, and what the box offered
    // - one line, at the moment the student committed to it.
    trace("asked", JSON.stringify({
      q: query().trim(),
      topic: detectTopic(query().trim()),
      answer: answer()?.headline ?? null,
      chose: `${hit.kind}:${hit.label}`,
      rows: hits().map((h) => `${h.kind}:${h.label}`),
    }));
    // The ask row is the one hit that does not navigate. It stays in the
    // palette because the answer lands here, and closing on the way to it
    // would throw away the thing the student pressed Enter for.
    if (hit.kind === "ask") { void ask(); return; }
    hit.go();
    props.onClose();
  };

  /**
   * Hand the question to the router.
   *
   * Only reached when local matching found nothing, so there is no risk of the
   * model overriding an answer the engine could already give. A returned route
   * is followed; a returned subject is matched back to a real row before the
   * app moves, because "the worker validated the code" and "this student has
   * that subject" are not the same claim.
   */
  const ask = async () => {
    const q = query().trim();
    if (q === "" || asking()) return;
    inflight?.abort();
    const ctl = new AbortController();
    inflight = ctl;
    setAsking(true);
    setRemote(null);
    try {
      const out = await askRemote(q, rows().map((r) => ({
        code: r.course.code ?? "",
        name: courseLabel(r.course),
      })), ctl.signal);

      if (!out.ok) {
        trace("router refused", out.kind);
        setRemote(
          out.kind === "signin" ? "Sign in from the profile menu to ask questions."
          : out.kind === "limit" ? "That is all the questions for today. The rest of the app is unchanged."
          : out.kind === "offline" ? "No connection. Everything below still works offline."
          : out.kind === "unconfigured" ? "Question routing is not set up in this build."
          : "That did not go through. Try rephrasing it.",
        );
        return;
      }

      const a = out.action;
      trace("router said", JSON.stringify(a));

      /*
       * A sentence keeps the palette open; a bare route does not.
       *
       * The screen still changes either way - it changes underneath, and the
       * student is already there when they press Escape. Closing on top of a
       * sentence would show it for one frame and take it away, which is worse
       * than never having written it.
       */
      if (a.kind === "view") {
        setView(a.view);
        if (a.say) { setRemote(a.say); return; }
        props.onClose();
        return;
      }
      if (a.kind === "subject") {
        const hit = rows().find((r) => r.course.code === a.code);
        if (hit) {
          setView(a.view);
          if (a.say) { setRemote(a.say); return; }
          props.onClose();
          return;
        }
        setRemote(a.say ?? "That subject is not in this semester.");
        return;
      }
      // Its own words when it has them. The canned lines stay as the floor:
      // `say` is dropped whenever it names a figure, and a refusal with no
      // explanation at all reads as the app breaking rather than declining.
      setRemote(
        a.say
        ?? (a.reason === "off_topic"
          ? "That one is outside what TargetX knows about."
          : a.reason === "no_match"
            ? "Nothing in your record matches that."
            : "Not sure what that is asking. Try naming the subject."),
      );
    } finally {
      if (inflight === ctl) inflight = undefined;
      setAsking(false);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const list = hits();
    if (e.key === "Escape") { e.preventDefault(); props.onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, list.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Ctrl/Cmd+Enter asks regardless of what is highlighted, so a student
      // who wants the router never has to arrow to it.
      if (e.ctrlKey || e.metaKey) {
        if (!signedIn()) { void signIn(); return; }
        void ask();
        return;
      }
      // Enter means one thing now: run what is highlighted. Asking is a row in
      // that list, so it no longer needs a rule of its own - and cannot be
      // shut out by a match that happened to score.
      const hit = list[cursor()];
      if (hit) { run(hit); return; }
      void ask();
    }
  };

  return (
    <Show when={mounted()}>
      <div ref={scrim} class="palette-scrim" onClick={props.onClose}>
        <div ref={shell} class="palette" role="dialog" aria-modal="true" aria-label="Search"
             onClick={(e) => e.stopPropagation()}>
          <input ref={input} class="palette-input" value={query()}
                 placeholder={`Ask ${ASSISTANT} — how many classes can I miss in ML?`}
                 aria-label="Search subjects and views"
                 onInput={(e) => setQuery(e.currentTarget.value)}
                 onKeyDown={onKey} />

          <Show when={answer()}>
            {(said) => (
              <div class="palette-answer" classList={{ definition: said().isDefinition }}>
                {/* Attributed, because an answer with no author reads as the
                    app asserting a fact rather than as something that was
                    worked out - and the two deserve different trust. */}
                <p class="palette-answer-who">
                  {said().isGap ? `${ASSISTANT} · what I am missing`
                    : said().isDefinition ? `${ASSISTANT} · from the KTU regulations`
                                          : `${ASSISTANT} · from your own record`}
                </p>
                <p class="palette-answer-head">{said().headline}</p>
                <Show when={said().lines.length > 0}>
                  <ul class="palette-answer-lines">
                    <For each={said().lines}>{(line) => <li>{line}</li>}</For>
                  </ul>
                </Show>
                {/* The answer is not a substitute for the working. */}
                <Show when={!said().isDefinition}>
                  <button class="link" onClick={() => {
                    setView(said().view);
                    props.onClose();
                  }}>See the full breakdown</button>
                </Show>
              </div>
            )}
          </Show>

          {/* What the router said, wherever the list stands.
              This lived inside the no-results branch, which was safe only
              while asking REQUIRED an empty list. Now that asking is a row,
              the list is never empty when it is offered - so leaving the
              reply in there would have meant "No connection" and "that is all
              the questions for today" could never be shown to anyone. */}
          <Show when={remote()}>
            {(said) => <p class="palette-remote">{said()}</p>}
          </Show>

          <Show when={hits().length > 0} fallback={
            // An untouched box says nothing at all. "Nothing matches" is a
            // verdict on a search, and no search has happened yet - the
            // placeholder in the field is already the whole instruction.
            <Show when={query().trim() !== ""}>
              <div class="palette-empty">
                    <p>Nothing here matches “{query().trim()}”.</p>
                    {/* Signed out, this said nothing at all - so a student who
                        had just been shown that the box answers questions hit
                        the one question it could not answer and was told
                        nothing about why, or what to do. The nudge belongs
                        exactly here: at the moment the assistant would have
                        been used, not as a banner over a box that mostly works
                        without an account. */}
                    <Show when={askConfigured()}>
                      <Show when={signedIn()} fallback={
                        <Show when={authConfigured()}>
                          <p class="fineprint">
                            <button class="link" disabled={authBusy()}
                                    onClick={() => { void signIn(); }}>
                              {authBusy() ? "Opening your browser…" : `Sign in to ask ${ASSISTANT}`}
                            </button>
                            {" "}— everything else in TargetX works without an account.
                          </p>
                        </Show>
                      }>
                        <p class="fineprint">
                          {asking() ? "Working it out…" : `Press Enter to ask ${ASSISTANT}.`}
                        </p>
                      </Show>
                    </Show>
              </div>
            </Show>
          }>
            <ul class="palette-list" role="listbox" aria-label="Results">
              <For each={hits()}>{(hit, i) => (
                <li>
                  <button class="palette-hit" role="option"
                          aria-selected={i() === cursor()}
                          // In flight, in both directions: a browser opening
                          // for sign-in and a question already on its way are
                          // both states where pressing again does nothing good.
                          disabled={hit.kind === "ask" && asking()}
                          onMouseEnter={() => setCursor(i())}
                          onClick={() => run(hit)}>
                    <span class="palette-kind">
                      {hit.kind === "view" ? "View" : hit.kind === "subject" ? "Subject" : "Ask"}
                    </span>
                    <span class="palette-label">
                      {hit.kind === "ask" && asking() ? "Working it out…" : hit.label}
                    </span>
                    <span class="palette-detail">{hit.detail}</span>
                  </button>
                </li>
              )}</For>
            </ul>
          </Show>
        </div>
      </div>
    </Show>
  );
}

/** Ctrl/Cmd+K from anywhere. Returns nothing; it only wires the shortcut. */
export function usePaletteShortcut(open: () => void) {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      open();
    }
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));
}
