import { For, Show, createResource, createSignal, onMount } from "solid-js";
import { catalogueVersion } from "../engine";
import {
  applyGradeCard, download, exportJson, importJson, importPaste, reportText,
  resetEverything, syncKtu, updateCatalogue,
} from "../state/actions";
import { rows, state, summary } from "../state/store";
import { logDir } from "../state/diagnostics";
import { openExternal } from "../state/external";
import { canSync, describeAcademics, parseAcademics } from "../sync/etlab";
import { parseGradeCard, pdfToText } from "../sync/gradecard";
import { KtuPanel } from "./KtuPanel";
import { KTU_CRED_KEY, canRemember, deleteCreds, loadCreds, saveCreds, vaultName } from "../state/creds";
import { SyncPanel } from "./SyncPanel";

/** The credential-vault key for the KTU result portal, distinct from any etlab base. */

/**
 * Data: everything that moves information in or out.
 *
 * Grouped onto one screen on purpose. These operations are rare, consequential
 * and easy to lose in a menu, and a student looking for "how do I get my marks
 * in" should find every answer in one place rather than three.
 */
export function Data() {
  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h2>Data</h2>
          <p class="lede">Your marks stay on this device — nothing here uploads them.</p>
        </div>
        <Show when={state.lastSync}>
          <span class="fineprint num">
            Last synced {new Date(state.lastSync!).toLocaleString()}
          </span>
        </Show>
      </div>

      {/* Two groups, not one flat wall. Everything that pulls marks in sits
          together; the rarer app-and-data operations sit apart, so the screen
          reads as two short shelves rather than seven parallel forms. Each card
          shows one action at rest - the paste boxes and the KTU login are
          folded into `<details>` and open only when asked for. */}
      <h3 class="group-head">Bring your marks in</h3>
      <div class="cards">
        <section class="card">
          <h3>College portal</h3>
          <p class="lede">
            Sign in to pull your attendance and series marks — the weekly sync.
          </p>
          <details class="more">
            <summary>Sign in to sync</summary>
            <Show when={canSync()} fallback={
              <p class="fineprint">
                Needs the desktop app — a browser cannot hold a portal session.
                Paste import works everywhere.
              </p>
            }>
              <SyncPanel compact />
            </Show>
          </details>
        </section>

        <PasteImport />
        <GradeCardImport />
        <PortalCheck />
        <MonthReach />
      </div>

      <h3 class="group-head">This app &amp; your data</h3>
      <div class="cards">
        <Catalogue />
        <Backup />
        <About />
      </div>
    </div>
  );
}

/**
 * Paste import.
 *
 * The fallback that works at every college, including ones whose portal is not
 * etlab or which put a captcha on login. Copying a rendered table out of a
 * browser is stable in a way that scraping markup is not.
 */
