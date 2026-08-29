import { For, Show, createMemo, createSignal } from "solid-js";
import { branches, presetCourses, semesterKeys } from "../engine";
import type { PresetCourse } from "../engine";
import { applyPreset } from "../state/actions";
import { edit, setGoal, state } from "../state/store";
import { SyncPanel } from "./SyncPanel";

/**
 * First-run setup.
 *
 * The old build dropped a new user into an empty 14-column table, which is a
 * wall, not an app. Three steps, each answering one question, and the second
 * one is the whole game: how does your data get in here.
 *
 * Every step is skippable. A student who wants to type it all in by hand should
 * not be held hostage by a wizard, and one who abandons setup halfway should
 * land in a usable app rather than a broken one.
 */

type Stage = "welcome" | "data" | "goal";

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "welcome", label: "Start" },
  { id: "data", label: "Your subjects" },
  { id: "goal", label: "Your goal" },
];

export function Setup(props: { onDone: () => void }) {
  const [stage, setStage] = createSignal<Stage>("welcome");
  const index = () => STAGES.findIndex((s) => s.id === stage());

  const finish = () => {
    edit((s) => { s.onboarded = true; });
    props.onDone();
  };

  return (
    <div class="setup">
      <div class="setup-frame">
        <header class="setup-head">
          <h1 class="wordmark">Target<span>X</span></h1>
          <ol class="steps">
            <For each={STAGES}>{(s, i) => (
              <li classList={{ now: stage() === s.id, past: i() < index() }}>
                <span class="num">{i() + 1}</span> {s.label}
              </li>
            )}</For>
          </ol>
          <button class="link" onClick={finish}>Skip setup</button>
        </header>

        <Show when={stage() === "welcome"}>
          <Welcome onNext={() => setStage("data")} />
        </Show>
        <Show when={stage() === "data"}>
          <DataStep onBack={() => setStage("welcome")} onNext={() => setStage("goal")} />
        </Show>
        <Show when={stage() === "goal"}>
          <GoalStep onBack={() => setStage("data")} onDone={finish} />
        </Show>
      </div>
    </div>
  );
}

// --- step 1 ----------------------------------------------------------------

function Welcome(props: { onNext: () => void }) {
  return (
    <section class="setup-body">
      <p class="eyebrow">KTU 2024 scheme</p>
      <h2>Every other calculator tells you what you already scored.</h2>
      <p class="lede">
        TargetX tells you the mark you still need — per subject, as you type. It
        also does the thing no KTU tool does: attendance is worth up to 5 CIE
        marks under Regulations 2024, so sitting at 76% is not "fine", it is two
        marks already gone.
      </p>

      <ul class="claims">
        <li>
          <strong>What you need in the exam</strong>
          Both pass conditions, including the separate 40% ESE minimum that
          spreadsheets ignore.
        </li>
        <li>
          <strong>How many classes you can miss</strong>
          From real attended/held counts, with duty leave capped at 10% the way
          the regulations actually cap it.
        </li>
        <li>
          <strong>The cheapest route to your CGPA</strong>
          Which subject to push and how far, balanced so the plan is one a
          person can attempt.
        </li>
      </ul>

      <div class="setup-actions">
        <button class="primary" onClick={props.onNext}>Get started</button>
        <span class="fineprint">
          Everything stays on this computer. No account, no server.
        </span>
      </div>
    </section>
  );
}

// --- step 2 ----------------------------------------------------------------

type Route = null | "sync" | "preset" | "manual";

function DataStep(props: { onBack: () => void; onNext: () => void }) {
  const [route, setRoute] = createSignal<Route>(null);

  return (
    <section class="setup-body">
      <Show when={route() === null} fallback={
        <>
          <button class="link back" onClick={() => setRoute(null)}>← Other ways to start</button>
          <Show when={route() === "sync"}>
            <SyncPanel onDone={props.onNext} />
          </Show>
          <Show when={route() === "preset"}>
            <PresetPicker onDone={props.onNext} />
          </Show>
        </>
      }>
        <h2>How should your subjects get in?</h2>
        <p class="lede">
          You can change this later, and mix them — sync now, correct by hand
          afterwards.
        </p>

        <div class="routes">
          <button class="route" onClick={() => setRoute("sync")}>
            <span class="route-tag">Recommended</span>
            <strong>Sign in to your college portal</strong>
            <span>
              Pulls every semester, attendance, series marks, grades and
              published SGPA from etlab in one go. Your password is used once
              and never stored.
            </span>
          </button>

          <button class="route" onClick={() => setRoute("preset")}>
            <strong>Pick from the KTU curriculum</strong>
            <span>
              Choose your branch and semester and tick the subjects you
              registered. Credits and mark patterns come from the published
              curriculum, so they are right from the start.
            </span>
          </button>

          <button class="route" onClick={() => { props.onNext(); }}>
            <strong>Start empty</strong>
            <span>Add subjects one at a time. Nothing is filled in for you.</span>
          </button>
        </div>
      </Show>
    </section>
  );
}

