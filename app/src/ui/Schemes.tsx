import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { Letter } from "../engine/types";
import { KTU_2024 } from "../engine/scheme";
import type { Scheme } from "../engine/scheme";
import {
  activeProfile, allProfiles, createProfile, customProfiles, deleteProfile,
  selectProfile, updateProfile,
} from "../state/schemes";

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

// --- draft: every number as the string a text box holds -------------------

interface BandDraft { letter: Letter; minPct: string; points: string }
interface AttBandDraft { minPct: string; marks: string }

interface Draft {
  name: string;
  gradeBands: BandDraft[];
  totalPassMark: string;
  /** A percentage in the box; `Scheme.esePassFraction` is the fraction. */
  esePassPct: string;
  attendanceMin: string;
  attendanceCondone: string;
  dlCapPct: string;
  attendanceMarkBands: AttBandDraft[];
  attendanceMarkMax: string;
}

function toDraft(s: Scheme): Draft {
  return {
    name: s.name,
    gradeBands: s.gradeBands.map((b) => ({
      letter: b.letter, minPct: String(b.minPct), points: String(b.points),
    })),
    totalPassMark: String(s.totalPassMark),
    esePassPct: String(s.esePassFraction * 100),
    attendanceMin: String(s.attendanceMin),
    attendanceCondone: String(s.attendanceCondone),
    dlCapPct: String(s.dlCapPct),
    attendanceMarkBands: s.attendanceMarkBands.map((b) => ({
      minPct: String(b.minPct), marks: String(b.marks),
    })),
    attendanceMarkMax: String(s.attendanceMarkMax),
  };
}

