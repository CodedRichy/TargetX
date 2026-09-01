import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import {
  activeCourses, addSemester, attendanceGaps, goalRequirement, hydrate, overall,
  selectSemester, semesterNames, setAttendanceTarget, setGoal, state, summary,
  targets,
} from "../state/store";
import { VIEWS, needsSetup, setView, view } from "../state/nav";
import { appearance, setTheme, startTheme, theme } from "../state/theme";
import { Data } from "./Data";
import { WindowChrome } from "./WindowChrome";
import { Drawer } from "./Drawer";
import { Attendance } from "./Attendance";
import { History } from "./History";
import { Home } from "./Home";
import { Ledger } from "./Ledger";
import { Setup } from "./Setup";
import { Mark } from "./Mark";
import { Palette, usePaletteShortcut } from "./Palette";
import { runLaunchCheck, saveFindings } from "../state/launch";
import type { Finding } from "../state/launch";
import { checkForUpdate } from "../sync/update";
import type { Available } from "../sync/update";

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
  // Red is for a target that cannot be met, not for a form that has not been
  // filled in. `insufficient` is the second thing `possible: false` used to
  // carry, and it is now the one case that stays neutral.
  const risky = () => {
    const n = need();
    if (!n || n.insufficient) return false;
    return !n.possible || (n.required ?? 0) > summary().sgpaProjected + 0.005;
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
            <Show when={n().possible} fallback={
              <Show when={n().insufficient}
                    fallback={<>Out of reach — {n().reason}.</>}>
                Add this semester's subjects and this becomes a route.
              </Show>
            }>
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
/**
 * A newer build exists.
 *
 * Separate from `LaunchNotice` on purpose: that one reports on the student's
 * own data and is re-derived every launch, while this reports on the software
 * and is answered once. Same visual weight, because neither outranks the
 * other - and deliberately not a modal, since an update is never the reason
 * someone opened the app.
 *
 * Dismissing is for this session only. The next launch asks again, which is
 * correct: a build carrying a marks fix should keep asking.
 */
export function UpdateNotice(props: { update: Available; onDismiss: () => void }) {
  const [installing, setInstalling] = createSignal(false);
  const [failed, setFailed] = createSignal<string | null>(null);
  /** [0, 1] once the size is known, null while it is not. */
  const [progress, setProgress] = createSignal<number | null>(null);

  const install = async () => {
    setInstalling(true);
    setFailed(null);
    setProgress(null);
    try {
      await props.update.install(setProgress);
      // Reached only if the relaunch did not happen; on success the process
      // is already gone.
      setInstalling(false);
    } catch (exc) {
      // A failure the student ASKED for is worth showing - unlike the silent
      // check that found the update in the first place.
      setInstalling(false);
      setFailed(String(exc));
    }
  };

  return (
    // `role="status"` (polite, atomic) rather than `alert`: an update is
    // never why anyone opened the app, so it waits for a pause rather than
    // cutting across what is being read.
    <div class="launch-notice" role="status">
      <div class="notice" title={props.update.notes ?? undefined}>
        <strong>TargetX {props.update.version} is available</strong>
        <Show when={!installing()} fallback={
          /* Inside a polite atomic region, so the percentage text would be
             re-read on every tick of the download - a live region that talks
             over itself is worse than none. The figure is marked as a
             progressbar instead: assistive technology reports it when asked
             and does not announce each change. */
          <span class="update-progress" title="Downloading the new build"
                role="progressbar" aria-label="Downloading the new build"
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={progress() === null
                  ? undefined : Math.round((progress() ?? 0) * 100)}>
            <span class="update-track" aria-hidden="true">
              <span
                class="update-bar"
                classList={{ indeterminate: progress() === null }}
                style={progress() === null
                  ? undefined
                  : { transform: `scaleX(${progress()})` }}
              />
            </span>
            <span class="dim num" aria-hidden="true">
              {progress() === null
                ? "Downloading…"
                : `${Math.round((progress() ?? 0) * 100)}%`}
            </span>
          </span>
        }>
          <button class="link primary" onClick={install}>Install and restart</button>
        </Show>
        {/* Inside the notice, not beside it. `.launch-notice` stretches its
            children so several findings share a row, which pushed a lone
            dismiss button to the far edge of a 1280px window - a long trip
            from the action it belongs with, and reading as unrelated to it. */}
        <Show when={!installing()}>
          <button class="link" onClick={props.onDismiss}>Not now</button>
        </Show>
      </div>
      <Show when={failed()}>
        {(why) => (
          <div class="notice warn" title={why()}>
            <strong>That update could not be installed</strong>
          </div>
        )}
      </Show>
    </div>
  );
}

/**
 * A save that is not landing.
 *
 * Has no dismiss of its own, and stays a banner rather than moving into the
 * notification bell, on purpose.
 * Everything in that banner reports on something already written down, so
 * closing it costs nothing; this reports that what is on the screen is NOT
 * being written down, and the student needs it in front of them until they
 * have exported a copy. It takes itself away the moment a save succeeds.
 */
export function SaveNotice() {
  return (
    <Show when={saveFindings().length > 0}>
      {/* The one banner that reports the app is NOT holding on to what is on
          screen, so it is announced the moment it appears. Polite rather than
          assertive all the same: it is raised by a save the student did not
          ask for, and cutting across their typing to say so would lose them
          the keystroke as well as the save. */}
      <div class="launch-notice" role="status">
        <For each={saveFindings()}>{(f) => (
          <div class={`notice ${f.severity === "warn" ? "warn" : ""}`} title={f.detail}>
            <strong>{f.title}</strong>
            <button class="link" onClick={() => setView(f.goto)}>{f.action}</button>
          </div>
        )}</For>
      </div>
    </Show>
  );
}

/**
 * Everything asking for your attention, in one place.
 *
 * These findings used to be a banner across the top of the app. The banner was
 * honest and it was also the first thing between a student and their marks on
 * every single launch, saying the same thing every time until it was dismissed.
 * A count on a bell states the same fact without spending a row of the screen
 * on it, and the two urgent classes stay where they were: a save that is not
 * landing keeps its banner, because that one reports the app is losing data,
 * and Home keeps its "Needs attention" card, because that is a place a student
 * goes to look rather than a thing that interrupts them.
 */
function Bell(props: { findings: Finding[]; onGo: () => void }) {
  const [open, setOpen] = createSignal(false);
  const count = () => props.findings.length;
  let wrap: HTMLDivElement | undefined;

  /*
   * Close when the click lands outside, decided by geometry rather than by
   * propagation.
   *
   * The propagation version did not work and could not: Solid delegates every
   * `onClick` to `document`, and this listener is on `document` too.
   * `stopPropagation` does not stop other listeners already bound to the SAME
   * node - only `stopImmediatePropagation` does, and only for handlers
   * registered after it. So the button's own toggle opened the popover and
   * this handler closed it again in the same click, and the bell looked dead.
   *
   * Asking whether the click was inside the wrapper is independent of both
   * listener order and the framework's delegation strategy.
   */
  const onDocClick = (e: MouseEvent) => {
    if (wrap && e.target instanceof Node && wrap.contains(e.target)) return;
    setOpen(false);
  };
  onMount(() => document.addEventListener("click", onDocClick));
  onCleanup(() => document.removeEventListener("click", onDocClick));

  return (
    <div class="pop-wrap" ref={wrap}>
      <button class="bell" onClick={() => setOpen((o) => !o)}
              aria-expanded={open()}
              aria-label={count() === 0
                ? "Notifications. Nothing needs attention."
                : `Notifications. ${count()} need attention.`}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"
             stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
             stroke-linejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        <Show when={count() > 0}>
          <span class="bell-badge num" aria-hidden="true">{count()}</span>
        </Show>
      </button>

      <Show when={open()}>
        <div class="pop" role="dialog" aria-label="Notifications">
          <p class="pop-title">Needs attention</p>
          <Show when={count() > 0} fallback={
            <p class="pop-empty">Nothing to look at. Your data reconciled.</p>
          }>
            <For each={props.findings}>{(f) => (
              <div class="pop-item">
                <strong>{f.title}</strong>
                <span class="dim">{f.detail}</span>
                <button class="link" onClick={() => {
                  setView(f.goto); setOpen(false); props.onGo();
                }}>{f.action}</button>
              </div>
            )}</For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * Account.
 *
 * The CGPA lives here rather than in its own header block: it is the one number
 * that describes the student rather than a semester, and reading it beside
 * their name is where the eye already goes.
 *
 * Sign-in is NOT wired yet. The button says so in plain words instead of
 * opening a dialog that cannot finish, because an account control that fails
 * silently is worse than one that is honest about not existing. Nothing in the
 * app requires an account today - every figure on every screen is computed on
 * this machine from data this machine fetched.
 */
function Profile() {
  const [open, setOpen] = createSignal(false);
  const cgpa = () => (overall().credits > 0 ? overall().cgpa.toFixed(2) : null);
  let wrap: HTMLDivElement | undefined;

  /* Same containment test as the bell - see the note there for why this is not
     done with stopPropagation. */
  const onDocClick = (e: MouseEvent) => {
    if (wrap && e.target instanceof Node && wrap.contains(e.target)) return;
    setOpen(false);
  };
  onMount(() => document.addEventListener("click", onDocClick));
  onCleanup(() => document.removeEventListener("click", onDocClick));

  return (
    <div class="pop-wrap" ref={wrap}>
      <button class="profile" onClick={() => setOpen((o) => !o)}
              aria-expanded={open()} aria-label="Account">
        <span class="avatar" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <circle cx="12" cy="8" r="3.6" />
            <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
          </svg>
        </span>
        <span class="profile-lines">
          <span class="profile-name">{state.activeSemester ?? "Student"}</span>
          <span class="profile-sub">
            {cgpa() === null ? "no CGPA yet" : `CGPA ${cgpa()}`}
          </span>
        </span>
      </button>

      <Show when={open()}>
        <div class="pop" role="dialog" aria-label="Account">
          <div class="pop-row">
            <span>Appearance</span>
            <ThemeButton />
          </div>
          <div class="pop-row">
            <span>
              <strong>Not signed in</strong>
              <br />
              <span class="dim">Sign-in is not built yet. Everything you see is
              computed on this machine.</span>
            </span>
          </div>
          <div class="pop-row">
            <span class="dim">Data</span>
            <button class="link" onClick={() => { setOpen(false); setView("data"); }}>
              Sync, import and backup
            </button>
          </div>
        </div>
      </Show>
    </div>
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
  let homeBtn: HTMLButtonElement | undefined;
  let flyer: HTMLDivElement | undefined;
  const [findings, setFindings] = createSignal<Finding[]>([]);
  const [dismissed, setDismissed] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  usePaletteShortcut(() => setPaletteOpen(true));
  const [update, setUpdate] = createSignal<Available | null>(null);
  const [updateDismissed, setUpdateDismissed] = createSignal(false);

  // Pointer-tracked light, wired once for the whole app.
  //
  // A single delegated `pointermove` on the document writes --mx/--my onto
  // whichever card-like surface the cursor is inside, and every such surface's
  // `::before` (motion.css) draws the glow from those two variables. One
  // listener rather than one per screen: a card that appears anywhere - Home's
  // tiles, the Data and Attendance cards, the ledger detail panels, the route
  // analytics panels - is lit without its component knowing this exists.
  //
  // Its own `onMount`, kept synchronous, so `onCleanup` registers against the
  // component's owner (the launch-check `onMount` below is async, and a cleanup
  // queued after its first `await` would have no owner to attach to). Skipped
  // wholesale under reduced motion - the CSS already drops the `::before`, and
  // there is no reason to run the maths for a glow that will never paint.
  onMount(() => {
    if (typeof document === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // The app's whole card vocabulary. Mirrors the `::before` selector list in
    // motion.css - the two must name the same surfaces or a card lights with no
    // handler feeding it, or a handler writes variables nothing draws.
    const SURFACES = ".tile, .card, .panel, .route-panel";

    const spotlight = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const surface = target.closest(SURFACES) as HTMLElement | null;
      if (!surface) return;
      const r = surface.getBoundingClientRect();
      surface.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      surface.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    };

    document.addEventListener("pointermove", spotlight, { passive: true });
    onCleanup(() => document.removeEventListener("pointermove", spotlight));
  });

  onMount(async () => {
    const started = Date.now();
    // Before the check, not after: `runLaunchCheck` audits what the app is
    // holding, and until this resolves what it is holding is the localStorage
    // seed rather than the record on disk. Auditing the seed would report on a
    // copy the student is not about to be shown.
    try {
      await hydrate();
    } catch { /* `hydrate` reports its own faults through the save banner */ }
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
      // The home button has to be laid out before it can be measured, and the
      // overlay has to have painted before it can be animated away from.
      requestAnimationFrame(() => requestAnimationFrame(flyMark));
    }, wait);

    // Deliberately AFTER the opening animation rather than inside it. The
    // check crosses the network, and a student opening the app to read one
    // number should never wait on GitHub to find out anything. It resolves
    // to null on every failure, so there is nothing to catch and nothing to
    // report when it finds nothing.
    setTimeout(() => { void checkForUpdate().then(setUpdate); }, 2000);
  });

  /**
   * Fly the opening X into the home button.
   *
   * The same drawing in both places, moved rather than swapped: the app does
   * not cut from a splash to a dashboard, it puts its mark where it lives.
   *
   * Measured at the moment it runs rather than hardcoded, because the
   * button's position depends on the window width and on whether setup is
   * showing at all. If there is nothing to fly to - setup is open, or the
   * header has not rendered - it fades instead, which is also what a student
   * who has asked for reduced motion gets.
   */
  const flyMark = () => {
    const node = flyer;
    const target = homeBtn?.getBoundingClientRect();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!node || !target || target.width < 1 || reduced) {
      setTimeout(() => setPhase("done"), reduced ? 0 : 260);
      return;
    }

    const from = node.getBoundingClientRect();
    const scale = target.width / from.width;
    const dx = (target.left + target.width / 2) - (from.left + from.width / 2);
    const dy = (target.top + target.height / 2) - (from.top + from.height / 2);

    // Translate and scale only - NO rotation. A full turn passes through 45,
    // 135, 225 and 315 degrees, where an X reads as a plus, and the mark must
    // not become a different symbol on its way anywhere - the same rule the
    // breathe animation is built around (see motion.css). At 60fps a spin is a
    // spin, but a real WebView dropping frames while the dashboard mounts shows
    // it at two or three of those angles and then snaps, which reads as the
    // animation breaking off rather than landing. A clean glide survives a
    // slow frame: dropped frames just make it move in bigger steps along the
    // same straight line, still unmistakably the X arriving.
    const flight = node.animate([
      { transform: "translate(0px, 0px) scale(1)" },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
    ], {
      duration: 720,
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
        {/* The OS title bar is off (`decorations: false`), so this header IS
            the title bar and has to do what the OS stopped doing: be draggable,
            and carry the window buttons.

            `data-tauri-drag-region` applies ONLY to the element carrying it and
            never to its children, so it goes on the header AND on each
            non-interactive block inside it. Every element without it is a patch
            of title bar the window cannot be moved by, which is the standard
            way a frameless window ends up feeling broken. The nav blocks are
            deliberately left off: they are buttons, and a drag region over a
            button eats the click. */}
        <header class="head" data-tauri-drag-region>
          {/* `title` on the Mark, or the app's own name loses its last
              letter: the X is a drawing, and `Mark` hides itself from the
              accessibility tree unless it is given one - so the only heading
              on the screen announced as "Target". */}
          {/* The wordmark and the home route were two targets in the same
              corner. They are one now: the mark is the button, and the app is
              named by the window's own title rather than by a heading that had
              to be spelled "Target" + a drawing to be announced at all. */}
          <button class="homebtn" ref={homeBtn} aria-current={view() === "home"}
                  classList={{ waiting: phase() !== "done" }}
                  aria-label="Home. Where you stand and what needs doing."
                  title="Home" onClick={() => setView("home")}>
            <Mark size="17" />
          </button>

          {/* Home is not in this row - it is the button to the left. The rest
              are peers with no order, so they stay a flat row. */}
          <nav class="tabs" aria-label="Views">
            <For each={VIEWS.filter((v) => v.id !== "home")}>{(v) => (
              <button class="tab" aria-current={view() === v.id} title={v.hint}
                      onClick={() => setView(v.id)}>{v.label}</button>
            )}</For>
          </nav>

          {/* Search sits in the header rather than inside a view because it is
              not a view: it crosses all of them. Labelled with its shortcut so
              the keyboard route is discoverable without a tour. */}
          <button class="ask" onClick={() => setPaletteOpen(true)}
                  aria-label="Ask about your subjects, marks and attendance. Press Control K.">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                 stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" />
            </svg>
            <span>Ask anything — how many classes can I miss?</span>
            <span class="kbd" aria-hidden="true">Ctrl K</span>
          </button>

          <Show when={view() === "ledger"}>
            <nav class="sems" aria-label="Semester">
              <For each={semesterNames()}>{(name) => (
                <button class="sem" aria-current={state.activeSemester === name}
                        onClick={() => selectSemester(name)}>{name}</button>
              )}</For>
              <button class="sem" title="Add the next semester"
                      aria-label="Add the next semester" onClick={addSemester}>+</button>
            </nav>
          </Show>

          <Bell findings={findings()} onGo={() => setDismissed(true)} />
          <Profile />
          <WindowChrome />
        </header>

        <Show when={view() === "ledger"}>
          <GoalBar />
          <Ledger />
          <Drawer />
        </Show>
        <SaveNotice />
        <Show when={!updateDismissed() && update()}>
          {(u) => (
            <UpdateNotice update={u()} onDismiss={() => setUpdateDismissed(true)} />
          )}
        </Show>

        <Show when={view() === "home"}><Home /></Show>
        <Show when={view() === "attendance"}><Attendance /></Show>
        <Show when={view() === "history"}><History /></Show>
        <Show when={view() === "data"}><Data /></Show>

        <Palette open={paletteOpen()} onClose={() => setPaletteOpen(false)} />
      </div>
    </Show>
    </>
  );
}
