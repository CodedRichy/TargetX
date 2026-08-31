# Changelog

TargetX offers updates to installed copies on its own, so this file is what a
student sees to decide whether an update matters. It is written for them, not
for the commit log: what changed about the numbers, and whether any number they
were shown before was wrong.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- **Each source on its own view.** Your KTU grade card and your college portal
  are now told apart, and a disagreement between them is shown rather than
  silently resolved (see 0.2.0). The step left is to let you switch between the
  two like accounts, so you can read the whole record from one source's point
  of view rather than one figure at a time.

- **A KTU import you can find.** Bringing in a grade card already works and
  already reads the PDF directly - it is buried on the Data screen, where a
  student who has never opened it will not look.

- **Telling us your college works, in one press.** TargetX can already check
  whether it will read your college's portal without anyone handing over an
  account: you save your academics page and drop the file in, and it reports
  the shape of the tables it found with every digit blanked out. What it then
  does is copy that to your clipboard and leave you to work out where it
  goes. Instead it will offer to open a pre-filled report - the college, the
  shapes it found, and nothing else - so a portal that does not work becomes
  something that can be fixed rather than something you give up on.

- **A list of the colleges it is known to work at.** So the answer to "will
  this work for me?" is usually a name on a page rather than a test you have
  to run, and so the same portal is not reported five times.

### Under consideration

- **Autonomous colleges.** An autonomous college sets its own regulations,
  and TargetX has KTU's built into it - the 40/60 split, the pass rules, the
  attendance bands worth 5 marks, the grade boundaries. Where your college
  has written its own, the arithmetic on this page is not your arithmetic,
  and the honest position is that TargetX does not support you yet rather
  than that it half does. Making those rules per-college is a real change and
  not a small one, so the first step is finding out how many people it would
  serve: if that is your college, say so in an issue, and bring your
  regulations. Enough of them and this stops being a maybe.


- **Signing in to KTU for a marks cross-check.** The public KTU site is behind
  a captcha, and defeating that to log in is off the table for good - a tool
  that does it teaches every student to hand credentials to something that
  bypasses the university's own gate. But the student results portal is a
  different door: a plain sign-in, no captcha and no one-time password, the
  same shape as the college portal TargetX already reads. That reopens one
  narrow thing worth doing. Your college portal's marks can be wrong; your KTU
  grade card is the university's own record. Reading the card lets TargetX
  check the two against each other and, where they disagree, trust KTU over the
  portal every time - attendance still comes from the college, because KTU does
  not publish it. Only if it can be done without weakening the promise that
  your credentials never leave your machine.

## [0.2.0] - 2026-08-31

### Added

- **What changed since your last sync.** A sync used to replace your whole
  record in silence — you saw today's numbers with no way to tell which of them
  was new. Now the second sync onward opens with a short list of what actually
  moved: a series mark posted, an attendance figure that shifted, a grade
  published, a semester's SGPA finalised. Nothing else — the derived figures
  that move as a result are not repeated back at you. Read it and dismiss it;
  the next sync writes a fresh one. A sync that moved nothing says so, so you
  are never left wondering whether it ran.

- **Attendance, as how many classes you can still miss.** A screen per subject
  that answers the question a percentage does not: how many more classes you
  can skip before you drop below the line, and how many in a row it takes to
  climb back. The marks attendance is quietly costing under R 7.5.ii — worth up
  to five of your internal, and needing 85%, not the 75% you are told about —
  are counted here rather than left invisible.

- **Remember your portal login, if you ask.** Off by default, and desktop only.
  Tick the box and your college portal password is kept in Windows Credential
  Manager — encrypted for your account by Windows itself, never in TargetX's
  backup, never in a log, never off your machine. Untick it, or sign out, to
  forget it. If you do not tick it, nothing changes: the password is used for
  the one sign-in and dropped.

### Changed

- **Your KTU results and your college portal, told apart.** A figure from your
  KTU grade card and one scraped from your college portal used to land in the
  same record and look identical. They are not the same — the grade card is the
  university's own document and now outranks the portal — and where the two
  name a different SGPA for a semester, the disagreement is shown on the
  History screen instead of one figure quietly overwriting the other. Your
  marks can cross-check themselves.

- **Subjects go by their name.** Where TargetX had room to name a subject it
  now shows the name — "Computer Networks", not "PCCST501" — so a sentence
  about how many classes buys a mark points at a subject you recognise. The
  code stays where you edit it, in the semester table.

- **A steadier window and a cleaner semester screen.** The title bar TargetX
  draws for itself — this build has no operating-system title bar — sits
  properly against the window edge, and the semester screen has had its spacing
  and alignment reworked.

## [0.1.0] - 2026-08-30

First public release.

### Corrected — numbers that were wrong

These are the reason the update mechanism exists. Every one of them changed a
figure that was shown to a student as fact.

- **Attendance now earns CIE marks.** Regulation 7.5.ii awards up to 5 internal
  marks for attendance, and the engine displayed the figure in a column while
  leaving it out of every calculation. This is the rule the whole product is
  built on and it was not being applied.
- **A blank attendance field no longer counts as 100%.** It counted as full
  attendance, so a student who had entered nothing was told they were safe.
- **An unknown value is no longer spent as a zero.** An unrecorded attendance
  percentage or an unmarked internal component travels as a range now. Before
  this, the same course could be reported SAFE both when attendance was blank
  and when it was 90%.
- **The CGPA goal and the route to it are solved over the same credits.** They
  were divided by different totals, so the app could say "you need 8.29" and
  then hand over a plan that, executed perfectly, produced 4.25.
