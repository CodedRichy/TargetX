/**
 * Opening a link in the student's own browser.
 *
 * `<a target="_blank">` does nothing in a Tauri webview, which meant every
 * external link in the desktop app was dead: the privacy statement, "Report a
 * problem" on the Data screen, and "Report a problem" on a failed sync. The
 * last one is the reason this file exists - a student whose sync had just
 * broken was being handed a dead link to the issue form, so the one path out of
 * a broken app led nowhere.
 *
 * The plugin is scoped in `capabilities/default.json` to this project's own
 * GitHub URLs and nothing else. That scope is the answer to the objection
 * written up on `diagnostics_dir`: this webview also renders a college portal's
 * HTML, and a hostile page in it can ask for the issue tracker and cannot ask
 * for anything beyond it.
 */
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * True when running inside the desktop shell.
 *
 * Mirrors `canDiagnose` in `./diagnostics` and `canSync` in `../sync/etlab`
 * rather than inventing a fourth detection. In a browser build the anchor
 * works by itself and nothing here should run.
 */
const inShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Handle a click on an external link.
 *
 * Returns without preventing the default in a browser, where the anchor is
 * already correct - so the same markup serves both builds and there is no
 * second code path to keep in step.
 *
 * A failure is swallowed on purpose. The href is visible in the markup and the
 * student can still copy it; an error toast about a link is noise, and this is
 * frequently being called from a screen that is already reporting a fault.
 */
export function openExternal(event: MouseEvent, href: string): void {
  if (!inShell()) return;
  event.preventDefault();
  void openUrl(href).catch(() => {});
}
