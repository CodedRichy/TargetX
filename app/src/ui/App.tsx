import { For, Show, createSignal, onMount } from "solid-js";
import {
  activeCourses, addSemester, attendanceGaps, goalRequirement, overall,
  selectSemester, semesterNames, setAttendanceTarget, setGoal, state, summary,
  targets,
} from "../state/store";
import { VIEWS, needsSetup, setView, view } from "../state/nav";
import { appearance, setTheme, startTheme, theme } from "../state/theme";
import { Data } from "./Data";
import { Drawer } from "./Drawer";
import { History } from "./History";
import { Home } from "./Home";
import { Ledger } from "./Ledger";
import { Setup } from "./Setup";
import { Mark } from "./Mark";
import { runLaunchCheck } from "../state/launch";
import type { Finding } from "../state/launch";

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
            <Show when={summary().pending > 0 || summary().unsettled > 0}
                  fallback={<>all subjects assessed</>}>
              {[
                summary().pending > 0 ? `${summary().pending} not yet assessed` : null,
                summary().unsettled > 0
                  ? `${summary().unsettled} internal${summary().unsettled === 1 ? "" : "s"} not settled`
                  : null,
              ].filter(Boolean).join(" · ")}
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
export function GoalBar() {
  const [draft, setDraft] = createSignal(
    state.goal?.cgpa != null ? String(state.goal.cgpa) : "");
  const [attDraft, setAttDraft] = createSignal(
    targets().attendance === null ? "" : String(targets().attendance));

  const commit = (raw: string) => {
    setDraft(raw);
    const value = Number(raw.trim());
    setGoal(raw.trim() === "" || !Number.isFinite(value) ? null : value);
  };

  const commitAtt = (raw: string) => {
    setAttDraft(raw);
    const value = Number(raw.trim());
    setAttendanceTarget(raw.trim() === "" || !Number.isFinite(value) ? null : value);
  };

  /**
   * Subjects under the student's OWN attendance target.
   *
   * Deliberately a second count beside the shortage pill and never folded into
   * it. That one reports a regulation breach - below 75%, not eligible - and
   * this one reports a personal aim being missed. A subject at 80% is on this
   * list and not on that one, which is the whole point: nothing else in KTU
   * tells a student that 80% is already costing them CIE marks.
   */
  const belowTarget = () => attendanceGaps()
    .filter((g) => g.toTarget !== null && g.toTarget.state === "deficit").length;

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

      <label for="att-target">Target attendance</label>
      <input id="att-target" class="goal-input num" value={attDraft()} placeholder="85"
             title="Your own attendance target. Why 85 and not 75 is on the Targets tab."
             onInput={(e) => commitAtt(e.currentTarget.value)} />

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

      <Show when={belowTarget() > 0}>
        <span class="pill mine" style={{ "margin-left": "auto" }}
              title="Your own target, not the regulation. See the Targets tab.">
          {belowTarget()} below your {targets().attendance!.toFixed(0)}% target
        </span>
      </Show>
      <Show when={summary().lowAttendance.length > 0}>
        <span class="pill shortage"
              style={belowTarget() > 0 ? {} : { "margin-left": "auto" }}
              title="Below the 75% eligibility rule (R 6.2). A different list.">
          {summary().lowAttendance.length} short of 75%
        </span>
      </Show>
      <Show when={summary().impossible.length > 0}>
        <span class="pill unreachable">{summary().impossible.length} unreachable</span>
      </Show>
    </div>
  );
}

/**
 * Appearance control.
 *
 * A single cycling button rather than three radios in a settings screen. It
 * is a preference people flip by daylight, so it belongs where it is used -
 * and cycling keeps it to one hit target in a header that is already full.
 */
function ThemeButton() {
  const next = () => (theme() === "system"
    ? (appearance() === "dark" ? "light" : "dark")
    : theme() === "dark" ? "light" : "system");

  const label = () => (theme() === "system" ? "Auto"
    : theme() === "dark" ? "Dark" : "Light");

  return (
    <button class="tab theme-toggle" onClick={() => setTheme(next())}
            title={`Appearance: ${label()} — click for ${next() === "system" ? "auto" : next()}`}>
      {label()}
    </button>
  );
}

/**
 * What the launch check found.
 *
 * Sits above everything on the first screen and is dismissible, because a
 * banner that cannot be closed is one the student learns to read past. The
 * findings are re-derived on every open, so dismissing is for this session
 * only - a credit that still does not reconcile tomorrow says so again.
 */
