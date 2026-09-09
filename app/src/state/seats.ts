import { createSignal } from "solid-js";

/**
 * How many sign-ins are left.
 *
 * Clerk's development instances refuse the 101st user. That ceiling is already
 * in force and invisible: today the hundred-and-first student gets a sign-in
 * that fails for no reason they can see. Showing the count turns that into
 * something they were told in advance.
 *
 * It is a real measurement or it is nothing. Every failure here - offline, the
 * worker down, a malformed reply, a build with no endpoint - leaves the figure
 * null, and the UI shows no line at all. That is the whole discipline of this
 * file: a remaining-spots counter that guesses is the oldest dark pattern on
 * the internet, and the only thing separating this one from it is that it
 * cannot produce a number it did not read from the server.
 *
 * The cap lives on the server too, not here. When the instance moves to
 * production the endpoint stops reporting one, this returns null forever, and
 * the counter disappears from a copy of the app that was never updated.
 */

export interface Seats {
  taken: number;
  cap: number;
  left: number;
}

const ENDPOINT = String(import.meta.env.VITE_ASK_ENDPOINT ?? "").trim();

const [seats, setSeats] = createSignal<Seats | null>(null);
export { seats };

/** The `/seats` sibling of whatever ask endpoint this build was given. */
function seatsUrl(): string | null {
  if (ENDPOINT === "") return null;
  try {
    return new URL("/seats", ENDPOINT).toString();
  } catch {
    return null;
  }
}

/**
 * Read the count, once.
 *
 * Never throws and never rejects: this runs on launch, beside the update check,
 * and a counter is not worth one line of a student's console let alone a
 * failed boot. `null` on every unhappy path, including a cap the server
 * declines to report.
 */
export async function checkSeats(): Promise<Seats | null> {
  const url = seatsUrl();
  if (!url) return null;

  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;

    const body = (await response.json()) as Record<string, unknown>;
    const { taken, cap, left } = body;
    // Three numbers, all of them from the server, none of them derived here.
    // Recomputing `left` locally would mean a client that disagrees with the
    // server about how full it is, and the server is the one that knows.
    if (typeof taken !== "number" || !Number.isFinite(taken)) return null;
    if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return null;
    if (typeof left !== "number" || !Number.isFinite(left) || left < 0) return null;

    const found = { taken, cap, left };
    setSeats(found);
    return found;
  } catch {
    return null;
  }
}

/**
 * The line that goes under the sign-in button, or nothing.
 *
 * Deliberately flat. No "hurry", no exclamation mark, no colour that means
 * alarm - the number is scarce on its own and decorating it is what turns a
 * fact into a trick. At zero it says so plainly, because a student who cannot
 * get in deserves to read that rather than press a button that fails.
 */
export function seatsLine(found: Seats | null): string | null {
  if (!found) return null;
  if (found.left <= 0) return `All ${found.cap} spots are taken.`;
  if (found.left === 1) return `1 of ${found.cap} spots left.`;
  return `${found.left} of ${found.cap} spots left.`;
}
