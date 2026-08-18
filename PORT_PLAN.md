# TargetX — port plan (Python/CTk → Tauri 2.0 + SolidJS)

Written 2026-08-18, and largely executed the same day.

| Phase | State |
|---|---|
| 1. Engine to TypeScript | **done** — 33 ported tests plus a 612-case differential parity corpus against the Python engine |
| 2. Scraper to TypeScript | **not started, and gated** — see below |
| 3. UI | **done** — Solid, no modals, hand-rolled SVG charts, 58KB bundle |
| Desktop shell | **done** — Tauri 2, 19MB binary, 4.5MB installer |

The one thing that has not moved is the gate: the scraper is still Python and
should stay that way until a second college has been tested.

## The decision

**Tauri 2.0 + SolidJS, engine ported to TypeScript. No Python at runtime.**

Rejected alternatives and why:

| Option | Why not |
|---|---|
| Stay customtkinter | Cannot do interactive charts. Modal-only dialogs. Look is the complaint. |
| Tauri + PyInstaller sidecar | Two binaries, 60–90MB, spawning a PyInstaller exe is a Windows Defender false-positive magnet. Kills distribution to classmates. Dead-ends on mobile. |
| Full Rust rewrite | Throws away scraper knowledge for no gain. |
| Flutter | Cannot reuse the web design direction; new language; desktop story weaker. |

TypeScript port costs ~1 week more than the sidecar and removes the second
runtime entirely. Mobile then becomes a repackage rather than a rewrite —
that is an option, not a commitment.

## Gate before starting

**Do not begin until `targetx_check.py` has run at a college that is not MITS.**

Everything in the scraper is validated against exactly one deployment. If
discovery fails elsewhere, the scraper design changes, and that must happen
before it is ported, not after.

The engine port (Phase 1) is safe to start regardless — it is pure logic and
does not touch the portal.

## Phase 1 — engine to TypeScript (no UI)

The tests are the spec. `test_core.py` has 40+ checks; port them first, to
Vitest, then make them pass. Do not port the implementation and "check it
looks right".

Port in this order, from `targetx.py`:

1. Constants: `GRADE_BANDS`, `GRADE_POINTS`, `COURSE_TYPES`, `TOTAL_PASS_MARK`,
   `ESE_PASS_FRACTION`, `ATTENDANCE_MIN`, `ATTENDANCE_CONDONE` (60.0),
   `DL_CAP_PCT` (10.0), `ATTENDANCE_MARK_BANDS`
2. `computeCie`, `eseCutoff`, `gradeForTotal`, `normaliseGrade`
3. `requiredEse` — both pass conditions, and the `binding` flag that drives the `*`
4. `evaluate` — including `assessed`, which is what keeps unassessed courses out of projections
5. `attendancePlan`, `attendanceMarks`, `nextAttendanceBand`
6. `summarise`, `sgpa`, `cgpaFromSemesters`
7. `inferCredits`, `verifyCredits`, `lookupCourse`
8. `requiredSgpaForCgpa`, `courseOptions`, `planForSgpa`

Rules that MUST survive the port — each was found the hard way:

- Both pass conditions apply. A large CIE cannot buy a pass. The `*` marker
  means the 40% ESE minimum is binding rather than the aggregate.
- Published values outrank recomputation, in three places: CIE
  (`cie_override`), grade (`portal_grade`), and SGPA (history). Recomputation
  is a cross-check that warns on mismatch.
- Absence is not zero. No CIE data → `PENDING`, excluded from projections and
  from at-risk counts.
- Attendance is worth CIE marks (Regulations 2024 R 7.5.ii). 85→5, 80→4,
  75→3, 70→2, 60→1, below→0.
- Pass/fail courses DO count in SGPA at 5.5. Verified against the portal.
- 2024 labs are 50/50, not 75/25. PBL courses are 60/40.
- Percentage = 10 × CGPA. No legacy −2.5.
- `planForSgpa` greedily minimises the DIFFICULTY OF THE RESULT, not total
  marks. Minimising marks produces plans demanding 60/60 in two papers.

