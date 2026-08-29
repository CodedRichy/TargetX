# Security

TargetX handles a student's academic record and, for the length of one sign-in,
their college portal password. Both deserve a real disclosure process rather
than an issue tracker.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting on this
repository: **Security → Report a vulnerability**. That channel is private to
the maintainer until a fix exists.

Say what you can reach and how — a proof of concept, or the precise steps.
You should have an acknowledgement within a week. If a week passes with
nothing, assume the message was missed and say so publicly *without* the
details, so it can be picked up.

If you would rather not use GitHub, open a public issue containing only "I have
a security report, how should I send it" and no specifics.

## What counts

Things that would matter here, roughly in the order they would hurt:

- Anything that sends a password or a session cookie somewhere other than the
  college portal the student typed. The Rust HTTP layer in
  `app/src-tauri/src/etlab.rs` is the only place either exists.
- Anything that lets a rendered portal page reach outside the app's
  application-data folder. The filesystem scope in
  `app/src-tauri/capabilities/default.json` is deliberately narrow, and this
  webview renders third-party HTML.
- Anything that gets code executed from a synced page, an imported grade card,
  or a restored backup.
- Anything that lets an update be accepted from a source that is not the signed
  release feed.
- Silent corruption or loss of the student's record. A semester of marks is not
  recoverable from anywhere else.

## What does not

- The absence of an account system, a server or encryption at rest. The record
  is a file protected by the operating system's own user account, which is the
  same protection the student's other documents have.
- A missing code signature on the installer. It is a known gap, stated in
  `CHANGELOG.md`, and being worked on.
- Anything requiring an attacker who already has the student's unlocked
  Windows session. At that point they have the marks anyway.

## Supported versions

The most recent release only. TargetX updates itself, so there is no
maintained older line — a fix ships as a new version and installed copies are
offered it within seconds of their next launch.
