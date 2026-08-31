import { For, Show, createResource, createSignal, onMount } from "solid-js";
import { catalogueVersion } from "../engine";
import {
  applyGradeCard, download, exportJson, importJson, importPaste, reportText,
  resetEverything, syncKtu, updateCatalogue,
} from "../state/actions";
import { rows, state, summary } from "../state/store";
import { logDir } from "../state/diagnostics";
import { canSync, describeAcademics, parseAcademics } from "../sync/etlab";
import { parseGradeCard, pdfToText } from "../sync/gradecard";
import { KtuError, canSyncKtu } from "../sync/ktu";
import { canRemember, deleteCreds, loadCreds, saveCreds } from "../state/creds";
import { SyncPanel } from "./SyncPanel";

/** The credential-vault key for the KTU result portal, distinct from any etlab base. */
const KTU_CRED_KEY = "https://app.ktu.edu.in";

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
          <p class="lede">
            Bring marks in, take a backup out. All local — no account,
            nothing uploaded.
          </p>
        </div>
        <Show when={state.lastSync}>
          <span class="fineprint num">
            Last synced {new Date(state.lastSync!).toLocaleString()}
          </span>
        </Show>
      </div>

      <div class="cards">
        <section class="card">
          <h3>Portal sync</h3>
          <Show when={canSync()} fallback={
            <p class="lede">
              Needs the desktop app — a browser cannot hold a portal session.
              Paste import works everywhere.
            </p>
          }>
            <SyncPanel compact />
          </Show>
        </section>

        <PasteImport />
        <GradeCardImport />
        <PortalCheck />
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

  const run = () => {
    if (!text().trim()) return;
    const outcome = importPaste(text(), mode());
    setNote(`Updated ${outcome.matched} subject${outcome.matched === 1 ? "" : "s"}`
      + (outcome.added ? `, added ${outcome.added} new` : "") + ".");
    // Refused rows are listed, not counted. "3 rows skipped" tells a student
    // nothing they can act on; the course code tells them exactly which
    // subject still needs typing in by hand.
    setRefused(outcome.refused);
    setText("");
  };

  return (
    <section class="card">
      <h3>Paste from your portal</h3>
      <p class="lede">
        Copy the table off your portal page and paste it. Matched by course
        code and merged into {state.activeSemester}; the half you do not paste
        is left alone.
      </p>

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

  // Live fetch from the KTU results portal. Separate credential state from the
  // etlab SyncPanel: this is a different portal with a different login, kept
  // under its own vault key. Same security posture - the password lives in a
  // signal for one fetch and is dropped in `finally`, the session cookie stays
  // in the Rust process, and remembering is opt-in and desktop-only.
  const [kuser, setKuser] = createSignal("");
  const [kpass, setKpass] = createSignal("");
  const [kremember, setKremember] = createSignal(false);
  const [kbusy, setKbusy] = createSignal(false);
  const [kerror, setKerror] = createSignal("");

  onMount(async () => {
    if (!canRemember()) return;
    try {
      const stored = await loadCreds(KTU_CRED_KEY);
      if (stored) { setKuser(stored.username); setKpass(stored.password); setKremember(true); }
    } catch { /* vault optional; never block the form */ }
  });

  const runKtu = async (event: Event) => {
    event.preventDefault();
    setKerror(""); setNote(""); setWarn([]);
    if (!canSyncKtu()) {
      setKerror("KTU sync needs the desktop app. In a browser, paste or drop the card instead.");
      return;
    }
    try {
      setKbusy(true);
      const outcome = await syncKtu(kuser().trim(), kpass());
      setWarn(outcome.mismatched);
      setNote(`Fetched ${outcome.fetched.join(", ")} from KTU — `
        + `${outcome.courses} subject${outcome.courses === 1 ? "" : "s"} across `
        + `${outcome.semesters} semester${outcome.semesters === 1 ? "" : "s"}.`);
      // Persist or forget only after a fetch that worked, and only if asked.
      if (canRemember()) {
        try {
          if (kremember()) await saveCreds(KTU_CRED_KEY, kuser().trim(), kpass());
          else await deleteCreds(KTU_CRED_KEY);
        } catch { /* remembering is a convenience, never a blocker */ }
      }
    } catch (exc) {
      setKerror(exc instanceof KtuError ? exc.message : String(exc));
    } finally {
      setKbusy(false);
      setKpass("");
    }
  };

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
        Open your grade card from the KTU results portal and drop the PDF in, or
        paste the table. Grades, credits and the printed SGPA of every semester
        on it are read at once - this is the fastest way to fill in your past.
      </p>

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

      {/* Live fetch. The same card, a third way in: rather than opening the KTU
          portal and downloading a PDF, sign in once and pull every published
          card at source. It feeds the exact same import path, so a fetched card
          outranks an etlab scrape and flags a disagreement the same way. */}
      <div class="ktu-live">
        <Show when={canSyncKtu()} fallback={
          <p class="fineprint">
            Or fetch your cards straight from the KTU portal — that needs the
            desktop app.
          </p>
        }>
          <form onSubmit={runKtu} class="ktu-form">
            <p class="fineprint">
              Or pull them straight from the KTU results portal — no download:
            </p>
            <label>
              KTU register number
              <input class="field-input" value={kuser()} placeholder="e.g. ABC24CS001"
                     autocomplete="username"
                     onInput={(e) => setKuser(e.currentTarget.value)} />
            </label>
            <label>
              KTU password
              <input class="field-input" type="password" value={kpass()}
                     autocomplete="current-password"
                     onInput={(e) => setKpass(e.currentTarget.value)} />
            </label>

            <Show when={canRemember()}>
              <label class="remember">
                <input type="checkbox" checked={kremember()}
                       onChange={(e) => setKremember(e.currentTarget.checked)} />
                <span>Remember this login on this device</span>
              </label>
            </Show>

            <div class="setup-actions">
              <button class="primary" type="submit" disabled={kbusy() || !kuser().trim()}>
                {kbusy() ? "Fetching…" : "Fetch from KTU"}
              </button>
            </div>

            <p class="fineprint">
              <Show when={canRemember() && kremember()} fallback={
                <>The KTU portal is read once for this fetch; the password is
                  never saved and the session stays inside the app.</>
              }>
                Kept in Windows Credential Manager for your account on this
                device — never in a backup, a log, or off this machine. Untick to
                forget it.
              </Show>
            </p>

            <Show when={kerror()}>
              <div class="notice bad"><strong>KTU sync failed.</strong> {kerror()}</div>
            </Show>
          </form>
        </Show>
      </div>
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
        Find out without signing in to anything. Open your portal's academics
        page in a browser, save it (Ctrl+S), and drop the file in here. TargetX
        reads it exactly as a sync would and tells you what it found.
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
             target="_blank" rel="noreferrer">Open an issue</a>
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
        Credits and mark patterns come from KTU's published curriculum, which is
        revised between batches. Updates without reinstalling.
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
          Stays on this computer. No account, no server, no telemetry —{" "}
          <a class="link" href="https://github.com/CodedRichy/TargetX/blob/main/PRIVACY.md"
             target="_blank" rel="noreferrer">the privacy statement</a>{" "}
          names the only three things that touch the network.
        </dd>
      </dl>
    </section>
  );
}

function Backup() {
  const [confirming, setConfirming] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  const stamp = () => new Date().toISOString().slice(0, 10);

  const restore = async (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      importJson(await file.text());
    } catch (exc) {
      alert(`Could not restore that file: ${String(exc)}`);
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
          computer.</strong> It cannot be undone, and TargetX has no copy of your
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
