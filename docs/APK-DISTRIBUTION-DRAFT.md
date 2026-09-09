# APK distribution — DRAFT, NOT PUBLISHED

Status: **draft for review**. Nothing in this file is live. `docs/index.html`,
`docs/privacy.html` and `README.md` are untouched.

Date: 2026-09-09. Measured against `origin/feat/android` (`ae26b13`) and the
one APK that exists on this machine.

---

## 0. Read this before the drafts: we cannot ship an APK today

Three facts, each verified rather than assumed. Any one of them is enough to
stop a publish.

### 0.1 The release build is not signed at all

`app/src-tauri/gen/android/app/build.gradle.kts` (on `feat/android`) declares
`buildTypes { getByName("release") { … } }` with `isMinifyEnabled` and
proguard files — **and no `signingConfig`**. With no signing config, AGP emits
`app-universal-release-unsigned.apk`. Android will not install an unsigned
APK under any setting. There is no "allow unknown sources" for this; the
package installer rejects it outright.

So the release artefact is not "weakly signed". It does not install.

### 0.2 The only APK that exists is debug-signed, by the public debug key

The single build on this machine:

```
../TargetX-android/app/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
57,082,997 bytes (54.4 MB)
```

`apksigner verify --print-certs`:

```
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Number of signers: 1
Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
Signer #1 certificate SHA-256 digest: b7cbd5482417a795c17056b93e9da22ea89b79c1af1d32a19488208cc01f0b94
```

`CN=Android Debug` is `~/.android/debug.keystore` — the keystore every Android
SDK install generates with the same alias (`androiddebugkey`) and the same
password (`android`). It is not a secret and it is not ours. Anyone can build
an APK signed with *a* debug key.

What that means for a student, said plainly: the signature proves nothing
about who built the file. A malicious build with the same `applicationId`
signed with any debug key would install over ours as an update. There is no
"is this really TargetX" question that this signature answers.

The debug build also carries `applicationIdSuffix = ".debug"`,
`isDebuggable = true`, and `usesCleartextTraffic = "true"`. A debuggable app
can be attached to by ADB and has its data read on a rooted or developer-mode
device. That is a build for an emulator, not for a student's phone.

**Verdict: debug-signed is not a distribution option.** It is not a smaller
version of the problem the unsigned Windows installers have — the site can
honestly say "unsigned, here is the SHA-256" for a `.exe` because Windows
still runs it and the hash is the check. An Android debug signature actively
misrepresents itself as a signature.

### 0.3 The one APK we have covers no real phone

`unzip -l` on that APK, native libraries only:

```
lib/x86_64/libtargetx_lib.so    24,911,800 bytes
```

One ABI. `x86_64`. That is the emulator. It contains **no `arm64-v8a`**, which
is what essentially every Android phone sold since ~2017 runs, and no
`armeabi-v7a` for the older 32-bit handsets that `minSdk 24` deliberately keeps
in scope. The file is named `universal` because that is the Gradle flavour
name, not because it is universal.

Anyone who downloaded that file onto a phone would get
`INSTALL_FAILED_NO_MATCHING_ABIS`, or nothing at all.

### 0.4 The consequence nobody should discover later: the key is permanent

Android identifies an app by `applicationId` **plus signing key**. An update
must be signed by the same key as the installed copy, or the install is
refused (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) and the only way forward is
uninstall-then-install.

Uninstalling wipes app-private storage. `state.json` lives under
`appDataDir()`, which on Android is app-private. **Uninstall = the student's
whole record is gone**, unless they exported it first from the Data screen.

So if we ship a debug-signed APK now and a properly-signed one in three
months, every student who installed the first one must uninstall, lose their
record unless they knew to export, and reinstall. That is the single most
expensive mistake available here, and it is entirely avoidable by generating
the release keystore *before* the first public APK.

### 0.5 There is a clock on this, and it is 2027

