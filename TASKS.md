# TargetX — open work

Compiled 2026-08-18 from four persona audits of the codebase (a first-year on
first run, an S5 student mid-semester, a backlog student with an F and a
re-registered course, and a student at a non-MITS college whose sync fails).
Roughly forty defects, **none of them caught by the 36 passing tests** — the
suite proves the TypeScript matches the Python, and the Python has the same
bugs. That is the ceiling of differential testing against a flawed oracle.

Ordered by what would hurt a real student most. Anything in P0 or P1 is a
release blocker.

---

## P0 — the numbers are wrong

- [ ] **Attendance is never folded into CIE.** `engine/cie.ts:34`, `engine/constants.ts:77`.
      `TH 40/60` components are s1 15 + s2 15 + other 10 = 40, which already
      saturates `cieMax`; `computeCie` never calls `attendanceMarks`. Two courses
      at 45% and 90% attendance compute identically. This is R 7.5.ii — the
      product's entire thesis — displayed in a column and absent from the
      arithmetic. Every `requiredEse` where the aggregate binds is understated by
      up to 5 marks. Fix: attendance becomes a fourth CIE component, with the
      others rescaled so the spec still totals `cieMax`, and an `attMax` per
      course type in `CourseSpec`.

- [ ] **Target CGPA is solved as though graduation were this semester.**
      `engine/goals.ts:37`. 92 credits at 7.09 targeting 8.0 needs 11.99 this
      semester → "out of reach", and `goalPlan` goes null so the cheapest-route
      panel disappears. Over the real horizon to S8 it is 9.13. The codebase has
      no notion of a horizon at all. Fix: solve over remaining credits to S8
      using the curriculum's per-semester totals; report the per-semester SGPA
      needed; declare impossible only when it exceeds 10 across all remaining
      credits.

- [ ] **Missing attendance is invented as 100%.** `engine/evaluate.ts:20`
      (`toFloat(course.attendance, 100)`). A blank field renders 100%, a full
      bar and 5/5 attendance marks. Absence-is-not-zero, inverted in the file
      that enforces it. Also makes `Home.tsx:59`'s null guard dead code and the
      "No attendance recorded yet" state unreachable. Fix: `toOptionalFloat`,
      no default, render as a dash.

- [ ] **One ungraded lab kills the whole plan.** `engine/goals.ts:71,138,203`.
      `courseOptions` ignores `ev.assessed`, so an unassessed `PBL 60/40` needs
      50 of 40 → impossible at every letter → `planForSgpa` returns
      `{reachable:false}` for every target. `evaluate.ts:61` already has this
      guard with a comment calling the alternative "a straight falsehood".

- [ ] **Debarred courses are projected and planned as passes.**
      `engine/evaluate.ts:159`, `engine/goals.ts:71`. A subject at 45% still
      contributes its target grade to `sgpaProjected`, and the plan instructs a
      mark in an exam the student cannot sit.

- [ ] **A blank `PRJ 100/0` course is graded F.** `engine/evaluate.ts:41`.
      `eseMax === 0` fires with no data → total 0 → F, folded into *confirmed*
      SGPA. Hits the S1, S7 and S8 presets. Fix: that branch must require
      `assessed`.

- [ ] **History stores earned credits where the CGPA needs registered credits.**
      `sync/etlab.ts:550`, `state/actions.ts:161`, `sync/gradecard.ts:136`.
      KTU computes SGPA over registered credits. A traced S3 card with one F
      gives CGPA 7.417 instead of 7.15. Every semester containing a backlog is
      mis-weighted. Fix: store registered credits; keep earned separately if
      wanted for display.

- [ ] **A published grade can display as UNREACHABLE.** `engine/evaluate.ts:100,104`.
      `statusFor` tests `needPass.possible` before checking for a grade, and a
      grade-card import carries no CIE. A finished `LAB 75/25` with grade A shows
      UNREACHABLE; a published P on `TH 40/60` shows TIGHT. `summarise` guards
      this correctly at :164 — same rule, two implementations, one wrong.

