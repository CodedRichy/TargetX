# Changelog

TargetX offers updates to installed copies on its own, so this file is what a
student sees to decide whether an update matters. It is written for them, not
for the commit log: what changed about the numbers, and whether any number they
were shown before was wrong.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been released yet. Everything below is what 0.1.0 will contain.

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

### Security

- Portal credentials are no longer sent anywhere they do not belong.
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

[Unreleased]: https://github.com/CodedRichy/TargetX/compare/main...HEAD
