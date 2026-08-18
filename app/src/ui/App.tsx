import { For, Show, createSignal } from "solid-js";
import {
  activeCourses, addSemester, goalRequirement, overall, selectSemester,
  semesterNames, setGoal, state, summary,
} from "../state/store";
import { VIEWS, needsSetup, setView, view } from "../state/nav";
import { Data } from "./Data";
import { Drawer } from "./Drawer";
import { History } from "./History";
import { Home } from "./Home";
import { Ledger } from "./Ledger";
import { Setup } from "./Setup";

/**
 * Header KPIs.
 *
 * Confirmed and projected sit side by side and are never merged. One blended
 * number would be the most flattering thing to show and the least honest — the
 * student could not tell which half is real.
 */
function Kpis() {
  // With nothing entered every rollup is 0.00, which reads as a student who
  // scored zero rather than one who has not started. Dashes say the second
  // thing, which is this app's whole discipline applied to its own header.
  const started = () => summary().credits > 0 || overall().credits > 0;
  const dash = "–";

  return (
    <Show when={started()} fallback={
      <div class="kpis">
        <div class="kpi">
          <span class="kpi-label">CGPA</span>
          <span class="kpi-value num dim">{dash}</span>
          <span class="kpi-note">nothing recorded yet</span>
        </div>
      </div>
    }>
      <div class="kpis">
        <div class="kpi">
          <span class="kpi-label">CGPA</span>
          <span class="kpi-value num">{overall().cgpa.toFixed(2)}</span>
          <span class="kpi-note num">{overall().percent.toFixed(1)}% · {overall().credits} cr</span>
        </div>
        <Show when={view() === "ledger"}>
        <div class="kpi">
          <span class="kpi-label">Confirmed</span>
          <span class="kpi-value num dim">{summary().sgpaConfirmed.toFixed(2)}</span>
          <span class="kpi-note num">{summary().creditsConfirmed} of {summary().credits} cr</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Projected</span>
          <span class="kpi-value num">{summary().sgpaProjected.toFixed(2)}</span>
          <span class="kpi-note">
            <Show when={summary().pending > 0} fallback={<>all subjects assessed</>}>
              {summary().pending} not yet assessed
            </Show>
          </span>
        </div>
        </Show>
      </div>
    </Show>
  );
}

/**
 * The goal line.
 *
 * The question the app exists to answer, so it gets a permanent row rather than
 * a settings dialog: "I want an 8. What does this semester have to do?"
 */
function GoalBar() {
  const [draft, setDraft] = createSignal(
    state.goal?.cgpa != null ? String(state.goal.cgpa) : "");

  const commit = (raw: string) => {
    setDraft(raw);
    const value = Number(raw.trim());
    setGoal(raw.trim() === "" || !Number.isFinite(value) ? null : value);
  };

  const need = () => goalRequirement();
  const risky = () => {
    const n = need();
    return !!n && (!n.possible || (n.required ?? 0) > summary().sgpaProjected + 0.005);
  };

  return (
    <div class="goalbar">
      <label for="goal">Target CGPA</label>
      <input id="goal" class="goal-input num" value={draft()} placeholder="8.0"
             onInput={(e) => commit(e.currentTarget.value)} />

      <Show when={need()} fallback={
        <span class="verdict" style={{ color: "var(--text-faint)" }}>
          Set one and every number below re-reads as a route to it.
        </span>
      }>
        {(n) => (
          <p class={`verdict${risky() ? " bad" : ""}`} style={{ margin: 0 }}>
            <Show when={n().possible} fallback={<>Out of reach — {n().reason}.</>}>
              <Show when={n().slack} fallback={
                <>
                  {state.activeSemester} must deliver <strong>{n().required!.toFixed(2)}</strong>
                  {" "}SGPA. You are projecting{" "}
                  <strong>{summary().sgpaProjected.toFixed(2)}</strong>
                  <Show when={risky()}> — short by{" "}
                    {(n().required! - summary().sgpaProjected).toFixed(2)}
                  </Show>.
                </>
              }>
                Already secured by your past semesters — anything above a pass holds it.
              </Show>
            </Show>
          </p>
        )}
      </Show>

      <Show when={summary().lowAttendance.length > 0}>
        <span class="pill shortage" style={{ "margin-left": "auto" }}>
          {summary().lowAttendance.length} short on attendance
        </span>
      </Show>
      <Show when={summary().impossible.length > 0}>
        <span class="pill unreachable">{summary().impossible.length} unreachable</span>
      </Show>
    </div>
  );
}

export function App() {
  const [setupOpen, setSetupOpen] = createSignal(needsSetup());

  return (
    <Show when={!setupOpen()} fallback={<Setup onDone={() => setSetupOpen(false)} />}>
      <div class="app" classList={{ wide: view() !== "ledger" }}>
        <header class="head">
          <h1 class="wordmark">Target<span>X</span></h1>

          <nav class="tabs" aria-label="Views">
            <For each={VIEWS}>{(v) => (
              <button class="tab" aria-current={view() === v.id} title={v.hint}
                      onClick={() => setView(v.id)}>{v.label}</button>
            )}</For>
          </nav>

          <Show when={view() === "ledger"}>
            <nav class="sems" aria-label="Semester">
              <For each={semesterNames()}>{(name) => (
                <button class="sem" aria-current={state.activeSemester === name}
                        onClick={() => selectSemester(name)}>{name}</button>
              )}</For>
              <button class="sem" title="Add the next semester" onClick={addSemester}>+</button>
            </nav>
            <span class="kpi-note num" style={{ color: "var(--text-faint)" }}>
              {activeCourses().length} subjects
            </span>
          </Show>

          <Kpis />
        </header>

        <Show when={view() === "ledger"}>
          <GoalBar />
          <Ledger />
          <Drawer />
        </Show>
        <Show when={view() === "home"}><Home /></Show>
        <Show when={view() === "history"}><History /></Show>
        <Show when={view() === "data"}><Data /></Show>
      </div>
    </Show>
  );
}