## Phase 2 — scraper to TypeScript

Only after the gate. Port `etlab_sync.py`. Inside Tauri use the Rust HTTP
plugin, not `fetch` — native requests carry cookies and are not subject to
CORS, which is the whole reason this can stay on-device.

Preserve the discovery design; do not hardcode routes:

- Probe candidate login paths, score forms (username AND password = 2,
  password only = 1), take the best. A session-expired stub form scores 1 and
  must never capture credentials.
- Harvest every hidden input and POST to the form's own action. Handles both
  `YII_CSRF_TOKEN` (Yii1) and `_csrf` (Yii2). MITS has none at all.
- Read real routes off the dashboard links before falling back to candidates.
  Guessed internals paths 404'd on all six candidates at MITS.
- `/ktuacademics/student/studentacademics` is the primary source: every
  semester, attendance, internals, grades, SGPA/CGPA, and series marks.
- `/student/attendance` is the DAILY PERIOD GRID, not a summary. Do not parse
  it as attendance.
- Series marks live in a SIBLING detail row, not nested in the subject row.
- Use direct-children cell selection; a recursive one makes a row absorb the
  whole table.

Credentials: password used once, never persisted. Cookies stored separately
from the marks file — a session cookie is a bearer credential and the marks
file is something users export and share.

## Phase 3 — UI

Layout: header KPIs, dense subject grid, right drawer, no modals.

Non-modal replacements for the current dialogs:

| Today | Becomes |
|---|---|
| Sync/login modal | inline panel that slides down under the header |
| Help/legend modal | pinnable right drawer, stays open while scanning rows |
| (new) subject detail | inline expanding row — series marks, attendance, projection |
| Import/curriculum modal | Ctrl+K command palette |

Charts — ECharts (Apache-2.0), tree-shaken to line + gauge + scatter only
(~250–350KB gzipped). Sparklines inside table rows must be hand-rolled inline
SVG; an ECharts canvas per row janks at 40 rows.

Views worth building that do not exist today:
- SGPA trend across semesters (line)
- Goal progress (gauge) driven by `requiredSgpaForCgpa`
- Attendance vs internal marks (scatter) — visualises the R 7.5 thesis
- Per-subject projection strip in the expanded row

Visual direction:
- **Space Grotesk** headings/KPI numerals, **JetBrains Mono** grid data
  (tabular figures). Not Inter/Roboto/Arial.
- OKLCH dark-first. BG `oklch(0.09 0.01 250)`, surfaces in +0.05L steps.
  Primary **steel-teal** `oklch(0.75 0.12 195)` — deliberately NOT amber,
  because Torque already owns amber and reusing it blurs the two products.
- Amber `oklch(0.80 0.15 80)` reserved for attendance warnings only, green
  `oklch(0.75 0.16 145)` safe, red `oklch(0.63 0.26 25)` danger.
- Dense table: no zebra striping, hairline borders not gridlines, sticky
  header, right-aligned tabular numerals, hover-only row highlight.
- References worth stealing from: Linear (layers, palette), Vercel dashboard
  (inline mini-charts in tables), GitHub (row expansion).

## What stays Python

`curriculum_import.py`. It is a developer tool, run on demand against KTU's
curriculum PDFs, producing `curriculum.json`. That file is served from GitHub
raw and fetched by the app at launch, so the catalogue updates without
shipping a new binary. No user data, no server, no liability.

## Known-open items

- S1 recomputes 0.12 below the published SGPA — one first-year credit is
  wrong and the data admits six valid assignments. Needs a first-year
  student's record, or the S1 curriculum table read properly.
- `UCPWT127` is not in the CSE curriculum PDF; credits derived, not read.
- Everything scraper-side is n=1 (MITS only).
- No phone build. Deliberate. The architecture keeps it available.