Google's developer-verification programme requires apps to be registered to a
verified developer before they can be installed on any certified (GMS) Android
device — **regardless of install source, sideloading included**. Enforcement
began 30 September 2026 in Brazil, Indonesia, Singapore and Thailand, with a
global rollout stated for 2027 and beyond. India is not in the first wave, so
this does not block a 2026 release, but it does mean an APK-from-a-website
distribution has a known expiry unless we register.

Registration relevant to us: a **limited distribution account** exists at no
cost for students, teachers and hobbyists — no government ID, no fee — capped
at **20 devices** and barred from public stores. Twenty devices does not cover
a college. The other path is a verified Android Developer Console or Play
Console account with ID verification.

This belongs in the decision, not in the student-facing copy.

---

## 1. What we must do before either draft below can ship

Ordered. Nothing after step 1 matters until step 1 is done.

1. **Generate a release keystore and store it outside the repo.**
   `keytool -genkeypair -v -keystore targetx-release.jks -alias targetx
   -keyalg RSA -keysize 4096 -validity 10000`. Back it up in at least two
   places. If it is lost, no future build can update any installed copy, ever —
   that is not recoverable, it is a new app. `docs/plans/android-port.md`
   already lists this under *Open*: "Signing keystore for release APKs: needs
   to be generated and stored outside the repo. Not yet done."
2. **Wire it into `build.gradle.kts`** as a `signingConfig` read from
   `keystore.properties` (gitignored) or from environment variables, applied to
   the `release` build type. Do not commit the keystore or its passwords.
3. **Build the ABIs that exist on phones.** Confirm the release APK contains
   `arm64-v8a` and `armeabi-v7a` at minimum.
4. **Verify with `apksigner verify --print-certs`** that the signer DN is ours
   and not `CN=Android Debug`, and that v2 *and* v3 schemes verify.
5. **Publish the SHA-256** beside the APK, the same way the desktop installers
   do, so the file can be checked against something.
6. Only then: the website section and the README section.

### ABIs — single universal APK, containing arm64-v8a and armeabi-v7a

The recommendation, with what it trades away.

- `arm64-v8a` — mandatory. Every 64-bit ARM phone, which is effectively every
  phone a student is holding.
- `armeabi-v7a` — include. `minSdk 24` (Android 7.0) was chosen deliberately
  because "older handsets are common in the target audience". Keeping minSdk 24
  and dropping 32-bit ARM contradicts that choice: those are the same phones.
- `x86_64` — build it for the emulator, do not ship it in the public APK. It
  costs ~25 MB for ChromeOS and Intel tablets, an audience of approximately
  nobody here.
- `x86` — no.

**Universal, not per-ABI.** `tauri android build --apk --split-per-abi` emits
`app-arm64-release.apk`, `app-arm-release.apk` and so on, roughly halving the
download. It also asks a student on a phone to know their CPU architecture
before they can download anything, and to pick right or get a file that does
not install. That is a worse failure than a larger download, and it is a
failure that happens to the least technical users. Ship one file that always
works.

What that costs: size. The only measured artefact is the 54 MB debug APK with
a single 25 MB `.so`. A release build strips and optimises, but two ABIs means
two `.so` files, so plan for something in the 50–90 MB range and **measure it
before writing a number on the page**. Do not put a size in the copy below
until a real release APK exists.

---

## 2. DRAFT — the website section

Placement: a new block inside `#download`, after the platform table and before
the Windows/macOS notices, so a student meets the table first and the Android
caveats in the same reading order as the desktop ones.

Copy, written to be pasted into the existing `.notice` / `.dl-table` idiom.
Every claim here is one we can defend; nothing is softened.

---