function PasteImport() {
  const [text, setText] = createSignal("");
  const [mode, setMode] = createSignal<"attendance" | "marks">("attendance");
  const [note, setNote] = createSignal("");
  const [refused, setRefused] = createSignal<string[]>([]);
  const [added, setAdded] = createSignal<string[]>([]);

  const run = () => {
    if (!text().trim()) return;
    const outcome = importPaste(text(), mode());
    setNote(`Updated ${outcome.matched} subject${outcome.matched === 1 ? "" : "s"}.`);
    // Refused rows are listed, not counted. "3 rows skipped" tells a student
    // nothing they can act on; the course code tells them exactly which
    // subject still needs typing in by hand.
    setRefused(outcome.refused);
    // Added rows are now listed for the same reason and a sharper one. They
    // used to ride along in the note as ", added 1 new" - a count, next to a
    // count, in a sentence that reads like success. A code that matches
    // nothing in the semester is appended as a real subject with inferred
    // credits, and those credits enter the SGPA projection, so a typo quietly
    // moves the number the whole app exists to get right.
    setAdded(outcome.addedCodes);
    setText("");
  };

  return (
    <section class="card">
      <h3>Paste from your portal</h3>
      <p class="lede">
        No sign-in: copy the table off your portal and drop it into {state.activeSemester}.
      </p>

      <details class="more">
        <summary>Paste a table</summary>

        {/* Which of the two is selected was carried by `.on` - a colour - and
            by nothing else. `aria-pressed` says the same thing in the tree, and
            the group is named so the pair reads as a choice rather than as two
            loose buttons. */}
        <div class="seg" role="group" aria-label="What you are pasting">
          <button classList={{ on: mode() === "attendance" }}
                  aria-pressed={mode() === "attendance"}
                  onClick={() => setMode("attendance")}>Attendance</button>
          <button classList={{ on: mode() === "marks" }}
                  aria-pressed={mode() === "marks"}
                  onClick={() => setMode("marks")}>Series marks</button>
        </div>

        <textarea class="paste num" rows="4" value={text()}
                  aria-label="Rows copied from your portal"
                  placeholder={mode() === "attendance"
                    ? "PCCST501  Computer Networks  41  48  85.4%"
                    : "PCCST501  Computer Networks  38  31  8"}
                  onInput={(e) => setText(e.currentTarget.value)} />

        <div class="setup-actions">
          <button class="primary" disabled={!text().trim()} onClick={run}>Import</button>
          <Show when={note()}><span class="fineprint">{note()}</span></Show>
        </div>
      </details>

      <Show when={added().length > 0}>
        <div class="notice warn" role="status">
          <strong>
            {added().length} new subject{added().length === 1 ? " was" : "s were"} added
            to {state.activeSemester}.
          </strong>{" "}
          These codes matched nothing already in the semester, so they were
          entered as new subjects with credits inferred from the code. If one
          of them is a typo, or belongs to another semester, remove it in the
          Semester table — an invented subject carries its inferred credits
          into your projected SGPA.
          <ul class="fineprint num">
            <For each={added()}>{(code) => <li>{code}</li>}</For>
          </ul>
        </div>
      </Show>

      <Show when={refused().length > 0}>
        <div class="notice warn" role="status">
          <strong>
            {refused().length} row{refused().length === 1 ? " was" : "s were"} left
            alone.
          </strong>{" "}
          A marks page prints the mark and its maximum side by side, and on
          these rows the two could not be told apart. Writing a maximum into a
          mark column produces a confident CIE that is wrong, so nothing was
          written — enter these by hand in the Semester table.
          <ul class="fineprint">
            <For each={refused()}>{(line) => <li>{line}</li>}</For>
          </ul>
        </div>
      </Show>
    </section>
  );
}

/**
 * KTU grade card import.
 *
 * The only route that fills in a whole academic history at once, and the only
 * one that works for a student whose college portal TargetX cannot read. The
 * university's own document outranks everything else, so this writes history
 * directly - but a semester whose arithmetic does not reconcile is reported
 * rather than quietly believed.
 */
