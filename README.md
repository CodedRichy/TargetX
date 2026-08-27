# TargetX

Desktop internal-mark tracker and target-grade engine for the **KTU 2024 scheme**.

Every other KTU calculator tells you what you already got. TargetX tells you the
mark you still need on the End Semester Exam — per subject, live, as you type.

### Running it

The app is being rebuilt as a Tauri desktop binary with the engine in
TypeScript. Both versions are in the tree while the port finishes.

```
cd app
npm install
npm run tauri dev      # desktop window
npm run dev            # or just the frontend in a browser
npm test               # engine tests, including parity with the Python original
```

The original Python build still runs and remains the reference implementation
for the calculation core — the TypeScript engine is held to it by a frozen
parity corpus:

```
pip install customtkinter requests beautifulsoup4
python targetx.py
```

`pypdf` is optional and only needed to read a grade-card PDF directly.

### Port status

| Piece | State |
|---|---|
| Calculation engine | Ported to TypeScript. Proven identical to Python across 612 generated course cases and 60 semester rollups (`tools/parity_dump.py`). |
| Interface | Rebuilt on Solid. No modal dialogs; hand-rolled SVG charts. |
| Desktop shell | Tauri 2. Single binary, no Python at runtime. |
| etlab sync | Ported. `sync/etlab.ts` does the discovery and parsing; `src-tauri/src/etlab.rs` owns the cookie jar and HTTP so no credential crosses into JS storage. Still validated against exactly one college — treat portal support as unproven anywhere else until a second campus confirms it. |

See `PORT_PLAN.md` for the full reasoning, including the alternatives that were
rejected and why.

---

## Why this exists — what the existing tools get wrong

| Prior art | Failure |
|---|---|
| Entri / typical web KTU calculators | Still on the 2019 model. Some apply the legacy `(10 × CGPA) − 2.5` percentage conversion; the 2024 scheme is **`% = 10 × CGPA`**, full stop. |
| Old GitHub CGPA repos (2014 / 2019 schemes) | Carry the retired **Low Pass (LP)** grade and its grade point. Under 2024 there is no LP band. |
| Mobile grade apps | Ask only for the final **letter grade** per subject. They cannot see a semester in progress, which is the only time a prediction is worth anything. |
| Spreadsheets | Model the aggregate `CIE + ESE ≥ 50` but silently ignore the **separate 40% ESE minimum**. That is the exact case where a student with a 38/40 internal is told "you only need 12" and then fails on the cutoff. |
| All of them | No target engine, no attendance eligibility, no persistence. |

TargetX fixes the four in order: correct 2024 rules, component-level CIE
granularity, a reverse-grade engine, and local persistence.

---

## The 2024 rules, as implemented

**Grade bands** (`total` = CIE + ESE, out of 100):

| Grade | Range | GP |  | Grade | Range | GP |
|---|---|---|---|---|---|---|
| S | 90–100 | 10 |  | C+ | 65–69 | 7.0 |
| A+ | 85–89 | 9.0 |  | C | 60–64 | 6.5 |
| A | 80–84 | 8.5 |  | D | 55–59 | 6.0 |
| B+ | 75–79 | 8.0 |  | P | 50–54 | 5.5 |
| B | 70–74 | 7.5 |  | F | <50 **or** ESE below cutoff | 0 |

**Two independent pass conditions — both must hold:**

1. `CIE + ESE ≥ 50`
2. `ESE ≥ 40%` of the ESE maximum → **24/60** or **20/50** or **10/25**

A `*` beside a required mark means condition 2 is what's binding, not the
aggregate. That asterisk is the whole point of the app.

**Course patterns** (per-subject, switchable in the grid):

| Type | CIE | ESE | ESE cutoff |
|---|---|---|---|
| `TH 40/60` | 40 | 60 | 24 |
| `TH 50/50` | 50 | 50 | 20 |
| `LAB 75/25` | 75 | 25 | 10 |
| `PRJ 100/0` | 100 | — | n/a |

`SGPA = Σ(Cᵢ × GPᵢ) / ΣCᵢ` · `CGPA` = credit-weighted across locked semesters ·
`Percentage = 10 × CGPA`.

Attendance: `< 75%` flags **SHORTAGE**, `< 65%` flags **DEBARRED**.

---

## Getting your data in

