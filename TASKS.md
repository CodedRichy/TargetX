# TargetX — open work

Compiled 2026-08-18 from four persona audits, and **re-verified against the
code on 2026-08-29** item by item. Of the roughly forty defects the audit
found, 21 are fixed, 5 are partly fixed and 14 are still open.

The re-verification matters more than the original audit did. The August list
had gone stale in the worst direction — it listed fixed defects as open, which
makes it useless as a release gate: a list you have learned to disbelieve stops
being read. Every item below was checked by reading the current code, not by
trusting a commit message.

Ordered by what would hurt a real student most. **Anything in "Blocking" is a
release blocker.**

---

## Blocking — wrong numbers presented as the university's

Every one of these puts a figure on screen that the student has no way to check
and no reason to doubt. That is the specific failure this product exists to
prevent, so shipping with it is worse than not shipping.

### The grade-card parser

Six defects in one file, `app/src/sync/gradecard.ts`. They compound: a card can
import with the wrong grades, in the wrong semesters, with the wrong credits,
and the SGPA cross-check that would have caught all three is itself broken.

- [ ] **The Result column is read as the grade.** The parser keeps the LAST
      grade-shaped token on the line, and KTU rows end with a Result column:
      `CST302 ... 4 A+ P` imports as **P**. With a supplementary marker,
      `... 4 P S3(S)` imports as **S** — a 10.0. Fix: take the token immediately
      before the Result/status column, and never read P/S/F there as a grade.
- [ ] **Credits are misread.** A zero-credit MCN course becomes 3 (`0` is
      treated as missing), and a mark of 8 or less can be scanned as the credit
      column. Every SGPA weight on the card is then wrong. Fix: read credits
      from a fixed column position; treat 0 as a real value.
- [ ] **A semester token on a course row reassigns that row and every row after
      it.** Whole blocks of courses land in the wrong semester. Fix: apply such
      a token to its own row only.
- [ ] **SGPA on a course row is never read.** The scan requires the line to
      carry no course code. So history is not written for those cards, and the
      published-vs-recomputed mismatch check — the one thing that would have
      caught the three defects above — can never fire. Fix this one first: it
      is the detector.
- [ ] **One course code per line, and `pdfToText` y-banding merges nearby
      rows**, so a merged line silently loses a course. Fix: loop all code
      matches per line, and tighten the band.
- [ ] **A row with no grade fabricates one from its title.** "Engineering
      Mathematics I" yields grade `I`. It no longer scores as a fail (I is
      Incomplete now), but a course that does not exist is still imported. Fix:
      require the grade token to sit after the credits column; skip otherwise.

### Data corruption

- [ ] **Pasting a marks page over synced data corrupts it.** `engine/parse.ts`
      maps the first three numbers to s1/s2/other, so a max-mark column is
      written as a mark, wrecking a CIE that was correct. Fix: validate the
      column shape, and show a diff before writing.
- [ ] **A partial sync rebuilds a semester from a subset.** `parseAcademics`
      drops subject rows with no attendance cell, and `applySync` then replaces
      the semester with what survived. Fix: parse rows without an attendance
      cell, and only replace when the page parsed as complete.
- [ ] **Duplicate course codes in one semester collapse.** `applySync` and
      `importPaste` still key a code-to-index map, last wins, so a re-registered
      backlog steals the marks of its twin. The grade-card path is fixed;
      `planForSgpa` was always position-keyed. Fix: key by position with the
      code as a tiebreak.
- [ ] **A paste leaves a stale `cie_override`.** New series marks change
      nothing on screen and the student trusts a superseded internal. Fix:
      clear the override on any course a marks paste writes to.
- [ ] **Sync reports success with zero courses.** A college whose tables have
      different headers gets a green "Synced", a written `lastSync`, and no
      data. The count is displayed now, but 0 still renders as success. Fix:
      fail the sync when nothing mapped, and never write `lastSync` there.
