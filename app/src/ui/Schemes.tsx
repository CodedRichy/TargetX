import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { Letter } from "../engine/types";
import { KTU_2024 } from "../engine/scheme";
import type { Scheme } from "../engine/scheme";
import {
  activeProfile, allProfiles, createProfile, customProfiles, deleteProfile,
  importProfile, selectProfile, updateProfile,
} from "../state/schemes";
import { blankTemplate, exportScheme, importScheme } from "../engine/schemeIO";
import type { AttBandDraft, BandDraft } from "../engine/schemeDraft";
import { resolveDraft, toDraft } from "../engine/schemeDraft";

/**
 * Schemes: pick, author and retire scheme profiles.
 *
 * A profile is not a settings object, it is a claim about where its numbers
 * came from - see the comment on `Scheme` in `engine/scheme.ts`. So this
 * screen never lets an edit pass for the built-in: `KTU_2024` is checked
 * against the Regulations 2024 PDF and stays that way, and the only way onto
 * an editable copy is `createProfile`, same as `state/schemes.ts` enforces.
 *
 * The other half of the same ruling is that a copy must never LOOK verified
 * once it has been touched. `Scheme.source` survives a duplicate verbatim
 * (deliberately - a copy of KTU 2024 did start there), so this screen adds
 * its own badge on top rather than trusting that string: built-in gets
 * "Verified", every custom profile gets "Not verified", full stop, whatever
 * its `source` field still says.
 *
 * Course-type editing (the CIE/ESE component weights in `Scheme.courseTypes`)
 * is deliberately not here. The seam is `updateProfile(id, { courseTypes })`
 * - it takes the same patch shape as everything below - but authoring those
 * weights safely needs its own reachability/rescale story (see
 * `resolveSpec`'s comment) and that is a separate piece of work.
 */