Four routes, strongest first:

**1. `Sync etlab` — live login.** Most KTU colleges run etlab. Enter the portal
URL, username and password; TargetX pulls attendance and internals in one shot.

The client *discovers* rather than assumes: it probes candidate login routes,
picks the form scoring highest (username **and** password present), harvests
every hidden input — so `YII_CSRF_TOKEN` (Yii1) and `_csrf` (Yii2) both work —
and POSTs to that form's own action. Data routes are probed the same way and a
page is only accepted if course codes actually appear in it.

Your password is never written to disk, never logged, and never included in an
export. Session cookies are held only in the Rust process's in-memory cookie jar
(`src-tauri/src/etlab.rs`) and are gone when you quit — a live cookie is a bearer
credential, so it never reaches storage your marks file could carry. Leave the
password blank to re-use the session from earlier in the same run.

**2. `Import from… → KTU grade card`.** Past semesters → real CGPA. KTU's own
portal is captcha- and OTP-gated, so TargetX does **not** try to script a login
there — that would be brittle and would put your account at risk. It parses the
grade card you already download (PDF or pasted text), then recomputes each SGPA
and **flags any semester where its own figure disagrees with the printed one** —
a mismatch means a row or credit value was misread, and you get told instead of
quietly getting a wrong CGPA.

**3. `Import from… → Public page URL`.** For college pages with no login.

**4. `Import from… → Paste a table`.** The universal fallback. Copy any table,
paste it. Works when a portal has a captcha, a VPN, or markup nobody predicted.

All four converge on **one** tolerant parser: find a course code on the line,
read the numbers after it. Same tested code path for every source.

---

## Course catalogue

Presets load from **`curriculum.json`** — data, not code. KTU revises codes
between admission batches and branch lists vary per college, so correct the file
once for your batch and it stays corrected. Format:

```json
["PCCST302", "Data Structures and Algorithms", 4, "TH 40/60"]
```

Ships with S1/S2 common, S3/S4 CSE, and blank scaffolds. Unknown codes coming in
from an import get their type inferred from the code (`…L###` → lab,
`PWS`/`…D###` → project) and you can override it per row.

---

## Using it

- **Add / remove semesters** freely; each keeps its own subject list.
- **Per subject**: code, name, credits, type, three CIE components on their raw
  scales (`/50`, `/50`, `/10`), attendance %, and actual ESE once you have it.
- **Live columns**: computed CIE, required ESE to pass, required ESE for the
  target grade you pick, predicted grade, and a status badge —
  `SAFE` / `TIGHT` / `SHORTAGE` / `DEBARRED` / `FAILED` / `UNREACHABLE`.
- **`Lock SGPA`** freezes a finished semester into history for CGPA maths.
- **`Export`** downloads a formatted `.txt` report, or the full state as `.json`
  for backup and transfer.
- Everything autosaves to browser storage (`localStorage`, key
  `targetx.state.v1`) 250 ms after you stop typing. Storage is per-machine and
  per-user: it does not sync, so keep a `.json` export if the data matters.

Two SGPA figures are shown on purpose. **Confirmed** counts only subjects with a
real ESE mark. **Projected** assumes you hit your target where it's reachable,
and the best grade still mathematically available where it isn't.

---

## Files

| File | Role |
|---|---|
| `app/src/engine/` | Calculation core (`evaluate`, `requiredEse`, `summarise`, `goals`, `targets`) |
| `app/src/sync/etlab.ts` | Authenticated etlab client, over a Rust transport |
| `app/src/sync/gradecard.ts` | Grade-card and public-page parsers |
| `app/src-tauri/src/etlab.rs` | Cookie jar and HTTP. In memory only, never a file |
| `app/src/data/curriculum.json` | Bundled course catalogue, refreshable from the repo |
| `localStorage["targetx.state.v1"]` | Your data. Autosaved. Not a file |
| `legacy/` | The retired Python original, kept as the parity oracle |

## Tests

```
python test_core.py    # grading, CIE scaling, reverse engine, parser  — 20 checks
python test_sync.py    # full login + scrape against a fake Yii portal — 16 checks
```

`test_sync.py` stands up a local server that deliberately uses a non-obvious
login route, a Yii1 CSRF field, and data routes that aren't first in the probe
list — so the discovery logic is actually exercised, not just the happy path.