- [ ] **Duty-leave credit is frozen at today's `held`.** `engine/attendance.ts:110`.
      The cap should grow as classes are held. Traced: app says 20 classes, truth
      is 15 — 33% too many, for exactly the students told their extra DL is
      wasted.

- [ ] **Grades I and W are scored as F.** `engine/grade.ts:21`. KTU excludes
      Incomplete and Withdrawn from the denominator until completed. Fix: a third
      state that drops out of both numerator and denominator.

## P1 — data loss and corruption

- [ ] **A supplementary grade card deletes the rest of the semester.**
      `state/actions.ts:144`. `applyGradeCard` replaces `semesters[name]`
      wholesale, keeping only codes on the card. The doc comment claims it
      merges. It does not.

- [ ] **Pasting a marks page over synced data corrupts it.** `engine/parse.ts:64`,
      `state/actions.ts:107`. Marks mode maps the first three numbers to
      s1/s2/other, so max-mark columns are written as marks. Fix: validate the
      column shape, or show a diff to confirm.

- [ ] **Duplicate course codes in one semester collapse.** `state/actions.ts:35,90,142`.
      The code→index map keeps the last occurrence, so a re-registered backlog
      steals its twin's marks. (`planForSgpa` is correctly position-keyed and is
      not affected — that part of the port held.)

- [ ] **`creditsConfirmed` is never set anywhere in the codebase.**
      `state/actions.ts:47`, `ui/Ledger.tsx:157`. So the manual credit correction
      the sync panel explicitly tells students to make is wiped by the next sync.

- [ ] **`importPaste` never clears `cie_override`.** After a sync, pasted series
      marks change s1/s2 but `computeCie` keeps returning the stale override, so
      the paste appears to do nothing.

- [ ] **Blank credits in History become 0 and zero the CGPA.** `ui/History.tsx:141`.
      `Number("")` is 0, not NaN, so the guard passes.

- [ ] **`importJson` merges instead of replacing.** `state/actions.ts:246`. A
      backup without `history` leaves the current history in place, producing a
      hybrid document. No version check either.

- [ ] **A partial sync silently rebuilds a semester from a subset.**
      `state/actions.ts:37`, `sync/etlab.ts:219` drops subject rows with no
      attendance cell. Fix: only replace when the page parsed as complete.

- [ ] **Sync "succeeds" with zero courses.** `sync/etlab.ts:443` counts semesters,
      not courses, so a college with different table headers gets a green result,
      a written `lastSync`, and no data.

## P2 — security

Confirmed clean: the password is never persisted, logged, or exported — traced
from the signal through the Rust session, `AppState`, `persist` and `exportJson`.

- [ ] **The password is only cleared on success.** `ui/SyncPanel.tsx:50`. Every
      failed sync leaves it live in the signal and the DOM. Clear in `finally`.
- [ ] **An explicit `http://` URL is preserved.** `sync/etlab.ts:41`. The password
      is then POSTed in cleartext. Force https; fall back only on confirmation.
- [ ] **The login form's `action` is followed to any origin.** `sync/etlab.ts:345`.
      A third-party or injected form action receives the credentials. Require
      same-origin.
- [ ] **Form scoring does not prevent the stub case its comment claims.**
      `sync/etlab.ts:352`. A stub with a password box plus any text input (a
      captcha field) scores 2 and binds the captcha as the username. Never POST a
      score-1 form; match the username field by name (`user`, `login`, `admn`,
      `reg`).
- [ ] **`looksLoggedIn` matches the substring "logout" anywhere.** `sync/etlab.ts:359`.
      A login page with a cached nav reports success.

## P3 — grade card parser

- [ ] "Keep the LAST grade token" reads KTU's Result column: `CST302 … 4 A+ P`
      imports as **P**. With a supplementary marker, `… 4 P S3(S)` imports as
      **S** with SGPA 10. `sync/gradecard.ts:93`.