const asNumber = (raw: string): number | null => {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * Validate a draft and, only when it is coherent, build the patch that would
 * be written.
 *
 * Every rule here exists because the engine reads the field it guards without
 * re-checking it - `gradeForTotal` (engine/grade.ts) returns the FIRST band
 * whose `minPct` a total clears, so an out-of-order or overlapping list does
 * not fail loudly, it quietly hands out the wrong letter. That is the one
 * failure mode this form must make impossible rather than merely unlikely, so
 * a bad value is refused here rather than reaching `updateProfile`.
 */
function resolveDraft(d: Draft): { errors: string[]; patch?: Partial<Omit<Scheme, "id" | "builtIn">> } {
  const errors: string[] = [];

  if (!d.name.trim()) errors.push("Give this profile a name.");

  // Grade bands must be strictly descending by minPct and cover [0, 100] with
  // no letter repeated - `gradeForTotal`'s first-match walk depends on it, and
  // `gradePoints()` depends on unique letters.
  const seenLetters = new Set<string>();
  const gradeBands = d.gradeBands.map((b, i) => {
    const minPct = asNumber(b.minPct);
    const points = asNumber(b.points);
    if (minPct === null || minPct < 0 || minPct > 100) {
      errors.push(`${b.letter}: minimum % must be a number from 0 to 100.`);
    }
    if (points === null || points < 0) {
      errors.push(`${b.letter}: grade points must be zero or more.`);
    }
    if (seenLetters.has(b.letter)) errors.push(`${b.letter} is listed twice.`);
    seenLetters.add(b.letter);
    if (i > 0) {
      const prev = asNumber(d.gradeBands[i - 1]!.minPct);
      if (minPct !== null && prev !== null && minPct >= prev) {
        errors.push(
          `${b.letter}'s minimum (${b.minPct}%) must be lower than `
          + `${d.gradeBands[i - 1]!.letter}'s (${d.gradeBands[i - 1]!.minPct}%) - `
          + `the bands are read top to bottom and the first match wins.`,
        );
      }
      if (points !== null && prev !== null) {
        const prevPoints = asNumber(d.gradeBands[i - 1]!.points);
        if (prevPoints !== null && points >= prevPoints) {
          errors.push(
            `${b.letter} should carry fewer grade points than `
            + `${d.gradeBands[i - 1]!.letter} - it is the lower grade.`,
          );
        }
      }
    }
    return { letter: b.letter, minPct: minPct ?? 0, points: points ?? 0 };
  });

  const totalPassMark = asNumber(d.totalPassMark);
  if (totalPassMark === null || totalPassMark < 0 || totalPassMark > 100) {
    errors.push("Pass mark must be a number from 0 to 100.");
  }
  const lowestBand = d.gradeBands.length
    ? d.gradeBands.reduce((a, b) => (asNumber(b.minPct)! < asNumber(a.minPct)! ? b : a))
    : null;
  if (lowestBand && totalPassMark !== null) {
    const lowestPct = asNumber(lowestBand.minPct);
    if (lowestPct !== null && Math.abs(lowestPct - totalPassMark) > 0.001) {
      errors.push(
        `The pass mark (${d.totalPassMark}) does not match your lowest passing `
        + `grade, ${lowestBand.letter} at ${lowestBand.minPct}% - a total between `
        + `the two would pass without earning any letter.`,
      );
    }
  }

  const esePassPct = asNumber(d.esePassPct);
  if (esePassPct === null || esePassPct < 0 || esePassPct > 100) {
    errors.push("Exam minimum must be a percentage from 0 to 100.");
  }

  const attendanceMin = asNumber(d.attendanceMin);
  if (attendanceMin === null || attendanceMin < 0 || attendanceMin > 100) {
    errors.push("Attendance eligibility must be a percentage from 0 to 100.");
  }
  const attendanceCondone = asNumber(d.attendanceCondone);
  if (attendanceCondone === null || attendanceCondone < 0 || attendanceCondone > 100) {
    errors.push("Condonation floor must be a percentage from 0 to 100.");
  }
  if (attendanceMin !== null && attendanceCondone !== null && attendanceCondone > attendanceMin) {
    errors.push("Condonation floor must be at or below the eligibility minimum, not above it.");
  }

  const dlCapPct = asNumber(d.dlCapPct);
  if (dlCapPct === null || dlCapPct < 0 || dlCapPct > 100) {
    errors.push("Duty-leave cap must be a percentage from 0 to 100.");
  }

  const attendanceMarkMax = asNumber(d.attendanceMarkMax);
  if (attendanceMarkMax === null || attendanceMarkMax < 0) {
    errors.push("Full attendance marks must be zero or more.");
  }

  const attendanceMarkBands = d.attendanceMarkBands.map((b, i) => {
    const minPct = asNumber(b.minPct);
    const marks = asNumber(b.marks);
    const row = i + 1;
    if (minPct === null || minPct < 0 || minPct > 100) {
      errors.push(`Attendance band ${row}: minimum % must be a number from 0 to 100.`);
    }
    if (marks === null || marks < 0) {
      errors.push(`Attendance band ${row}: marks must be zero or more.`);
    }
    if (attendanceMarkMax !== null && marks !== null && marks > attendanceMarkMax) {
      errors.push(`Attendance band ${row}: ${b.marks} marks exceeds the full ${d.attendanceMarkMax}.`);
    }
    if (i > 0) {
      const prevMin = asNumber(d.attendanceMarkBands[i - 1]!.minPct);
      const prevMarks = asNumber(d.attendanceMarkBands[i - 1]!.marks);
      if (minPct !== null && prevMin !== null && minPct >= prevMin) {
        errors.push(`Attendance band ${row}'s minimum must be lower than band ${row - 1}'s - they are read top to bottom.`);
      }
      if (marks !== null && prevMarks !== null && marks >= prevMarks) {
        errors.push(`Attendance band ${row} should pay fewer marks than band ${row - 1} - it is the lower band.`);
      }
    }
    return { minPct: minPct ?? 0, marks: marks ?? 0 };
  });

  if (errors.length > 0) return { errors };

  return {
    errors,
    patch: {
      name: d.name.trim(),
      gradeBands,
      totalPassMark: totalPassMark!,
      esePassFraction: esePassPct! / 100,
      attendanceMin: attendanceMin!,
      attendanceCondone: attendanceCondone!,
      dlCapPct: dlCapPct!,
      attendanceMarkBands,
      attendanceMarkMax: attendanceMarkMax!,
    },
  };
}

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
              <input class="cell-input" value={copyName()}
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
    </div>
  );
}
