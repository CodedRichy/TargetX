/**
 * Navigation, for a screen that has no room for a header full of it.
 *
 * On desktop the five views are a row of text tabs in the header. At 360px
 * that row is one of the things that pushed the document 838px wide, so on a
 * phone it is hidden there (`mobile.css`) and rendered here instead - along
 * the bottom, where a thumb already rests.
 *
 * ALL FIVE views are here. The temptation on a narrow bar is to promote three
 * and bury the rest behind a "More" item, and it is the wrong trade for this
 * app: Data is where sync lives, History is where a wrong credit gets caught,
 * and a student who cannot find either has lost a feature, not a shortcut.
 * Five items at 360px gives each 72px, which holds a 12px label and an icon.
 *
 * The bar is rendered unconditionally and hidden by CSS above 720px, rather
 * than being conditional on `isAndroid()`. A narrow desktop window has exactly
 * the same problem and gets exactly the same answer, and one code path that
 * both platforms take is one that cannot rot on the platform nobody tests.
 */
import { For } from "solid-js";
import type { JSX } from "solid-js";
import { VIEWS, setView, view } from "../state/nav";
import type { View } from "../state/nav";

/**
 * Icons at 22px, stroked, matching the header's own set.
 *
 * Drawn rather than set as text glyphs for the reason `WindowChrome` gives:
 * the obvious shortcut is a Unicode character, and those render at wildly
 * different weights and sizes across the font fallbacks a phone might pick.
 */
const ICONS: Record<View, () => JSX.Element> = {
  // A house.
  home: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" />
    </svg>
  ),
  // A mark sheet: lines of a table.
  ledger: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 9h17M9 9v11.5" />
    </svg>
  ),
  // A calendar.
  attendance: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
    </svg>
  ),
  // A clock turned back.
  history: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
    </svg>
  ),
  // A stack, as in stored records.
  data: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
      <path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
    </svg>
  ),
};

export function TabBar() {
  return (
    <nav class="tabbar" aria-label="Views">
      <For each={VIEWS}>{(v) => {
        const Icon = ICONS[v.id];
        return (
          <button type="button"
                  aria-current={view() === v.id}
                  title={v.hint}
                  onClick={() => setView(v.id)}>
            <Icon />
            <span class="tabbar-label">{v.label}</span>
          </button>
        );
      }}</For>
    </nav>
  );
}