const pct = (v: number) => `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;

/** One numeric cell, uncommitted until it leaves the box - never mid-keystroke. */
function NumField(props: {
  label: string; value: string; onChange: (v: string) => void; wide?: boolean;
}) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <input class={`cell-input num${props.wide ? " wide" : ""}`} value={props.value}
             onInput={(e) => props.onChange(e.currentTarget.value)} />
    </label>
  );
}

/**
 * The editor for one custom profile.
 *
 * Nothing here writes to the store as it is typed. Every keystroke updates
 * only the local draft; `resolveDraft` re-runs on every render and the errors
 * it finds are what decide whether Save is even clickable, so an incoherent
 * scheme can be typed and looked at but never lands where the engine reads
 * from.
 */
function ProfileEditor(props: { profile: Scheme; onDone: () => void }) {
  const [draft, setDraft] = createSignal(toDraft(props.profile));
  // Re-seed if the selection changes underneath this editor (e.g. the
  // profile it was open on got deleted from another tab of the app).
  createEffect(() => setDraft(toDraft(props.profile)));

  const resolved = createMemo(() => resolveDraft(draft()));
  const [saved, setSaved] = createSignal(false);

  const setBand = (i: number, patch: Partial<BandDraft>) =>
    setDraft((d) => ({
      ...d, gradeBands: d.gradeBands.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    }));

  const setAttBand = (i: number, patch: Partial<AttBandDraft>) =>
    setDraft((d) => ({
      ...d,
      attendanceMarkBands: d.attendanceMarkBands.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    }));

  const addAttBand = () => setDraft((d) => ({
    ...d, attendanceMarkBands: [...d.attendanceMarkBands, { minPct: "", marks: "" }],
  }));
  const removeAttBand = (i: number) => setDraft((d) => ({
    ...d, attendanceMarkBands: d.attendanceMarkBands.filter((_, j) => j !== i),
  }));

  const save = () => {
    const r = resolved();
    if (!r.patch) return;
    updateProfile(props.profile.id, r.patch);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div class="chart-block">
      <h4>Editing {props.profile.name}</h4>
      <p class="chart-note">
        Nothing below is written until you press Save, and Save refuses anything
        that would make the engine read the wrong grade.
      </p>

      <label class="field tight">
        <span>Profile name</span>
        <input class="cell-input name" value={draft().name}
               onInput={(e) => setDraft((d) => ({ ...d, name: e.currentTarget.value }))} />
      </label>

      <h4 style={{ "margin-top": "var(--s5)" }}>Grade bands</h4>
      <table>
        <thead>
          <tr><th class="left" scope="col">Letter</th>
              <th scope="col">Min %</th><th scope="col">Points</th></tr>
        </thead>
        <tbody>
          <For each={draft().gradeBands}>
            {(band, i) => (
              <tr class="row">
                <th class="left" scope="row">{band.letter}</th>
                <td><input class="cell-input num" value={band.minPct}
                           aria-label={`${band.letter} minimum percentage`}
                           onInput={(e) => setBand(i(), { minPct: e.currentTarget.value })} /></td>
                <td><input class="cell-input num" value={band.points}
                           aria-label={`${band.letter} grade points`}
                           onInput={(e) => setBand(i(), { points: e.currentTarget.value })} /></td>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      <div class="setup-actions wrap" style={{ "margin-top": "var(--s4)" }}>
        <NumField label="Total pass mark (/100)" value={draft().totalPassMark}
                  onChange={(v) => setDraft((d) => ({ ...d, totalPassMark: v }))} />
        <NumField label="Exam (ESE) minimum, %" value={draft().esePassPct}
                  onChange={(v) => setDraft((d) => ({ ...d, esePassPct: v }))} />
      </div>

      <h4 style={{ "margin-top": "var(--s5)" }}>Attendance</h4>
      <div class="setup-actions wrap">
        <NumField label="Eligibility minimum, %" value={draft().attendanceMin}
                  onChange={(v) => setDraft((d) => ({ ...d, attendanceMin: v }))} />
        <NumField label="Condonation floor, %" value={draft().attendanceCondone}
                  onChange={(v) => setDraft((d) => ({ ...d, attendanceCondone: v }))} />
        <NumField label="Duty-leave cap, pts" value={draft().dlCapPct}
                  onChange={(v) => setDraft((d) => ({ ...d, dlCapPct: v }))} />
        <NumField label="Full attendance marks" value={draft().attendanceMarkMax}
                  onChange={(v) => setDraft((d) => ({ ...d, attendanceMarkMax: v }))} />
      </div>

      <p class="chart-note" style={{ "margin-top": "var(--s4)" }}>
        Attendance mark bands - the lowest percentage that still earns each mark count.
      </p>
      <table>
        <thead>
          <tr><th scope="col">Min %</th><th scope="col">Marks</th>
              <th scope="col"><span class="sr-only">Remove band</span></th></tr>
        </thead>
        <tbody>
          <For each={draft().attendanceMarkBands}>
            {(band, i) => (
              <tr class="row">
                <td><input class="cell-input num" value={band.minPct}
                           aria-label={`Attendance band ${i() + 1} minimum percentage`}
                           onInput={(e) => setAttBand(i(), { minPct: e.currentTarget.value })} /></td>
                <td><input class="cell-input num" value={band.marks}
                           aria-label={`Attendance band ${i() + 1} marks`}
                           onInput={(e) => setAttBand(i(), { marks: e.currentTarget.value })} /></td>
                <td class="row-remove">
                  <button class="link" onClick={() => removeAttBand(i())}
                          aria-label={`Remove attendance band ${i() + 1}`}>Remove</button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <button class="link" onClick={addAttBand}>Add a band</button>

      <Show when={resolved().errors.length > 0}>
        <div class="notice bad" role="alert">
          <strong>
            {resolved().errors.length === 1 ? "This can't be saved yet." : "These can't be saved yet."}
          </strong>
          <ul>
            <For each={resolved().errors}>{(e) => <li>{e}</li>}</For>
          </ul>
        </div>
      </Show>

      <div class="setup-actions">
        <button class="primary" disabled={!resolved().patch} onClick={save}>Save changes</button>
        <button class="ghost" onClick={props.onDone}>Done</button>
        <Show when={saved()}><span class="fineprint">Saved.</span></Show>
      </div>
    </div>
  );
}

/** One row of the profile list: pick it, copy it, edit or drop it. */
function ProfileRow(props: {
  profile: Scheme; isActive: boolean; editing: boolean;
  onUse: () => void; onEdit: () => void; onDuplicate: (name: string) => void;
  onDelete: () => void;
}) {
  const [duplicating, setDuplicating] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  const [copyName, setCopyName] = createSignal(`${props.profile.name} copy`);
  const [sharing, setSharing] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  // Clipboard access is not guaranteed - a webview can refuse it, and the
  // permission is not worth a prompt. The textarea stays on screen either
  // way, so the fallback is the thing that was always there: select it.
  const copy = () => {
    void navigator.clipboard?.writeText(exportScheme(props.profile))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => setCopied(false));
  };

  return (
    <div class="chart-block" classList={{ promoted: props.isActive }}>
      <div class="setup-actions wrap" style={{ "justify-content": "space-between", "margin-top": 0 }}>
        <div>
          <strong>{props.profile.name}</strong>{" "}
          <Show when={props.profile.builtIn} fallback={
            <span class="pill mine">not verified</span>
          }>
            <span class="pill safe">verified</span>
          </Show>
          <Show when={props.isActive}><span class="pill mine">active</span></Show>
          <p class="fineprint">{props.profile.source}</p>
        </div>
        <div class="setup-actions">
          <Show when={!props.isActive}>
            <button class="ghost" onClick={props.onUse}>Use this</button>
          </Show>
          <Show when={!duplicating()} fallback={
            <span class="setup-actions">
              <input class="cell-input name mid" value={copyName()}
                     aria-label={`Name for the copy of ${props.profile.name}`}
                     onInput={(e) => setCopyName(e.currentTarget.value)} />
              <button class="primary" disabled={!copyName().trim()}
                      onClick={() => { props.onDuplicate(copyName().trim()); setDuplicating(false); }}>
                Make copy
              </button>
              <button class="link" onClick={() => setDuplicating(false)}>Cancel</button>
            </span>
          }>
            <button class="ghost" onClick={() => setDuplicating(true)}>Duplicate</button>
          </Show>
          <button class="ghost" aria-pressed={sharing()}
                  title="Show this profile as a file you can send to someone"
                  onClick={() => setSharing((v) => !v)}>
            {sharing() ? "Hide file" : "Share"}
          </button>
          <Show when={!props.profile.builtIn}>
            <button class="ghost" onClick={props.onEdit} aria-pressed={props.editing}>
              {props.editing ? "Editing…" : "Edit"}
            </button>
            <Show when={!confirming()} fallback={
              <span class="confirm-inline" role="group" aria-label={`Delete ${props.profile.name}?`}>
                <span class="fineprint">Delete this profile?</span>
                <button class="link remove-go" onClick={props.onDelete}>Delete</button>
                <button class="link" onClick={() => setConfirming(false)}>Keep</button>
              </span>
            }>
              <button class="danger" onClick={() => setConfirming(true)}>Delete</button>
            </Show>
          </Show>
        </div>
      </div>
      <Show when={sharing()}>
        <div class="transfer">
          <p class="chart-note">
            Send this to anyone at your college and they can import it below.
            It carries the numbers, not your marks - no subject, no attendance,
            nothing you have typed into the app.
          </p>
          <textarea class="paste mono" readonly rows="8" value={exportScheme(props.profile)}
                    aria-label={`${props.profile.name} as a file`}
                    onFocus={(e) => e.currentTarget.select()} />
          <div class="setup-actions">
            <button class="ghost" onClick={copy}>Copy</button>
            <Show when={copied()}><span class="fineprint">Copied.</span></Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

/**
 * Taking in a profile from somewhere else.
 *
 * Paste rather than a file picker, deliberately: the app already asks a
 * student to paste a saved page on the Data tab, the same box works in the
 * browser build where there is no filesystem to reach, and a profile arrives
 * through chat far more often than as a saved file.
 *
 * Nothing is written until Import is pressed and `importScheme` has returned
 * no errors, and the errors are shown in full rather than a count - the file
 * came from a classmate, so the useful outcome is that it can be fixed.
 */
function ImportBlock() {
  const [text, setText] = createSignal("");
  const [errors, setErrors] = createSignal<string[]>([]);
  const [done, setDone] = createSignal<string | null>(null);

  const run = () => {
    const result = importScheme(text());
    setErrors(result.errors);
    if (!result.scheme) return;
    const added = importProfile(result.scheme);
    setText("");
    setDone(added.name);
    setTimeout(() => setDone(null), 4000);
  };

  const startBlank = () => {
    const added = importProfile(blankTemplate());
    setDone(added.name);
    setTimeout(() => setDone(null), 4000);
  };

  return (
    <div class="chart-block">
      <h4>Bring in a profile</h4>
      <p class="chart-note">
        Paste a profile someone sent you. It arrives as yours and unverified,
        whatever the file says - nobody here has checked those numbers either.
      </p>
      <textarea class="paste" rows="6" value={text()} aria-label="Paste a scheme file"
                placeholder={'{ "format": "targetx.scheme", ... }'}
                onInput={(e) => setText(e.currentTarget.value)} />
      <Show when={errors().length > 0}>
        <div class="notice bad" role="alert">
          <strong>This file was not used.</strong>
          <ul><For each={errors()}>{(e) => <li>{e}</li>}</For></ul>
        </div>
      </Show>
      <div class="setup-actions">
        <button class="primary" disabled={!text().trim()} onClick={run}>Import</button>
        <button class="ghost" title="Start from KTU's structure with every number still to replace"
                onClick={startBlank}>
          Start a blank one
        </button>
        <Show when={done()}>
          {(name) => <span class="fineprint">Added {name()}, and switched to it.</span>}
        </Show>
      </div>
    </div>
  );
}

/**
 * Schemes screen.
 *
 * Reachable like every other view - see `nav.ts` and the tab row in
 * `App.tsx` - because a profile is not a one-time setup choice: a college's
 * own rules can change mid-year, and the exit back to KTU 2024 has to be as
 * easy to find as the way in.
 */
export function Schemes() {
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const editingProfile = createMemo(() =>
    customProfiles().find((p) => p.id === editingId()) ?? null);

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h2>Schemes</h2>
          <p class="lede">
            The rules TargetX computes with. KTU 2024 is checked against the
            Regulations 2024 PDF; anything you build from it is yours, and is
            marked as yours everywhere it appears.
          </p>
        </div>
        <button class="ghost" disabled={activeProfile().id === KTU_2024.id}
                title="Go back to the verified KTU 2024 profile"
                onClick={() => selectProfile(KTU_2024.id)}>
          Back to KTU 2024
        </button>
      </div>

      <div class="chart-block">
        <h4>Currently computing with</h4>
        <p class="readout">
          <strong>{activeProfile().name}</strong>{" "}
          <Show when={activeProfile().builtIn} fallback={<span class="pill mine">not verified</span>}>
            <span class="pill safe">verified</span>
          </Show>
        </p>
        <p class="chart-note">
          <Show when={activeProfile().builtIn} fallback={
            <>Your own edit. Started from: {activeProfile().source}. No one has
              checked these numbers against a regulation - the pass mark shown
              on the Targets tab is only as right as what you typed here.</>
          }>
            {activeProfile().source}
          </Show>
        </p>
      </div>

      <For each={allProfiles()}>
        {(profile) => (
          <ProfileRow
            profile={profile}
            isActive={activeProfile().id === profile.id}
            editing={editingId() === profile.id}
            onUse={() => selectProfile(profile.id)}
            onDuplicate={(name) => {
              const copy = createProfile(profile.id, name || `${profile.name} copy`);
              setEditingId(copy.id);
            }}
            onEdit={() => setEditingId(editingId() === profile.id ? null : profile.id)}
            onDelete={() => { if (editingId() === profile.id) setEditingId(null); deleteProfile(profile.id); }}
          />
        )}
      </For>

      <Show when={editingProfile()}>
        {(profile) => <ProfileEditor profile={profile()} onDone={() => setEditingId(null)} />}
      </Show>

      <ImportBlock />
    </div>
  );
}
