import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { courseLabel } from "../engine";
import { rows } from "../state/store";
import { VIEWS, setView } from "../state/nav";
import type { View } from "../state/nav";
import { askConfigured, askRemote } from "../state/ask";
import { ASSISTANT, answerFor, defineFor, detectTopic } from "../state/answers";
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
  kind: "view" | "subject";
  label: string;
  /** The line under the label. Engine-computed for subjects. */
  detail: string;
  go: () => void;
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
function matches(haystack: string, needle: string, loose = true): boolean {
  if (!needle) return true;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  // Initials, which work in a sentence because they cannot over-match: the
  // initials of "Computer Networks" are exactly "cn" and nothing else. Losing
  // this was the cost of the fix above - "what do i need to pass cn" is four
  // terms, so the loose path is closed and "cn" stopped resolving. This gives
  // it back without giving back "one" matching Computer Networks.
  if (n.length >= 2 && initials(h) === n) return true;
  if (!loose) return false;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i += 1;
    if (i === n.length) return true;
  }
  return false;
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
    const named = words.length === 0 ? undefined : rows().find((r) =>
      words.some((w) => matches(courseLabel(r.course), w, loose)
                     || matches(r.course.code ?? "", w, loose)));
    return answerFor(topic, named?.course.code);
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

    for (const row of rows()) {
      const label = courseLabel(row.course);
      if (!anyTerm(label) && !anyTerm(row.course.code ?? "")) continue;
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
      out.push({
        kind: "subject", label, detail,
        go: () => setView("ledger"),
      });
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
      if (a.kind === "view") { setView(a.view); props.onClose(); return; }
      if (a.kind === "subject") {
        const hit = rows().find((r) => r.course.code === a.code);
        if (hit) { setView(a.view); props.onClose(); return; }
        setRemote("That subject is not in this semester.");
        return;
      }
      setRemote(
        a.reason === "off_topic"
          ? "That one is outside what TargetX knows about."
          : a.reason === "no_match"
            ? "Nothing in your record matches that."
            : "Not sure what that is asking. Try naming the subject.",
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
      const hit = list[cursor()];
      // The engine's answer wins whenever it has one. Enter only leaves the
      // machine when there is nothing here to press.
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
                  {said().isDefinition ? `${ASSISTANT} · from the KTU regulations`
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

          <Show when={hits().length > 0} fallback={
            // An untouched box says nothing at all. "Nothing matches" is a
            // verdict on a search, and no search has happened yet - the
            // placeholder in the field is already the whole instruction.
            <Show when={query().trim() !== ""}>
              <div class="palette-empty">
                <Show when={remote()} fallback={
                  <>
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
                  </>
                }>
                  {(said) => <p>{said()}</p>}
                </Show>
              </div>
            </Show>
          }>
            <ul class="palette-list" role="listbox" aria-label="Results">
              <For each={hits()}>{(hit, i) => (
                <li>
                  <button class="palette-hit" role="option"
                          aria-selected={i() === cursor()}
                          onMouseEnter={() => setCursor(i())}
                          onClick={() => run(hit)}>
                    <span class="palette-kind">{hit.kind === "view" ? "View" : "Subject"}</span>
                    <span class="palette-label">{hit.label}</span>
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
