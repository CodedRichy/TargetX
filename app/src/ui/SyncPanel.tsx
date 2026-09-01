import { Show, createSignal, onMount } from "solid-js";
import { EtlabError, canSync, endSession, fullSync } from "../sync/etlab";
import type { SyncResult } from "../sync/etlab";
import { applySync } from "../state/actions";
import { edit, state } from "../state/store";
import { canRemember, deleteCreds, loadCreds, saveCreds } from "../state/creds";
import { openExternal } from "../state/external";

/**
 * Portal sign-in and sync.
 *
 * Used in two places without changing shape: as a setup step and as a panel on
 * the Data screen. It is never a modal - a sync that fails needs its error read
 * next to the URL that produced it.
 *
 * Security posture, stated in the UI because the student is typing a real
 * college password into a third-party app and deserves to know:
 *   - the password is held in a local variable for one request and never
 *     written to disk, never put in app state, never logged
 *   - the session cookie lives in the Rust process, not in the web layer, so
 *     nothing in the frontend can read or leak it
 *   - signing out drops it
 */
export function SyncPanel(props: { onDone?: () => void; compact?: boolean }) {
  const [url, setUrl] = createSignal(String(state.student.college || ""));
  const [user, setUser] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal("");
  const [error, setError] = createSignal("");
  /**
   * A redacted description of the page the parser could not read.
   *
   * Only set when sync got as far as fetching the record and failed to make
   * sense of it - which is the failure a second college will actually hit, and
   * the only one where what went wrong is invisible to everyone involved.
   */
  const [diagnostic, setDiagnostic] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const [result, setResult] = createSignal<SyncResult | null>(null);
  /**
   * Whether to keep this login in the OS credential vault (issue #2). Default
   * OFF - remembering a portal password is a choice the student makes, never
   * one the app makes for them. Only ever offered on the desktop build, where
   * there is a vault to keep it in.
   */
  const [remember, setRemember] = createSignal(false);

  // If a login was saved for the address already on the form, fill both fields
  // from the vault and show the box ticked, so the core loop - open, sync - is
  // one press. Best-effort: a vault that will not answer just leaves the form
  // blank, exactly as before the feature existed.
  onMount(async () => {
    if (!canRemember()) return;
    const base = url().trim();
    if (!base) return;
    try {
      const stored = await loadCreds(base);
      if (stored) {
        setUser(stored.username);
        setPassword(stored.password);
        setRemember(true);
      }
    } catch { /* vault optional; never block the form */ }
  });

  const run = async (event: Event) => {
    event.preventDefault();
    setError("");
    setDiagnostic("");
    setCopied(false);
    setResult(null);

    if (!canSync()) {
      setError("Portal sync needs the desktop app. In a browser, use paste import instead.");
      return;
    }

    try {
      setBusy("Signing in…");
      const synced = await fullSync(url(), user(), password());
      setBusy("Applying…");
      applySync(synced);
      edit((s) => { s.student.college = url().trim(); });
      setResult(synced);
      // Persist, or forget, only after a sync actually worked - and only if
      // the student asked. Wrapped so a vault that refuses never turns a
      // successful sync into a visible failure; the password still lives only
      // in the signal, about to be dropped in `finally`.
      if (canRemember()) {
        const base = url().trim();
        try {
          if (remember()) await saveCreds(base, user(), password());
          else await deleteCreds(base);
        } catch { /* remembering is a convenience, never a blocker */ }
      }
    } catch (exc) {
      setError(exc instanceof EtlabError ? exc.message : String(exc));
      if (exc instanceof EtlabError && exc.diagnostic) setDiagnostic(exc.diagnostic);
    } finally {
      setBusy("");
      // Drop the password whatever happened. Clearing it only on success left
      // it live in the signal and in the DOM for as long as a failed sync sat
      // on screen - which is the case a student retries, and stares at.
      setPassword("");
    }
  };

  const semesterCount = () => Object.keys(result()?.semesters ?? {}).length;
  const courseCount = () => Object.values(result()?.semesters ?? {})
    .reduce((sum, s) => sum + s.courses.length, 0);
  const mismatches = () => Object.entries(result()?.semesters ?? {})
    .filter(([, s]) => s.creditCheck.matched === false);
  /** Deduplicated: the same elective appears in two semesters at a re-sit. */
  const inferred = () => Array.from(new Set(result()?.inferredTypes ?? []));

  return (
    <div class="sync">
      <Show when={!result()} fallback={
        <div class="sync-done">
          <h3>Synced</h3>
          <p class="lede">
            Pulled <strong class="num">{semesterCount()}</strong> semesters and{" "}
            <strong class="num">{courseCount()}</strong> subjects, with attendance,
            series marks and published grades.
          </p>

          <Show when={mismatches().length > 0}>
            <div class="notice warn">
              <strong>Check your credits.</strong> KTU portals publish credits per
              semester, never per subject, so TargetX infers them and then checks
              the total. These do not add up:
              <ul>
                {mismatches().map(([name, sem]) => (
                  <li class="num">
                    {name}: TargetX has {sem.creditCheck.current}, the portal
                    published {sem.creditCheck.published}
                  </li>
                ))}
              </ul>
              Nothing is wrong with your marks — but SGPA will be off until the
              credits match. Fix them in the semester grid.
            </div>
          </Show>

          {/* Named, not counted. "3 subjects were inferred" sends a student
              looking through seven; three course codes send them to three. */}
          <Show when={inferred().length > 0}>
            <div class="notice">
              <strong>
                {inferred().length === 1
                  ? "One subject is not in the curriculum file."
                  : `${inferred().length} subjects are not in the curriculum file.`}
              </strong>{" "}
              <span class="num">{inferred().join(", ")}</span> — neither the
              published curriculum nor your portal said whether{" "}
              {inferred().length === 1 ? "it is" : "they are"} marked out of 40/60
              or 50/50, so it was read off the course code. That split sets the
              internal maximum, so check it in the semester grid before trusting
              a projected grade on{" "}
              {inferred().length === 1 ? "that subject" : "those subjects"}.
              Everything else came from the university's own table.
            </div>
          </Show>

          <div class="setup-actions">
            <button class="primary" onClick={() => props.onDone?.()}>See my semester</button>
          </div>
        </div>
      }>
        <Show when={!props.compact}>
          <h2>Sign in to your college portal</h2>
          <p class="lede">
            Most KTU colleges run etlab. Paste the address you normally log in
            at — TargetX works out the rest of the routes itself.
          </p>
        </Show>

        <form onSubmit={run} class="sync-form">
          <label>
            College portal address
            <input class="field-input" value={url()} placeholder="mits.etlab.app"
                   autocomplete="url" onInput={(e) => setUrl(e.currentTarget.value)} />
          </label>
          <label>
            Username or admission number
            <input class="field-input" value={user()} placeholder="Register number"
                   autocomplete="username" onInput={(e) => setUser(e.currentTarget.value)} />
          </label>
          <label>
            Password
            <input class="field-input" type="password" value={password()}
                   autocomplete="current-password"
                   onInput={(e) => setPassword(e.currentTarget.value)} />
          </label>

          {/* Desktop only: a browser build has no vault, so the choice is not
              offered rather than shown and then failing. Default unchecked. */}
          <Show when={canRemember()}>
            <label class="remember">
              <input type="checkbox" checked={remember()}
                     onChange={(e) => setRemember(e.currentTarget.checked)} />
              <span>Remember this login on this device</span>
            </label>
          </Show>

          <div class="setup-actions">
            <button class="primary" type="submit" disabled={!!busy()}>
              {busy() || "Sync now"}
            </button>
            <Show when={state.lastSync}>
              <button class="link" type="button" onClick={() => {
                void endSession();
                // Signing out forgets the saved password too: a student ending
                // a session does not expect it to stay on the machine.
                if (canRemember()) { void deleteCreds(url().trim()); setRemember(false); }
                setPassword("");
              }}>
                Sign out
              </button>
            </Show>
          </div>
        </form>

        <p class="fineprint">
          <Show when={canRemember() && remember()} fallback={
            <>
              Your password is used for this one request and is never saved. The
              session stays inside the app process, not in the page, and TargetX
              only ever reads — it cannot change anything on the portal.
            </>
          }>
            Your password will be kept in Windows Credential Manager, encrypted
            for your account on this device — never in TargetX's backup, never
            in a log, never off this machine. Untick the box, or sign out, to
            forget it. TargetX only ever reads the portal; it cannot change it.
          </Show>
        </p>

        <Show when={error()}>
          <div class="notice bad">
            <strong>Sync failed.</strong> {error()}
            <Show when={!canSync()}>
              {" "}Paste import is on the Data screen and works everywhere.
            </Show>
            {/* Shown rather than attached invisibly: a student is being asked
                to forward something off their own academic record, and a
                diagnostic you have to trust unread is one that should not
                exist. It is the table headings with every digit replaced, and
                no subject row at all - which they can see for themselves. */}
            <Show when={diagnostic()}>
              <details class="diagnostic">
                <summary>
                  What TargetX saw on that page — safe to send, no marks or
                  names in it
                </summary>
                <p class="lede">
                  Your college's portal lays its pages out differently from the
                  one this was built against. This is the shape of the page,
                  with every number blanked out; sending it with a bug report is
                  what makes the next version read your portal.
                </p>
                <pre class="num">{diagnostic()}</pre>
                <button type="button" class="link" onClick={() => {
                  void navigator.clipboard?.writeText(diagnostic());
                  setCopied(true);
                }}>
                  {copied() ? "Copied" : "Copy"}
                </button>
                {" · "}
                <a href="https://github.com/CodedRichy/TargetX/issues/new?template=bug.yml"
                   target="_blank" rel="noreferrer"
                   onClick={(e) => openExternal(e, e.currentTarget.href)}>Open an issue</a>
              </details>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
