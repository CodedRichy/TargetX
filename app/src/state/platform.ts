import { createSignal } from "solid-js";

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

/**
 * What the ANDROID system asks for, light or dark - `null` everywhere else.
 *
 * `prefers-color-scheme` is the right question and Android's WebView answers
 * it wrongly: measured on a device in system dark mode, with the activity
 * configuration reporting `night`, the media query still said `light`. The app
 * resolved "system" to its light palette, and the OS then algorithmically
 * darkened the result - so the phone showed colours from neither theme, with
 * the tab bar's selected item coming out darker than its unselected
 * neighbours, which is that inversion reading backwards.
 *
 * So `MainActivity` states the scheme in the user agent, where nothing below
 * this layer can reset it, and re-states it through a `targetx:scheme` event
 * when the phone changes mode while the app is open - the UA cannot change
 * after creation, and `uiMode` is in the activity's `configChanges`, so
 * without the event a student flipping dark mode would see nothing happen.
 *
 * A signal, not a function: the appearance is rendered, and the effect that
 * stamps it on the document has to re-run when this changes.
 */
const readScheme = (): "light" | "dark" | null => {
  if (!isAndroid()) return null;
  const m = /TargetXScheme\/(light|dark)/.exec(navigator.userAgent);
  return m ? (m[1] as "light" | "dark") : null;
};

const [schemeSignal, setScheme] = createSignal<"light" | "dark" | null>(readScheme());

if (typeof window !== "undefined") {
  window.addEventListener("targetx:scheme", (e) => {
    const next = (e as CustomEvent<string>).detail;
    if (next === "light" || next === "dark") setScheme(next);
  });
}

/** The Android system scheme, or `null` on desktop and in a browser. */
export const androidScheme = schemeSignal;

/**
 * Whether the layout is in its narrow, one-column form.
 *
 * The same 720px the phone stylesheet turns at, and read the same way it is
 * there: a small window on a laptop has the problem a phone has and gets the
 * answer a phone gets. It is NOT `isAndroid` - the Android build is one
 * caller, a half-width desktop window is another, and a test running in
 * jsdom is neither.
 *
 * A signal rather than a function call, because the pieces that ask are
 * rendered rather than styled - CSS can hide a control that exists, but it
 * cannot make one exist. The listener is registered once, at module scope: a
 * component that added its own would drop it on unmount, and these questions
 * are asked by things that mount and unmount as the student changes view.
 */
const NARROW = "(max-width: 720px)";

const [narrowSignal, setNarrow] = createSignal(
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(NARROW).matches
    : false,
);

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mq = window.matchMedia(NARROW);
  // `addEventListener` rather than the deprecated `addListener`: the WebView
  // this ships in is current Chromium, and the desktop one is WebView2.
  mq.addEventListener("change", (e) => setNarrow(e.matches));

  /*
   * Re-ask, because the first answer was given before the question was
   * decidable.
   *
   * On a desktop the viewport exists before any script runs and the value
   * above is simply correct. An Android WebView starts at its own default
   * width and only applies `<meta name="viewport">` once it has parsed the
   * document - which can land AFTER this module is evaluated. The snapshot is
   * then `false` on a 411px phone, and no `change` event ever repairs it,
   * because the viewport was RESOLVED rather than changed and a media query
   * that was never true does not fire when it becomes true for the first time.
   *
   * The failure is invisible in CSS - the stylesheet re-evaluates its own
   * media queries whenever the viewport settles - and shows up only in what
   * this signal decides to RENDER. The symptom was Attendance drawing the
   * 820px desktop timetable on a phone while the phone stylesheet around it
   * was already in its narrow form, which reads as "the mobile layout is
   * broken" when in fact the mobile layout was never chosen.
   *
   * `resize` fires when the WebView settles its viewport, so it catches the
   * case the media query cannot. Both listeners write through `setNarrow`, and
   * a signal set to the value it already holds notifies nothing, so the
   * overlap costs one comparison and never a re-render. Registered at module
   * scope alongside the other, and deliberately never removed: it must outlive
   * every component that asks.
   */
  const reread = () => setNarrow(mq.matches);
  window.addEventListener("resize", reread);
  // A phone can also settle without a resize event; one turn of the event loop
  // after parse is enough to catch that, and costs nothing if it was right.
  if (typeof queueMicrotask === "function") queueMicrotask(reread);
  setTimeout(reread, 0);
}

export const isNarrow = narrowSignal;