- **Withdrawn and incomplete courses no longer count as failures.** I and W are
  not F. A withdrawal also no longer weights a CGPA it was never part of.
- **A CGPA target is solved over the semesters actually left**, not as though
  graduation were at the end of this one.
- **One unpassable course no longer ends the whole semester plan.**
- **Duty leave is capped against the classes actually held** (R 6.3.ii), not a
  fixed number.
- **A grade is withheld while attendance is unknown** rather than guessed.
- **The first-year subject preset was missing a quarter of S1.** The S1 preset
  listed 15 credits where KTU registers 20 — one subject was absent entirely,
  and so were both of the first-year choices (Physics or Chemistry, and Health
  and Wellness or Life Skills). A first year who started from it had every
  SGPA divided by the wrong number from the day they installed the app. The
  preset now matches the published curriculum, offers those two as choices, and
  tells you when what you have ticked does not add up to the total KTU
  registers for that semester.
- **Grade cards are read as columns.** KTU prints a Result column after the
  grade, and it was being read AS the grade: an A+ imported as a P, and a
  re-sat course marked `S3(S)` imported as an S — a 10.0. A whole academic
  history could arrive flattened and be shown as the university's own figure.
  Credits on a card are read properly too: a zero-credit MCN course is no
  longer given 3, and a mark is no longer mistaken for a credit.
- **A pasted marks page can no longer overwrite good marks with maximums.**
  Portals print each mark beside its maximum. The first three numbers on the
  row were taken as the three components, so a maximum landed in a mark column
  and produced a confident, wrong CIE over a semester that had synced
  correctly. Rows whose columns cannot be identified are now refused by name
  rather than guessed at.
- **A subject the portal has not posted attendance for no longer disappears.**
  It was dropped during sync, and the semester was then rebuilt from what
  survived — taking that course's credits out of the SGPA with it.
- **A sync that finds no subjects is a failure, not a success.** It used to
  report a green result and write a timestamp, which is the answer that stops
  you looking for the problem.
- **Two courses under the same code stay two courses.** A re-registered backlog
  no longer has its marks written onto its twin.
- **A credit you correct by hand survives the next sync.**
- **A pasted mark clears a superseded published CIE**, so the import no longer
  appears to do nothing.

### Added

- **Personal targets, separate from the regulations.** Minimum attendance,
  per-semester SGPA, a default SGPA and the final CGPA are all yours to set.
  KTU's own rules stay fixed and unreachable — the app's value is that it knows
  them. A target below a regulation floor is allowed, and named as such.
- **The attendance target defaults to 85%, not 75%.** 75% is the eligibility
  line. Full marks under R 7.5.ii start at 85%, so every point between is marks
  being lost silently, and Home now says so.
- **Two attendance answers per subject**, because there are two questions: how
  many classes you can still miss and stay eligible, and how many you must
  attend to stop losing marks.
- **What is still reachable when your target is not.** A route that falls short
  now shows the SGPA that remains available and what a harder route would need.
- **Automatic updates.** An installed copy checks for a newer build a few
  seconds after launch and offers it. It never installs without being asked.
- **Your marks are now kept in a real file**, written atomically, with three
  prior copies retained. They previously existed only in browser storage, where
  a profile reset would have taken a semester of work with it.
- **You are told when a save fails.** It used to fail silently.
- **The window carries its own controls** and no longer uses the OS title bar.
- **The Data screen shows the version and where faults are logged**, which is
  what a bug report needs and what nothing in the app used to be able to give
  you.
- **The app is operable and readable without a mouse.** Every control is
  reachable and named, focus is visible everywhere, and every colour now meets
  WCAG AA contrast — checked by a test that reads the real stylesheet, not by
  eye.
- **The charts are drawn at the size they claim.** Every chart used to scale
  its whole drawing to fit its container, so the trend on Home was rendered at
  two and a half times its intended size — axis labels included — while the
  same chart in the subject drawer came out slightly too small to read. They
  now measure their space and draw into it, which also gave Home back enough
  height to fit a 1440x900 window without scrolling.

### Security

- Portal credentials are no longer sent anywhere they do not belong.
- A synced subject that is in neither the curriculum file nor your portal's own
  subject list now says so by name. Whether a course is marked out of 40/60 or
  50/50 sets its internal maximum, and with nothing to read it from it is
  guessed from the course code — so the subjects that were guessed are listed,
  rather than sitting in the grid looking like the ones that were not.

- **"Will sync work at my college?"** on the Data screen. Save your portal's
  academics page out of a browser and drop the file in; TargetX reads it
  exactly as a sync would and tells you what it found, without you signing in
  to anything. The saved page never leaves your machine, and what you are
  offered to send is a separate block with every number blanked out.

- When the portal cannot be read, TargetX shows you a description of the page
  it could not parse — the table headings with every number blanked out and no
  subject row at all — so a college it does not yet work for can be fixed from
  a bug report instead of from your password.
- Restoring a backup or importing a grade card can no longer destroy the record
  it was merged into, and a backup from a newer build is refused rather than
  half-read.

### Known limitations

- **The installer is not yet code-signed.** Windows will warn that the
  publisher is unknown.
- **Portal sync has been validated against one college.** If yours is not that
  college, sync may need work before it succeeds.
- Writes are atomic against a crash but not against sudden power loss; the
  backups exist for that case.

[Unreleased]: https://github.com/CodedRichy/TargetX/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CodedRichy/TargetX/releases/tag/v0.1.0
