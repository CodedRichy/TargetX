import { createEffect } from "solid-js";
import { edit, state } from "./store";

/**
 * Theme.
 *
 * Three settings, two appearances. "System" is the default and follows the
 * desktop, because a student who has already told Windows they want light does
 * not want to tell this app as well. The other two are an override that
 * outranks the OS - a media query alone cannot do that, which is why the
 * resolution happens here and lands on the document as an attribute.
 */

export type Theme = "system" | "light" | "dark";
export type Appearance = "light" | "dark";

export const THEMES: Array<{ id: Theme; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const query = () => window.matchMedia("(prefers-color-scheme: light)");

/** What the OS is asking for right now. */
export function systemAppearance(): Appearance {
  return query().matches ? "light" : "dark";
}

export function resolve(theme: Theme): Appearance {
  return theme === "system" ? systemAppearance() : theme;
}

const KNOWN = new Set<string>(["system", "light", "dark"]);

/**
 * The stored setting, validated.
 *
 * State comes off disk and out of a restored backup, so an unknown value is
 * possible and must fall back rather than stamp nonsense onto the document.
 */
export const theme = (): Theme =>
  (KNOWN.has(state.theme ?? "") ? state.theme : "system") as Theme;
export const appearance = (): Appearance => resolve(theme());

export function setTheme(next: Theme) {
  edit((s) => { s.theme = next; });
}

/**
 * Bind the resolved appearance to the document.
 *
 * The dark palette is the bare `:root` block, so only light needs stamping -
 * but the attribute is written in both directions anyway. Leaving it off for
 * dark would work today and break the moment anything keys off an explicit
 * dark, which is exactly the bug that is invisible until it is not.
 */
export function startTheme() {
  createEffect(() => {
    document.documentElement.dataset["theme"] = appearance();
  });

  // Following the system means following it as it changes, not only at launch.
  const media = query();
  const onChange = () => {
    if (theme() === "system") {
      document.documentElement.dataset["theme"] = systemAppearance();
    }
  };
  media.addEventListener("change", onChange);
}