> ### Android
>
> TargetX runs on Android as well, and it is the same app — the same record,
> the same engine, the same screens re-laid out for a phone. What is different
> is how it reaches you, and there are three things you should know before you
> tap download.
>
> **This is not from the Play Store, and Android will say so.** You are
> downloading a file from a website and installing it yourself. Android treats
> that as it treats any file from anywhere, and will interrupt you twice on the
> way. Here is exactly what you will see:
>
> 1. Tap the `.apk` link below. Your browser warns you that this type of file
>    can harm your device. Choose **Download anyway**.
> 2. Open the file — from the download notification, or from **Files →
>    Downloads**.
> 3. Android says *"For your security, your phone is not allowed to install
>    unknown apps from this source."* Tap **Settings**, turn on **Allow from
>    this source**, then press back. You are granting this to your *browser*,
>    not to the whole phone — Android has not had a single global "unknown
>    sources" switch since Android 8.
>    (The long way round, if you would rather look first: **Settings → Apps →
>    Special app access → Install unknown apps → Chrome → Allow from this
>    source**.)
> 4. The installer asks *"Do you want to install this application?"* Tap
>    **Install**.
> 5. Play Protect may offer to scan the app, or warn you that it does not
>    recognise the developer. Let it scan. Then **Install anyway**.
> 6. When it is done, go back to **Settings → Apps → Special app access →
>    Install unknown apps** and switch your browser back off. Nothing needs it
>    after this, and leaving it on is a standing permission you did not mean to
>    give.
>
> If your phone runs Android's **Advanced Protection**, sideloading is blocked
> by design and none of the above will work. That setting is doing its job;
> there is no workaround and we would not offer one.
>
> **It cannot update itself.** The desktop app checks for a new version a few
> seconds after it opens and offers it to you. The Android build does not, and
> this is not an oversight we intend to quietly fix later — Android has no
> equivalent of the desktop updater without a store, so the update machinery is
> compiled out of the Android build entirely.
>
> That matters more here than it would for most apps. The arithmetic *is* the
> product: a build with a mistake in it reports a wrong number with exactly the
> same confidence as a right one. And the course catalogue refreshes from this
> repository at runtime, so an old copy keeps pulling new data while the code
> reading it stands still.
>
> So: **check this page** when a semester starts, or watch the repository on
> GitHub. Installing a newer APK over an older one keeps your record — it is an
> update, not a fresh install — as long as it came from here.
>
> **Signed, and what that is worth.** [← this paragraph is deliberately left
> unwritten. See §3.]
>
> **Your record still lives on your phone and nowhere else.** Same promise as
> the desktop app. One thing Android adds: uninstalling the app deletes its
> private storage, and your record is in it. Export from the **Data** screen
> before you uninstall anything.

---

## 3. The paragraph I will not write until you decide

The section above has a hole in it where the signing paragraph goes, because
the three versions of it are three different products and I am not going to
pick by writing whichever is easiest to phrase.

**(a) If we ship a properly signed release APK** — the honest and short
version:

> **It is signed, but not by a store.** The APK carries a signature made with
> our own key, and every later version carries the same one, which is why an
> update installs over your copy instead of asking you to delete it. What that
> signature does *not* do is tell Android who we are — no shop vouched for it —
> which is why you get the warnings above. Beside the download is a
> `SHA256SUMS-android.txt`; if you want to check the file is the one we built
> rather than take that on trust, that is what it is for.

**(b) If we ship the debug-signed APK** — the version I would have to write,
which is why we should not:

> **This build is signed with a development key, not ours.** The signature is
> made with the key every Android SDK generates for testing, with a password
> that is publicly known. It proves nothing about where this file came from,
> and it means a later properly-signed version will not install over this one —
> you will have to uninstall first, which deletes your record. Export it before
> you do.

If that paragraph is unpublishable — and it is — then (b) is unshippable, which
is the point.

**(c) Do not offer an Android download yet.** Say the port exists, say it is
not distributable until it is signed, and let students watch the repository.
This is my recommendation if the keystore is not going to be generated this
week: an honest "not yet" costs nothing, and a debug APK in the wild costs a
forced uninstall for every student who takes it.

---