- [ ] **`creditsConfirmed` is still never written.** The manual credit
      correction the sync panel explicitly asks the student to make is wiped by
      the next sync. Fix: set it when the student edits `credits`.

### Catalogue

- [ ] **The S1 CSE preset is 15 credits, not 20.** `GXEST104`, `GXCYT122`,
      `UCHUT128`, `UCPWT127` and `UCHUT347` are in the credits map but in no
      branch table, so a first-year seeding from the preset has a wrong SGPA
      denominator on day one. Both copies of `curriculum.json`.
- [ ] **`GAPHT121` (Physics, 4cr) appears in both S1 and S2** and double-counts.

---

## Screens that contradict themselves

- [ ] **"Target is out of reach — no credits registered this semester"**, in
      red. That is missing data, not an unreachable target, and it reads as
      false despair on a first run. `engine/goals.ts:186`, `ui/Home.tsx:280`.
      Fix: a "not enough data" state, rendered as a prompt.
- [ ] **CGPA reads 0.00 for a student with no history.** The dash guard covers
      a completely empty document only; a student with a live semester and no
      past ones still sees 0.00. Fix: dash whenever `overall().credits === 0`.
- [ ] **Home tells a debarred student to attend N classes in a row.** Below 60%
      there is no condonation path under R 6.2. `ui/Ledger.tsx:501` already
      branches correctly; Home does not. Fix: branch on debarment first.
- [ ] **History and the launch check disagree about drift in [0.0095, 0.01)**
      because History rounds to 3dp before testing and `launch.ts` does not, so
      one screen flags a semester the other calls clean. Fix: one exported
      `driftsFrom(recomputed, published)` used by both.
- [ ] **Residual vertical scroll** — Data at 1440x900, Home at 1280x800. Not
      confirmed since the title bar was removed in `e7e63a8`; needs measuring
      at both sizes rather than reasoning about.

---

## Before a release

- [ ] Buy a Windows code-signing certificate. The plumbing is done and
      secret-gated; see [`SIGNING.md`](SIGNING.md). Until then Windows tells
      every student the publisher is unknown.
- [ ] Put the updater signing key into GitHub Actions secrets. Without it
      releases build but no installed copy will accept them.
- [ ] Show the version and the fault-log folder on the Data screen. The issue
      template and `PRIVACY.md` both already point students there.
- [ ] Tag v0.1.0 and publish the release — and remember a *draft* release is
      not "latest", so nobody is offered it until it is published.
- [ ] **Rotate the etlab password** that was pasted into a chat transcript.

## After a release

- [ ] **Test sync against a college that is not MITS.** Everything portal-side
      is n=1. This is the largest commercial risk in the project and no amount
      of local testing reduces it.
- [ ] Test the grade-card parser against a real KTU PDF. The six defects above
      were all found by reading; none of them were found by running it.
- [ ] Branch tables beyond CSE. Every non-CSE student currently has no preset.
- [ ] "Since you were last here" — snapshot on close, diff on open. The reason
      a student reopens the app.
- [ ] Opt-in "stay signed in" via Windows Credential Manager, enabling a real
      sync-on-open.
- [ ] Ctrl+K command palette — natural-language queries answered
      deterministically.
- [ ] Optional Gemini Flash Lite summary behind a Cloudflare Worker: key never
      shipped, per-install daily cap, one button rather than a chat, model
      phrases numbers it is given and never computes them. Check the free
      tier's data-retention terms first — this would be students' academic
      records.
- [ ] Tutor/HOD class view. The paid product, per the monetisation decision.

## Testing debt

The parity corpus is pinned to the buggy Python oracle in `legacy/`, and every
fix above makes the port disagree with it on purpose. The resolution taken: the
corpus stays frozen for the rules that did not change, and each corrected rule
is covered by a direct test that states the rule rather than the answer the
oracle gave. `engine/__tests__/core.test.ts` is where those live.

- [ ] The grade-card parser has no test that starts from real KTU card text.
      Every defect in the list above would have been caught by one.