function GradeCardImport() {
  const [text, setText] = createSignal("");
  const [note, setNote] = createSignal("");
  const [warn, setWarn] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  const ingest = (raw: string) => {
    const card = parseGradeCard(raw);
    const names = Object.keys(card.semesters);
    if (!names.length) {
      setWarn([]);
      setNote("No course rows found in that. A grade card row looks like "
        + "“PCCST501  Computer Networks  4  A+”.");
      return;
    }
    const outcome = applyGradeCard(card);
    setWarn(outcome.mismatched);
    setNote(`Imported ${outcome.courses} subjects across `
      + `${outcome.semesters} semester${outcome.semesters === 1 ? "" : "s"}`
      + (card.semesterDetected ? "." : " — no semester headings found, so "
        + "everything landed in S1. Move what belongs elsewhere."));
    setText("");
  };

  const openFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    setNote("");
    try {
      ingest(file.name.toLowerCase().endsWith(".pdf")
        ? await pdfToText(file)
        : await file.text());
    } catch (exc) {
      setWarn([]);
      setNote(`Could not read that file: ${String(exc)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card">
      <h3>KTU grade card</h3>
      <p class="lede">
        Your official results — grades, credits and printed SGPA for every
        published semester, read at once.
      </p>

      {/* The live fetch is the best path - the university's own record, whole -
          so it leads, but stays folded until asked for so the login is out of
          sight at rest. It feeds the same import path as a paste, so a fetched
          card outranks an etlab scrape and flags a disagreement the same way. */}
      <details class="more">
        <summary>Fetch live from KTU</summary>
        <KtuPanel onFetched={(summary) => {
          setNote(summary.note);
          setWarn(summary.mismatched);
        }} />
      </details>

      <details class="more">
        <summary>Paste a card, or open a PDF</summary>
        <textarea class="paste num" rows="3" value={text()}
                  aria-label="Grade card text"
                  placeholder="PCCST501  Computer Networks  4  A+&#10;SGPA: 8.42"
                  onInput={(e) => setText(e.currentTarget.value)} />
        <div class="setup-actions wrap">
          <button class="primary" disabled={!text().trim() || busy()}
                  onClick={() => ingest(text())}>Import pasted card</button>
          <button class="ghost" disabled={busy()} onClick={() => fileInput?.click()}>
            {busy() ? "Reading…" : "Open PDF or text file"}
          </button>
          <input type="file" accept=".pdf,.txt,.html,.htm" hidden
                 ref={fileInput} onChange={openFile} />
        </div>
      </details>

      <Show when={note()}><p class="fineprint">{note()}</p></Show>

      <Show when={warn().length > 0}>
        <div class="notice warn">
          <strong>{warn().join(", ")} did not reconcile.</strong> The SGPA
          recomputed from the rows TargetX read disagrees with the one printed on
          your card, which means a row or a credit was misread. The import stands
          — your published SGPA is what counts - but check those semesters on the
          History screen before trusting a projection built on them.
        </div>
      </Show>
    </section>
  );
}

/**
 * Does sync work at this college? Answered without signing in.
 *
 * Portal sync is validated against exactly one college, and the thing blocking
 * a second has never been code - it has been that finding out meant handing
 * someone an account. The parser needs nothing but the HTML the student's
 * browser already has: File > Save Page As on the academics page, then drop it
 * here. There is a command-line version of this in `tools/portal-check.ts`;
 * this one exists because nobody at another college is going to clone a repo
 * and run npm install to answer a stranger's question.
 *
 * The saved page is the student's whole academic record and never leaves the
 * machine - it is read in the page, held in a local variable, and not written
 * to state, to disk or to the record. What they are asked to send is the
 * redacted block, which they can read first.
 */
function PortalCheck() {
  const [report, setReport] = createSignal("");
  const [found, setFound] = createSignal<string[]>([]);
  const [note, setNote] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  const openFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setBusy(true);
    setReport("");
    setFound([]);
    setCopied(false);
    try {
      const html = await file.text();
      const parsed = parseAcademics(html);
      const lines: string[] = [];
      for (const [number, semester] of Object.entries(parsed.semesters)) {
        // Codes only. A subject name is public; a mark is not, and this sits
        // on a screen someone may well photograph to send on.
        const count = semester.courses.length;
        lines.push(`S${number}: ${count} subject${count === 1 ? "" : "s"}`
          + (semester.courses.length
            ? ` — ${semester.courses.map((c) => c.code).join(", ")}`
            : ""));
      }
      setFound(lines);
      const courses = Object.values(parsed.semesters)
        .reduce((sum, semester) => sum + semester.courses.length, 0);
      setNote(courses > 0
        ? "Sync should work at this college."
        : "Nothing this parser can read — which is the finding, not a fault "
          + "in your file. Send the block below and it can be fixed.");
      setReport(describeAcademics(html));
    } catch (exc) {
      setNote(`Could not read that file: ${String(exc)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card">
      <h3>Will sync work at my college?</h3>
      <p class="lede">
        No sign-in: save your academics page (Ctrl+S) and drop it in to find out.
      </p>

      <div class="setup-actions wrap">
        <button class="ghost" disabled={busy()} onClick={() => fileInput?.click()}>
          {busy() ? "Reading…" : "Open a saved portal page"}
        </button>
        <input type="file" accept=".html,.htm" hidden
               ref={fileInput} onChange={openFile} />
      </div>

      <Show when={note()}><p class="fineprint">{note()}</p></Show>
      <Show when={found().length > 0}>
        <ul class="fineprint num">
          {found().map((line) => <li>{line}</li>)}
        </ul>
      </Show>

      <Show when={report()}>
        <details class="diagnostic" open>
          <summary>What TargetX saw — safe to send, no marks or names in it</summary>
          <p class="lede">
            Headings and shapes only: every number is blanked out and no subject
            row is quoted. <strong>Send this, not the saved page</strong> — the
            page itself is your whole academic record. Nothing here was uploaded
            anywhere; the file was read on this machine and not kept.
          </p>
          <pre class="num">{report()}</pre>
          <button type="button" class="link" onClick={() => {
            void navigator.clipboard?.writeText(report());
            setCopied(true);
          }}>{copied() ? "Copied" : "Copy"}</button>
          {" · "}
          <a href="https://github.com/CodedRichy/TargetX/issues/new?template=bug.yml"
             target="_blank" rel="noreferrer"
             onClick={(e) => openExternal(e, e.currentTarget.href)}>Open an issue</a>
        </details>
      </Show>
    </section>
  );
}

function Catalogue() {
  const [note, setNote] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const run = async () => {
    setBusy(true);
    setNote("");
    try {
      setNote(await updateCatalogue());
    } catch (exc) {
      setNote(String(exc));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card">
      <h3>Course catalogue</h3>
      <p class="lede">
        Credits and mark patterns from KTU's curriculum. Updates without reinstalling.
      </p>
      <div class="setup-actions">
        <button class="primary" disabled={busy()} onClick={run}>
          {busy() ? "Checking…" : "Check for updates"}
        </button>
        <span class="fineprint num">Version {catalogueVersion()}</span>
      </div>
      <Show when={note()}><p class="fineprint">{note()}</p></Show>
    </section>
  );
}

/**
 * What this build is, and where it writes its faults.
 *
 * Two facts that are worthless on any day the app works and are the whole of
 * a support conversation on the day it does not. A student reporting "it
 * stopped working" can be asked for exactly these, and the issue template and
 * PRIVACY.md both send them here to find them.
 *
 * The folder is shown rather than opened. Opening it would mean shipping the
 * opener plugin, and this webview also renders a college portal's HTML - the
 * ability to ask the OS to launch things is a poor trade for saving one
 * window.
 */
/**
 * What the portal offers for changing month (issue #13).
 *
 * The month archive can only accumulate forward, and whether it could reach
 * back for a September the app was not running for depends on whether the
 * portal serves a past month at all. The last sync read the page's own
 * navigation off the HTML it already had; this shows what it found, so the
 * question can be answered from a real portal instead of guessed at.
 *
 * Shown only once a sync has actually looked. Before that there is nothing to
 * report and a card saying so is noise on a screen that already has plenty.
 */
function MonthReach() {
  const [copied, setCopied] = createSignal(false);
  const found = () => state.monthControls ?? [];
  const reachable = () => found().some((c) => c.kind !== "none");
  const report = () => found().map((c) => `${c.kind}: ${c.detail}`).join("\n");

  return (
    <Show when={found().length > 0}>
      <section class="card">
        <h3>Can TargetX show you past months?</h3>
        <p class="lede">
          TargetX keeps every month it syncs, but the portal serves one month at
          a time - so months from before you installed it are only reachable if
          the portal will hand them over on request.
        </p>

        <p class="fineprint">
          <Show when={reachable()} fallback={
            <>The last sync found <strong>no control on the attendance page
            that names a month or a year</strong>. If that holds, the portal
            only ever serves the current month and TargetX cannot reach back -
            it can only keep what it sees from now on.</>
          }>
            The last sync found a control that names a month. That is the thing
            past months would be fetched through, so backfilling the rest of
            your semester is likely possible.
          </Show>
        </p>

        <details class="diagnostic" open>
          <summary>What it found — safe to send, no marks or attendance in it</summary>
          <p class="lede">
            Element and attribute names read off the page, nothing from the
            table itself. No subject, no day, no mark, no attendance. Nothing
            was uploaded anywhere; the page was read during your own sync.
          </p>
          <pre class="num">{report()}</pre>
          <button type="button" class="link" onClick={() => {
            void navigator.clipboard?.writeText(report());
            setCopied(true);
          }}>{copied() ? "Copied" : "Copy"}</button>
        </details>
      </section>
    </Show>
  );
}

function About() {
  const [dir] = createResource(logDir);

  return (
    <section class="card">
      <h3>This build</h3>
      <p class="lede">
        Worth nothing until something goes wrong, and then it is the whole
        report.
      </p>

      <dl class="factlist">
        <dt>Version</dt>
        <dd class="num">{__APP_VERSION__}</dd>

        <Show when={dir()}>
          {(path) => (
            <>
              <dt>Fault log</dt>
              <dd>
                <code class="path">{path()}</code>
                <span class="fineprint">
                  Holds error messages, not your marks. Nothing sends it —
                  read it, then attach it to an issue if you want to.
                </span>
              </dd>
            </>
          )}
        </Show>

        <dt>Your data</dt>
        <dd>
          Your marks stay on this device, and there is no telemetry. Four
          things touch the network, and the fourth only if you sign in to ask
          a question —{" "}
          <a class="link" href="https://github.com/CodedRichy/TargetX/blob/main/PRIVACY.md"
             target="_blank" rel="noreferrer"
             onClick={(e) => openExternal(e, e.currentTarget.href)}>the privacy statement</a>{" "}
          names all of them.
        </dd>
      </dl>
    </section>
  );
}

/**
 * Is this actually a backup, all the way down?
 *
 * `importJson` checks the envelope - that the file parses and carries a
 * `semesters` key - and then trusts everything under it. That guard passes
 * `{"semesters": "hello"}`, and what happens next is the worst sequence this
 * app can perform: the restore COMMITS, `persist()` writes the garbage over
 * the student's record, and only then does a render reach for
 * `courses.length` and throw. The throw is uncaught, so there is no message;
 * the write already landed, so there is nothing to roll back to. Measured on
 * a five-semester record, the next cold start opened on the setup wizard.
 *
 * So the shape is checked BEFORE anything is written, and the check walks as
 * far as the crash did: semesters must be a map of objects, each with an
 * array of course objects. Anything else is refused with a sentence a student
 * can act on, and the record on screen is left exactly as it was.
 *
 * This is deliberately structural and not a full schema. A field holding the
 * wrong kind of number is a wrong mark - bad, visible, and fixable in the
 * Semester table. A field holding the wrong kind of THING takes the app down
 * and the record with it, and that is the class being stopped here.
 */
function checkBackup(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not JSON — it may have been truncated, or "
      + "saved from the wrong place. Pick the targetx-….json you exported.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("That file is not a TargetX backup.");
  }
  // Not a crash, but a lie on every screen: a numeric `activeSemester`
  // restores cleanly and Home then reads "42 · the room you have above the
  // 75% eligibility line". Measured.
  const active = (parsed as { activeSemester?: unknown }).activeSemester;
  if (active !== undefined && typeof active !== "string") {
    throw new Error("The current semester in that file is not a semester name. "
      + "The file looks hand-edited; nothing was changed.");
  }
  const semesters = (parsed as { semesters?: unknown }).semesters;
  if (!semesters || typeof semesters !== "object" || Array.isArray(semesters)) {
    throw new Error("That file has no semesters in it, so it is not a TargetX "
      + "backup — or it has been edited into a shape TargetX cannot read. "
      + "Nothing was changed.");
  }
  for (const [name, semester] of Object.entries(semesters as Record<string, unknown>)) {
    if (!semester || typeof semester !== "object" || Array.isArray(semester)) {
      throw new Error(`${name} in that file is not a semester. The file looks `
        + "hand-edited; nothing was changed.");
    }
    const courses = (semester as { courses?: unknown }).courses;
    // Absent is fine - a semester written before it had any subjects. Present
    // and not an array is not, and is exactly what crashed the render.
    if (courses !== undefined && !Array.isArray(courses)) {
      throw new Error(`The subject list for ${name} in that file is not a list. `
        + "The file looks hand-edited; nothing was changed.");
    }
    for (const course of (Array.isArray(courses) ? courses : [])) {
      if (!course || typeof course !== "object" || Array.isArray(course)) {
        throw new Error(`${name} in that file holds something that is not a `
          + "subject. The file looks hand-edited; nothing was changed.");
      }
      // `code` is read as a string by everything downstream, including the
      // `.trim()` that threw on a numeric one.
      const code = (course as { code?: unknown }).code;
      if (code !== undefined && typeof code !== "string") {
        throw new Error(`A subject in ${name} has a course code that is not `
          + "text. The file looks hand-edited; nothing was changed.");
      }
    }
  }
}

function Backup() {
  const [confirming, setConfirming] = createSignal(false);
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal("");
  let fileInput: HTMLInputElement | undefined;

  const stamp = () => new Date().toISOString().slice(0, 10);

  const restore = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared before anything else, exactly as the two file pickers above do.
    // Without it `change` does not fire when the same file is chosen a second
    // time, so a student who restored a backup, kept working, and reached for
    // the same file again got NOTHING - no restore and no message. On this
    // control, silence reads as "it worked".
    input.value = "";
    if (!file) return;
    setNote(""); setError("");
    try {
      const text = await file.text();
      checkBackup(text);
      importJson(text);
      const count = Object.keys(state.semesters).length;
      // A restore that says nothing is indistinguishable from a restore that
      // did nothing, and this one replaces the whole document.
      setNote(`Restored ${count} semester${count === 1 ? "" : "s"} from `
        + `${file.name}. Everything that was here has been replaced.`);
    } catch (exc) {
      // Was an `alert()`: a blocking OS dialog carrying a raw stack-trace
      // string ("TypeError: Ot(...).map is not a function"), which is not a
      // sentence anyone can act on. The refusal belongs on the card, beside
      // the button that caused it, in the same voice as every other notice
      // on this screen.
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  return (
    <section class="card">
      <h3>Backup and reset</h3>
      <p class="lede">
        Your data is a file you own. Export before reinstalling or moving
        laptops.
      </p>

      <div class="setup-actions wrap">
        <button class="primary"
                onClick={() => download(`targetx-${stamp()}.json`, exportJson())}>
          Export backup
        </button>
        <button class="ghost" onClick={() => fileInput?.click()}>Restore backup</button>
        <button class="ghost"
                onClick={() => download(
                  `targetx-${state.activeSemester}-${stamp()}.txt`,
                  reportText(rows() as never, state.activeSemester, summary() as never),
                  "text/plain")}>
          Export semester report
        </button>
        <input type="file" accept="application/json" hidden
               ref={fileInput} onChange={restore} />
      </div>

      <Show when={error()}>
        <div class="notice bad" role="alert">
          <strong>Could not restore that file.</strong> {error()}
        </div>
      </Show>
      <Show when={note()}>
        <p class="fineprint" role="status">{note()}</p>
      </Show>

      <hr class="rule" />

      {/* Pressing "Erase everything" unmounts the button that was focused,
          so keyboard focus fell to the document body and the next Tab
          restarted at the top of the app - the confirmation was on screen and
          out of reach. Focus moves onto the confirmation itself instead of
          onto either of its buttons: putting it on "Yes, erase it" would make
          a second Enter, pressed on the way past, delete everything. */}
      <Show when={confirming()} fallback={
        <button class="danger" onClick={() => setConfirming(true)}>Erase everything</button>
      }>
        <div class="notice bad" tabindex="-1" role="group"
             aria-label="Confirm erasing everything"
             ref={(el) => queueMicrotask(() => el.focus())}>
          <strong>This deletes every subject, mark and past semester on this
          device.</strong> It cannot be undone, and TargetX has no copy of your
          data anywhere else. Export a backup first if there is any doubt.
          <div class="setup-actions">
            <button class="danger" onClick={() => { resetEverything(); setConfirming(false); }}>
              Yes, erase it
            </button>
            <button class="link" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      </Show>
    </section>
  );
}