function LaunchNotice(props: { findings: Finding[]; onDismiss: () => void }) {
  return (
    <Show when={props.findings.length > 0}>
      <div class="launch-notice">
        <For each={props.findings}>{(f) => (
          <div class={`notice ${f.severity === "warn" ? "warn" : ""}`} title={f.detail}>
            <strong>{f.title}</strong>
            <button class="link" onClick={() => { setView(f.goto); props.onDismiss(); }}>
              {f.action}
            </button>
          </div>
        )}</For>
        <button class="link" onClick={props.onDismiss}>Dismiss</button>
      </div>
    </Show>
  );
}

export function App() {
  const [setupOpen, setSetupOpen] = createSignal(needsSetup());
  startTheme();

  // The check itself is arithmetic over data already in memory and finishes in
  // single-digit milliseconds. The floor exists so the result is readable
  // rather than a flash - and so a slow machine looks identical to a fast one.
  // boot: the overlay is opaque and the check is running.
  // flying: the X is travelling to its place in the wordmark.
  // done: the overlay is gone.
  const [phase, setPhase] = createSignal<"boot" | "flying" | "done">("boot");
  let wordmarkX: HTMLSpanElement | undefined;
  let flyer: HTMLDivElement | undefined;
  const [findings, setFindings] = createSignal<Finding[]>([]);
  const [dismissed, setDismissed] = createSignal(false);

  onMount(() => {
    const started = Date.now();
    let found: Finding[] = [];
    try {
      found = runLaunchCheck();
    } catch (exc) {
      // A check that throws must not take the app down with it - the data it
      // was auditing is still there and still openable.
      found = [{
        kind: "corrupt", severity: "warn",
        title: "Your saved data could not be checked",
        detail: `TargetX opened but could not audit what it holds: ${String(exc)}`,
        goto: "data", action: "Open Data",
      }];
    }
    const wait = Math.max(0, 450 - (Date.now() - started));
    setTimeout(() => {
      setFindings(found);
      setPhase("flying");
      // The wordmark has to be laid out before it can be measured, and the
      // overlay has to have painted before it can be animated away from.
      requestAnimationFrame(() => requestAnimationFrame(flyMark));
    }, wait);
  });

  /**
   * Fly the opening X into the wordmark.
   *
   * The same drawing in both places, moved rather than swapped: the app does
   * not cut from a splash to a dashboard, it puts its mark where it lives.
   *
   * Measured at the moment it runs rather than hardcoded, because the
   * wordmark's position depends on the window width and on whether setup is
   * showing at all. If there is nothing to fly to - setup is open, or the
   * header has not rendered - it fades instead, which is also what a student
   * who has asked for reduced motion gets.
   */
  const flyMark = () => {
    const node = flyer;
    const target = wordmarkX?.getBoundingClientRect();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!node || !target || target.width < 1 || reduced) {
      setTimeout(() => setPhase("done"), reduced ? 0 : 260);
      return;
    }

    const from = node.getBoundingClientRect();
    const scale = target.width / from.width;
    const dx = (target.left + target.width / 2) - (from.left + from.width / 2);
    const dy = (target.top + target.height / 2) - (from.top + from.height / 2);

    const flight = node.animate([
      { transform: "translate(0px, 0px) scale(1) rotate(0deg)" },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(360deg)` },
    ], {
      duration: 760,
      // Slow to leave, quick to arrive: it should look like it lands rather
      // than like it drifts.
      easing: "cubic-bezier(0.7, 0, 0.15, 1)",
      fill: "forwards",
    });
    flight.finished.then(() => setPhase("done")).catch(() => setPhase("done"));
  };

  return (
    <>
    <Show when={phase() !== "done"}>
      <div class="boot" classList={{ leaving: phase() === "flying" }} aria-hidden="true">
        <div class="boot-veil" />
        <div class="boot-flyer" ref={flyer}><Mark size="88" /></div>
        <Show when={phase() === "boot"}>
          <p class="splash-note">Checking your saved data</p>
        </Show>
      </div>
    </Show>

    <Show when={!setupOpen()} fallback={<Setup onDone={() => setSetupOpen(false)} />}>
      <div class="app" classList={{ wide: view() !== "ledger" }}>
        <header class="head">
          <h1 class="wordmark">Target<span class="wordmark-x" ref={wordmarkX}
              classList={{ waiting: phase() !== "done" }}><Mark size="0.78em" /></span></h1>

          <nav class="tabs" aria-label="Views">
            <For each={VIEWS}>{(v) => (
              <button class="tab" aria-current={view() === v.id} title={v.hint}
                      onClick={() => setView(v.id)}>{v.label}</button>
            )}</For>
            <ThemeButton />
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
        <Show when={!dismissed()}>
          <LaunchNotice findings={findings()} onDismiss={() => setDismissed(true)} />
        </Show>

        <Show when={view() === "home"}><Home /></Show>
        <Show when={view() === "history"}><History /></Show>
        <Show when={view() === "data"}><Data /></Show>
      </div>
    </Show>
    </>
  );
}
