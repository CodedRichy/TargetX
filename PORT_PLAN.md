# TargetX — port plan (Python/CTk → Tauri 2.0 + SolidJS)

Written 2026-08-18, and largely executed the same day.

| Phase | State |
|---|---|
| 1. Engine to TypeScript | **done** — 33 ported tests plus a 612-case differential parity corpus against the Python engine |
| 2. Scraper to TypeScript | **done** — Rust transport + TS parsing; gate overridden by explicit instruction, see below |
| 3. UI | **done** — Solid, no modals, hand-rolled SVG charts, 106KB bundle + a lazy 433KB pdf chunk |
| Desktop shell | **done** — Tauri 2, 19MB binary, 4.5MB installer |
| Screen flow | **done** — setup → ledger / history / data, no modals anywhere |
| Python retired | **done** — moved to `legacy/`, see `legacy/README.md` |

**The gate was overridden, not met.** The scraper was ported on instruction
before a second college was tested, so every portal behaviour it encodes is
still validated against exactly one deployment (MITS). The port preserves each
of those behaviours verbatim; what it does not do is prove they generalise. The
first non-MITS run is still the real test, and if discovery fails there the
design changes — the port just means that change now happens in TypeScript.

## Feature parity against the Python build

Everything the Python build did, and where it now lives:

| Python | TypeScript | Notes |
|---|---|---|
| `targetx.py` engine | `src/engine/*` | 33 ported tests + 612-case differential corpus, byte-identical |
| `targetx.py` GUI | `src/ui/*` | rebuilt, not ported — no modals, charts are new |
| `etlab_sync.py` transport | `src-tauri/src/etlab.rs` | reqwest + cookie store; session never reaches the web layer |
| `etlab_sync.py` discovery/parsing | `src/sync/etlab.ts` | form scoring, hidden-input harvest, dashboard link discovery, sibling series rows |
| `ktu_import.py` | `src/sync/gradecard.ts` | paste, `.txt`/`.html`, and PDF via lazily-imported pdfjs |
| paste import | `src/engine/parse.ts` + Data screen | attendance and series modes, merged by code |
| catalogue update | `src/state/actions.ts` | same `curriculum.json` from GitHub raw |
| JSON backup/restore | Data screen | same shape, so a Python export restores into the Tauri app |
| text report | `reportText` | same columns |
| `curriculum_import.py` | **stays Python** | build-time tool, no runtime role |
| `targetx_check.py` | **stays Python** | portal probe, a diagnostic not a feature |

Added in the port, absent from Python: onboarding, a History screen (its
absence was why CGPA read 0.00), the SGPA trend, goal gauge, attendance/CIE
scatter, per-row attendance bars, credit cross-check reporting, and grade-card
mismatch reporting.

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

Done. `src-tauri/src/etlab.rs` is transport only; `src/sync/etlab.ts` holds the
discovery and parsing. Everything below was preserved and is the reason the file
looks more careful than it needs to. Inside Tauri use the Rust HTTP
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

Charts — ECharts was planned and dropped. Four chart types, all static, none
interactive beyond a hover: hand-rolled inline SVG costs ~200 lines and 0KB
against 250–350KB gzipped, and the row sparkbars had to be hand-rolled anyway.

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

`curriculum_import.py` and `targetx_check.py`, both now under `legacy/`. The
first is a developer tool, run on demand against KTU's
curriculum PDFs, producing `curriculum.json`. That file is served from GitHub
raw and fetched by the app at launch, so the catalogue updates without
shipping a new binary. No user data, no server, no liability.

## Known-open items

- S1 recomputes 0.12 below the published SGPA — one first-year credit is
  wrong and the data admits six valid assignments. Needs a first-year
  student's record, or the S1 curriculum table read properly.
- `UCPWT127` is not in the CSE curriculum PDF; credits derived, not read.
- Everything scraper-side is n=1 (MITS only), and the TypeScript port has not
  yet been run against a live portal at all.
- Five S1 course codes are missing from the catalogue, so the S1 CSE preset
  offers 15 credits where it should offer 20.
- No phone build. Deliberate. The architecture keeps it available.