- [ ] A row with no grade fabricates one from the title: `MAT101 Engineering
      Mathematics I 4` → grade **I** → a fail. `sync/gradecard.ts:93`.
- [ ] Zero-credit MCN courses become 3 credits (`0` is treated as missing);
      a mark column can be read as credits. `sync/gradecard.ts:99-104`.
- [ ] A semester token anywhere on a course row reassigns the semester for that
      row and every row after it. `sync/gradecard.ts:24,116`.
- [ ] Only the first course code per line is read, and `pdfToText` y-banding
      merges nearby rows, so a merged line loses a course. `sync/gradecard.ts:71,168`.
- [ ] SGPA on a course row is missed entirely, so history is never written and
      the mismatch check can never fire. `sync/gradecard.ts:81`.

## P4 — catalogue data

- [ ] Five S1 codes exist in the credits map but in no branch table, so the S1
      CSE preset is 15 credits instead of 20: `GXEST104`, `GXCYT122`, `UCHUT128`,
      `UCPWT127`, `UCHUT347`.
- [ ] `GAPHT121` (Physics, 4cr) appears in **both** S1 and S2 and double-counts.
- [ ] Only one branch exists. CSE is the whole catalogue.

## P5 — screens that contradict themselves

- [ ] Home prints "projecting **0.00** — short by 8.50" in red, three cards above
      "excluded from both numbers rather than counted as zero". The gauge is
      right and the sentence beside it is wrong. `ui/Home.tsx:104,164`.
- [ ] CGPA renders 0.00 for a student with no history. `ui/Home.tsx:32,140`,
      `ui/App.tsx:29`.
- [ ] A debarred subject gets an amber "120 classes in a row to be eligible";
      below 60% there is no condonation path under R 6.2. `ui/Home.tsx:89`.
- [ ] The credit cross-check cannot detect a *missing* course, which is the
      failure mode the catalogue actually has. `ui/History.tsx:44`,
      `state/launch.ts:58`.
- [ ] History and the launch check disagree about drift in [0.0095, 0.01)
      because one rounds first. One shared helper.
- [ ] `dlWasted` prints "14.5 days" — it is classes, and it is rounded to 2dp.
      `ui/Ledger.tsx:113`.
- [ ] "Target is out of reach — no credits registered this semester" is missing
      data, not an unreachable target, and is styled as an error. `engine/goals.ts:165`.
- [ ] Data screen still scrolls 140px at 1440x900; Home scrolls at 1280x800.

## P6 — before anyone can install it

- [ ] Write `PRIVACY.md` — no server, no account, no telemetry, local only.
      Link it from the Data screen.
- [ ] Write the README.
- [ ] Tag v0.1.0 and publish the NSIS installer as a GitHub release.
- [ ] Rotate the etlab password that was pasted into a chat transcript.

## P7 — after the release

- [ ] Test sync against a college that is not MITS. Everything portal-side is
      n=1, and the TypeScript port has never touched a live portal.
- [ ] Test the grade-card parser against a real KTU PDF.
- [ ] "Since you were last here" — snapshot on close, diff on open. The reason a
      student reopens the app.
- [ ] Opt-in "stay signed in" via Windows Credential Manager, enabling a real
      sync-on-open.
- [ ] Ctrl+K command palette — natural-language queries answered
      deterministically.
- [ ] Optional Gemini Flash Lite summary behind a Cloudflare Worker: key never
      shipped, per-install daily cap, one button rather than a chat, model
      phrases numbers it is given and never computes them. Check the free tier's
      data-retention terms first — this would be students' academic records.
- [ ] Tutor/HOD class view. The paid product, per the monetisation decision.

## Testing debt

- [ ] The parity corpus is pinned to a buggy oracle. Once P0 lands, the Python
      in `legacy/` disagrees on purpose. Decide: fix the oracle too and
      regenerate, or freeze the fixture for the rules that did not change and
      cover the corrected rules with direct tests.
- [ ] Add tests for every P0 and P1 item. All forty defects passed 36 green
      tests.
