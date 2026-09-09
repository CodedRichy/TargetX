# Signing the Android release

Everything here is set up. What is missing is one key, and it cannot be created
for you, because the password is yours and the consequences are permanent.

## Read this part first

An Android app's identity is its `applicationId` plus **the key it was signed
with**. Android will not install an update signed with a different key. Not
"warns" — refuses.

So if this key is lost, or replaced later:

- Every student has to **uninstall** TargetX before they can install the next
  version.
- Uninstalling takes their data with it. Every semester, every mark, every
  attendance figure they typed.
- There is no recovery, no override, and no support ticket that fixes it. Not
  from Google, not from anyone.

The key is a small file and a password. Back both up somewhere that survives
this laptop being lost or reformatted.

## Create it

One command, from anywhere. It asks for a password, then some identity fields
(name, organisation, city, country) that end up in the certificate.

```
keytool -genkeypair -v \
  -keystore targetx-release.jks \
  -alias targetx \
  -keyalg RSA -keysize 4096 \
  -validity 10950
```

`-validity 10950` is 30 years. Short-dated keys expire and take the ability to
ship updates with them, so pick a number longer than the project's life.

Put `targetx-release.jks` somewhere outside the repository — the repo ignores
`*.jks`, but the safest file is the one that was never in the working tree.

## Point the build at it

Create `app/src-tauri/gen/android/app/keystore.properties`:

```
storeFile=C:/Users/you/keys/targetx-release.jks
storePassword=the password you chose
keyAlias=targetx
keyPassword=the password you chose
```

That file is gitignored. Use forward slashes even on Windows; Gradle reads this
as a properties file, where `\` is an escape character.

Nothing else changes. `app/build.gradle.kts` picks the file up if it is there
and signs release builds with it; without it, release builds still complete but
come out **unsigned** and will not install. That is deliberate — a build that
fails because a secret is missing is a build nobody else can run.

## Build it

```
npm run android:apk:release
```

Then confirm it actually got signed, rather than assuming:

```
apksigner verify --print-certs app-universal-release.apk
```

`apksigner` lives in `$ANDROID_HOME/build-tools/<version>/`. It should print the
certificate you just made. If it says the APK is unsigned, `keystore.properties`
was not found or a path in it is wrong.

## Back it up

Two copies, two places, neither of them only this machine:

- `targetx-release.jks`
- the password, in a password manager

Losing either one is the same as losing both.

## What this unblocks

The in-app updater. A debug-signed build cannot install a release-signed update
over itself, so the updater has nothing to hand out until this key exists and
every build after it uses the same one.

## The key that exists

Created 2026-09-09. Every Android release from 0.5.0 onward is signed with it,
and every future one must be.

```
Subject:  CN=Rishi Praseeth, OU=Pantheras, O=Pantheras,
          L=Ernakulam, ST=Kerala, C=IND
Key:      RSA 4096, valid 30 years
SHA-256:  b7:f5:b5:bf:48:10:24:25:5e:af:a1:33:10:41:bd:2b:
          30:57:50:29:3c:bf:4f:76:7c:08:18:33:0f:84:d2:f1
```

That fingerprint is public — it ships inside every APK. It is written down so
any future build can be checked against it:

```
apksigner verify --print-certs app-universal-release.apk
```

If the SHA-256 does not match the one above, the APK was signed with a
different key and will not install over an existing TargetX. Stop and find out
why before publishing it.

## Verified

0.5.0 was built, signed and installed from this key on 2026-09-09:

- `apksigner` reports one signer, APK Signature Scheme v2, RSA 4096. There is
  no v1 signature and that is correct - `minSdk` is 24, and v2 covers every
  device this app supports.
- Both ABIs present: `arm64-v8a` (real phones) and `x86_64` (emulator).
- Installed and launched with minification on. Release builds run R8, which
  strips code debug builds keep, so "it compiles" is not the test - it was
  launched, the first-run screen rendered, and logcat had no fatal.
