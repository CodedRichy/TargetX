/**
 * Which shell this build is running in.
 *
 * Three modules already answered a version of this question with the same
 * line - `canSync` in `sync/etlab`, `canUpdate` in `sync/update`, and
 * `hasOwnChrome` in `ui/WindowChrome` all test for `__TAURI_INTERNALS__`.
 * That test means "is there a Rust side at all", and while the only shell was
 * a desktop window it was also, accidentally, a correct test for "is this a
 * desktop window". On Android it is still true and no longer means that.
 *
 * Left alone, each of those three would be wrong in its own way on a phone:
 * `hasOwnChrome` would paint minimise/maximise/close buttons over a screen
 * with no window to control; `canUpdate` would promise an updater that
 * `lib.rs` deliberately does not register on mobile (`#[cfg(desktop)]`), so
 * the check throws, the fail-silent path swallows it, and a student is never
 * told a new build exists. That last one matters most: `update.ts` says it
 * plainly - the engine IS the product, and a build with a marks bug reports a
 * wrong number with exactly the confidence of a right one.
 *
 * So the question is split in two and asked once, here.
 *
 * DETECTION. The user-agent string, not a plugin. Tauri offers
 * `@tauri-apps/plugin-os` for this, and it would be the tidier answer in a
 * different app - but adding it means another Rust plugin compiled into a
 * webview that also renders a college portal's HTML, to learn one bit that
 * the webview already tells us for free. Android's WebView UA always carries
 * the literal "Android"; that is a stable, documented part of the platform's
 * UA, not a quirk being relied on. The cost of the cheap route is that a
 * desktop browser spoofing its UA would be misread, and the consequence of
 * that is a slightly wrong nav bar in someone's devtools.
 *
 * COMPUTED ONCE. Neither answer can change during a run - a window does not
 * become a phone - so these are constants rather than signals. Anything that
 * needs to re-evaluate on resize wants a media query instead, which is what
 * the stylesheets already use for layout.
 */

/** Whether a Rust side exists: the Tauri shell, desktop or mobile. */
export const inShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Whether this is the Android build.
 *
 * False in a browser (`npm run dev`, and every test), false on desktop. The
 * shell test comes first deliberately: a page opened in Chrome on an Android
 * phone is not this app, and must not be given the app's mobile chrome.
 */
export const isAndroid = (): boolean =>
  inShell()
  && typeof navigator !== "undefined"
  && /Android/i.test(navigator.userAgent);

/**
 * Whether this is one of the desktop builds - Windows, macOS or Linux.
 *
 * The complement of `isAndroid` WITHIN the shell, not outside it, so a browser
 * is neither. Callers that mean "has an OS window" want this one: it is the
 * condition for window controls, for the updater plugin, and for anything else
 * `lib.rs` registers under `#[cfg(desktop)]`.
 */
export const isDesktopShell = (): boolean => inShell() && !isAndroid();
