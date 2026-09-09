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
import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { VIEWS, setView, view } from "../state/nav";
import { Mark } from "./Mark";
import type { View } from "../state/nav";

/**
 * Icons at 22px, stroked, matching the header's own set.
 *
 * Drawn rather than set as text glyphs for the reason `WindowChrome` gives:
 * the obvious shortcut is a Unicode character, and those render at wildly
 * different weights and sizes across the font fallbacks a phone might pick.
 */
const ICONS: Record<View, () => JSX.Element> = {
  /*
   * The mark, not a house - and it is the app's mark, in its own green tile,
   * exactly as the desktop header draws it.
   *
   * Home had a house here and the mark lived in the header, which put the
   * brand in the one place a phone does not need it (you know which app you
   * opened - you tapped it) and gave the bottom bar a generic glyph that
   * could belong to any application on the device. Swapping them puts the
   * mark where a thumb actually goes and costs the header a control it was
   * short of room for.
   *
   * The tile is drawn here rather than as a fourth line in the SVG because it
   * is the same object as `.homebtn`: brand ground, white strokes, rounded
   * square. `mobile.css` styles it to match.
   */
  home: () => (
    <span class="tabmark" aria-hidden="true"><Mark size={19} /></span>
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
  /*
   * Sliders, as in rules you set rather than rules you are given.
   *
   * Deliberately not a document or a certificate: those read as "the
   * regulation", something handed down and looked up, and this screen exists
   * because a college's rules are a thing the student can choose between and
   * author. Two tracks with the handles at different positions say adjustable
   * without saying anything about what is being adjusted.
   */
  schemes: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" /><circle cx="10" cy="16" r="2" />
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
                  aria-label={v.label}
                  title={v.hint}
                  onClick={() => setView(v.id)}>
            <Icon />
            {/*
              * Home is the mark alone, no word under it.
              *
              * The other four need their labels: a table, a calendar, a clock
              * and a stack are generic glyphs that could mean several things
              * each. The mark could not - it is the one icon here that names
              * itself, and the desktop header draws it the same way, as a
              * tile with nothing written beneath it.
              *
              * `aria-label` moved onto the button above so the tab keeps its
              * accessible name once the visible text is gone; the label is
              * decoration for the other four, not the name.
              */}
            <Show when={v.id !== "home"}>
              <span class="tabbar-label">{v.label}</span>
            </Show>
          </button>
        );
      }}</For>
    </nav>
  );
}
