import { Show, createSignal } from "solid-js";
import { catalogueVersion } from "../engine";
import {
  applyGradeCard, download, exportJson, importJson, importPaste, reportText,
  resetEverything, updateCatalogue,
} from "../state/actions";
import { rows, state, summary } from "../state/store";
import { canSync } from "../sync/etlab";
import { parseGradeCard, pdfToText } from "../sync/gradecard";
import { SyncPanel } from "./SyncPanel";

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
        <Catalogue />
        <Backup />
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

  const run = () => {
    if (!text().trim()) return;
    const outcome = importPaste(text(), mode());
    setNote(`Updated ${outcome.matched} subject${outcome.matched === 1 ? "" : "s"}`
      + (outcome.added ? `, added ${outcome.added} new` : "") + ".");
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

      <div class="seg">
        <button classList={{ on: mode() === "attendance" }}
                onClick={() => setMode("attendance")}>Attendance</button>
        <button classList={{ on: mode() === "marks" }}
                onClick={() => setMode("marks")}>Series marks</button>
      </div>

      <textarea class="paste num" rows="4" value={text()}
                placeholder={mode() === "attendance"
                  ? "PCCST501  Computer Networks  41  48  85.4%"
                  : "PCCST501  Computer Networks  38  31  8"}
                onInput={(e) => setText(e.currentTarget.value)} />

      <div class="setup-actions">
        <button class="primary" disabled={!text().trim()} onClick={run}>Import</button>
        <Show when={note()}><span class="fineprint">{note()}</span></Show>
      </div>
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
        Open your grade card from the KTU results portal and drop the PDF in, or
        paste the table. Grades, credits and the printed SGPA of every semester
        on it are read at once - this is the fastest way to fill in your past.
      </p>

      <textarea class="paste num" rows="3" value={text()}
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

      <Show when={confirming()} fallback={
        <button class="danger" onClick={() => setConfirming(true)}>Erase everything</button>
      }>
        <div class="notice bad">
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