/**
 * Branch preset picker.
 *
 * The curriculum tables list every elective on offer - S7 CSE has 24 entries
 * for a seven-course semester - so this is a pick list. Core subjects arrive
 * ticked, electives do not, because seeding an elective nobody registered puts
 * phantom credits into SGPA.
 */
function PresetPicker(props: { onDone: () => void }) {
  const available = branches();
  const [branch, setBranch] = createSignal(state.student.branch || available[0] || "CSE");
  const [semester, setSemester] = createSignal(state.activeSemester || "S1");

  const options = createMemo(() => presetCourses(branch(), semester()));
  const [picked, setPicked] = createSignal<Set<string>>(new Set());

  // Re-tick the core subjects whenever the branch or semester changes.
  createMemo(() => {
    const core = options().filter((c) => !c.elective).map((c) => c.code);
    setPicked(new Set(core));
  });

  const toggle = (code: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (!next.delete(code)) next.add(code);
    return next;
  });

  const chosen = (): PresetCourse[] => options().filter((c) => picked().has(c.code));
  const credits = () => chosen().reduce((sum, c) => sum + c.credits, 0);

  return (
    <>
      <h2>Which subjects are yours?</h2>
      <div class="picker-controls">
        <label>
          Branch
          <select class="field-input" value={branch()}
                  onChange={(e) => setBranch(e.currentTarget.value)}>
            <For each={available}>{(b) => <option value={b}>{b}</option>}</For>
          </select>
        </label>
        <label>
          Semester
          <select class="field-input" value={semester()}
                  onChange={(e) => setSemester(e.currentTarget.value)}>
            <For each={semesterKeys(branch())}>{(s) => <option value={s}>{s}</option>}</For>
          </select>
        </label>
        <span class="fineprint num">{chosen().length} subjects · {credits()} credits</span>
      </div>

      <Show when={options().length > 0} fallback={
        <p class="lede">No curriculum on file for {branch()} {semester()} yet.</p>
      }>
        <ul class="picks">
          <For each={options()}>{(course) => (
            <li classList={{ on: picked().has(course.code) }}
                onClick={() => toggle(course.code)}>
              {/* The row is a `li` with a click handler, which the keyboard
                  cannot reach; the checkbox is the only real control in it and
                  it had no name, so the whole list read as unlabelled tick
                  boxes. Named for the subject it selects. */}
              <input type="checkbox" checked={picked().has(course.code)}
                     aria-label={`${course.code} ${course.name}`}
                     onClick={(e) => { e.stopPropagation(); toggle(course.code); }} />
              <span class="num code">{course.code}</span>
              <span class="pick-name">{course.name}</span>
              <Show when={course.elective}><span class="tag">elective</span></Show>
              <span class="num pick-cr">{course.credits} cr</span>
            </li>
          )}</For>
        </ul>
      </Show>

      <div class="setup-actions">
        <button class="primary" disabled={chosen().length === 0}
                onClick={() => { applyPreset(semester(), chosen()); props.onDone(); }}>
          Add {chosen().length} subjects
        </button>
      </div>
    </>
  );
}

// --- step 3 ----------------------------------------------------------------

function GoalStep(props: { onBack: () => void; onDone: () => void }) {
  const [draft, setDraft] = createSignal(
    state.goal?.cgpa != null ? String(state.goal.cgpa) : "");

  const commit = () => {
    const value = Number(draft().trim());
    setGoal(draft().trim() === "" || !Number.isFinite(value) ? null : value);
    props.onDone();
  };

  return (
    <section class="setup-body narrow">
      <h2>What are you aiming for?</h2>
      <p class="lede">
        Give TargetX a target CGPA and every number in the app re-reads as a
        route to it: what this semester has to deliver, and which subject is
        cheapest to push. You can change it any time, or leave it blank.
      </p>

      <div class="goal-big">
        <input class="goal-huge num" value={draft()} placeholder="8.0" inputmode="decimal"
               aria-label="Target CGPA"
               onInput={(e) => setDraft(e.currentTarget.value)}
               onKeyDown={(e) => e.key === "Enter" && commit()} />
        <span class="fineprint">Target CGPA · 10-point scale</span>
      </div>

      <div class="chips">
        <For each={["7.0", "7.5", "8.0", "8.5", "9.0"]}>{(value) => (
          <button class="chip" onClick={() => setDraft(value)}>{value}</button>
        )}</For>
      </div>

      <div class="setup-actions">
        <button class="link" onClick={props.onBack}>Back</button>
        <button class="primary" onClick={commit}>Finish</button>
      </div>
    </section>
  );
}