## 4. DRAFT — the README section

Placement: after the download/platform framing near the top, before **Getting
your data in**. Second block goes in **For developers → Building from source**.

---

> ## On Android
>
> TargetX runs on Android as a downloadable APK. Same record, same engine,
> same screens laid out for a phone — the port is a port, not a companion app.
> It is not on the Play Store, and there is no plan for it to be on the Play
> Store in this release.
>
> **Installing it.** Download the `.apk` from the
> [releases page](https://github.com/CodedRichy/TargetX/releases), open it, and
> allow your browser to install unknown apps when Android asks — that permission
> is per-app, granted to the browser, and worth switching off again afterwards
> (**Settings → Apps → Special app access → Install unknown apps**). Play
> Protect will want to scan it. Let it.
>
> **It does not update itself.** The desktop build checks for a newer version
> on launch. The Android build does not: the Tauri updater plugin is registered
> under `#[cfg(desktop)]` in `src-tauri/src/lib.rs`, so on Android there is no
> update check to fail — there is no update check at all. You update by
> downloading a newer APK and installing it over the old one, which keeps your
> record.
>
> This is worth stating loudly rather than burying: the engine is the product,
> and `curriculum.json` refreshes from this repository at runtime, so a stale
> build keeps reading fresh data with old code. Watch the repository, or check
> the releases page at the start of a semester.
>
> **Signing.** [same hole as §2 — depends on the §3 decision.]
>
> **Your record is app-private storage.** `state.json` lives under
> `appDataDir()`, which Android deletes when the app is uninstalled. Export
> from the Data screen before uninstalling. Installing a newer APK over an
> older one is an update and leaves the record alone.
>
> **What it needs.** Android 7.0 (API 24) or newer, on an ARM phone. The
> published APK carries `arm64-v8a` and `armeabi-v7a`.

And under **Building from source**:

> ```
> cd app
> npm run tauri android build -- --apk     # release APK, needs a signing config
> npm run tauri android dev                # onto a connected device or emulator
> ```
>
> Android builds need the SDK, NDK 28.2.13676358 (not 27 — only 28+ emits
> 16 KB-page-aligned binaries) and Android Studio's bundled JBR 21 as
> `JAVA_HOME`; a system JDK 25 is not supported by AGP and fails confusingly.
> `docs/plans/android-port.md` has the full toolchain table and the reasons.
> Release signing is configured from a keystore that is not in this repository.

---

## 5. Everywhere the site currently claims a platform

Every place that will need editing once Android ships. `docs/` on `main`
(`947fcdd`). Nothing here has been changed.

| File | Line | What it says | Why it breaks |
|---|---|---|---|
| `docs/index.html` | 50 | `"operatingSystem": "Windows, macOS, Linux"` (JSON-LD) | Structured data tells Google the OS list. Add Android. |
| `docs/index.html` | 54 | JSON-LD description: *"Desktop tracker for KTU students…"* | No longer only desktop. |
| `docs/index.html` | 7 | `<meta name="description">`: *"Free **desktop app** for KTU students."* | Same. |
| `docs/index.html` | 118 | Hero button `Download for Windows` (text set by JS) | On a phone this currently rewrites to *"See the downloads"* — see `site.js`. |
| `docs/index.html` | 120 | `Other platforms` link | Fine as-is, but the list it points at changes. |
| `docs/index.html` | 399–401 | *"A **desktop app** — Windows, macOS and Linux."* | The single most load-bearing sentence to change. |
| `docs/index.html` | 420–441 | The static `<table>` fallback: Windows / macOS / Linux rows | Needs an Android row, with its own honest badge. |
| `docs/index.html` | 446–461 | *"Windows may refuse to download this"* notice | Android needs its own equivalent notice, not a footnote on this one. |
| `docs/index.html` | 482–489 | *"**Updates are signed, even though the installer is not.** A few seconds after launch the app checks whether a newer version exists…"* | **Flatly false on Android**, in both halves — there is no launch check and no update signature. Must be scoped to desktop. |
| `docs/site.js` | 86 | `if (/iPhone\|iPod\|Android/i.test(ua)) return "mobile";` | Android is now a platform we build for, not the "we have nothing for you" branch. |
| `docs/site.js` | 101–104 | `LABEL = { windows, macos, linux, mobile: "desktop", "": … }` | `mobile: "desktop"` is the "sorry, get a computer" label. |
| `docs/site.js` | 107–116 | `classify()` maps `.exe .msi .dmg .appimage .deb .rpm` | **No `.apk` case.** Attach an APK to a release today and the table silently drops it — the row never appears and nothing logs an error. |
| `docs/site.js` | 127 | `OS_ORDER = { windows: 1, macos: 2, linux: 3 }` | An unranked OS sorts to `9`. Android needs a rank. |
| `docs/site.js` | 137–142 | `UNSIGNED = { windows, macos }` | The badge map that puts *"unsigned"* on the row itself. |
| `docs/site.js` | 118–121, 144–151 | `DESKTOP_ONLY` — on a phone the hero button stops offering an installer and scrolls to the table instead | Deliberate and well-reasoned today; it becomes wrong the moment there is an APK. |
| `docs/privacy.html` | 113–119 | *"On Windows the record is at `%APPDATA%\cv.codedrichy.targetx\state.json`"* | No Android path. Should say app-private storage, and that uninstall deletes it. |
| `docs/privacy.html` | 260–265 | *"On Windows it is at `%LOCALAPPDATA%\…\logs\targetx.log`"* | Same. |
| `docs/privacy.html` | 144–151 | *"A few seconds after launch, to ask whether a newer version exists"* — listed as one of exactly four network requests | On Android this request **does not happen**. The page says "exactly four situations, and no others", which is a precise claim and would become untrue. |
| `README.md` | 6 | *"Not a calculator. A **desktop app** with three ways into one record"* | The opening sentence. |
| `README.md` | 207–218 | Building from source — desktop commands only | Needs the Android build block. |
| `README.md` | 375 | `\| docs/ \| The download page, served by GitHub Pages \|` | Fine. |

Two of these are more than copy edits:

- **`site.js:107` `classify()`** is a live bug waiting for the first release
  that carries an APK. The asset is filtered out by `.filter(Boolean)` and
  never appears. Nobody would see an error; the row just would not be there.
- **`privacy.html` "exactly four situations, and no others"** is a promise
  written with deliberate precision, and Android makes it false by subtraction.
  It needs a platform-scoped sentence, not a hand-wave.

### Version drift, while we are here

`origin/feat/android` still carries `version: 0.4.0` in `tauri.conf.json` and
`Cargo.toml`, and its `docs/index.html` is the pre-0.5.0 copy — the branch was
cut before 0.5.0. Merging it as-is would revert the site and downgrade the app
version. Rebase before anything ships.

---

## 6. Open questions for you

1. **Keystore: generate this week, or publish (c) "not yet"?** My
   recommendation is generate it — the whole Android section is blocked behind
   one `keytool` command and a backup, and every day it waits is a day someone
   might ship the debug build to be helpful.
2. **`x86_64` in the public APK?** I say no. Costs ~25 MB, buys ChromeOS.
3. **Developer verification** — register a limited-distribution account (free,
   no ID, 20 devices) as a placeholder, or a full verified account before the
   2027 global rollout? The 20-device cap makes the free tier useless for a
   college, so this is a "before 2027" decision, not a "before launch" one.
4. **Play Store**, which `docs/plans/android-port.md` set aside: $25 once, real
   auto-updates, and it would delete most of §2. The blockers named there
   (12 testers × 14 days for a new personal account; a policy conversation
   about an app that signs into a college portal) are real but they are
   *timeline*, not *impossible*. Worth revisiting once a signed APK exists.
