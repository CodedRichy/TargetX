import { Show, createSignal, onMount } from "solid-js";
import { KtuError, canSyncKtu } from "../sync/ktu";
import { KTU_CRED_KEY, canRemember, deleteCreds, loadCreds, saveCreds, vaultName } from "../state/creds";
import { syncKtu } from "../state/actions";

/**
 * Signing in to the KTU results portal.
 *
 * Lifted out of the Data screen so onboarding can offer it too. It was only
 * ever reachable from a folded `<details>` on a screen a new student has no
 * reason to visit, which is issue #16's "the onboarding does not ask for the
 * ktu login" - true, and the fix is not new copy but the same panel in both
 * places. `SyncPanel` was already shared between Setup and Data for exactly
 * this reason; this is the other portal catching up.
 *
 * A different portal from etlab, with a different login, kept under its own
 * vault key. Same security posture throughout: the password lives in a signal
 * for one fetch and is dropped in `finally`, the session cookie stays in the
 * Rust process, and remembering is opt-in.
 */
export function KtuPanel(props: {
  /**
   * What the fetch found. The Data screen prints it beside its other import
   * paths; onboarding uses it to move on. `mismatched` is the subjects whose
   * grade disagrees with what was already held - a fetched card outranks an
   * etlab scrape, so the disagreement is reported rather than swallowed.
   */
  onFetched?: (summary: { note: string; mismatched: string[] }) => void;
}) {
  const [user, setUser] = createSignal("");
  const [pass, setPass] = createSignal("");
  const [remember, setRemember] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(async () => {
    if (!canRemember()) return;
    try {
      const stored = await loadCreds(KTU_CRED_KEY);
      if (stored) { setUser(stored.username); setPass(stored.password); setRemember(true); }
    } catch { /* vault optional; never block the form */ }
  });

  const run = async (event: Event) => {
    event.preventDefault();
    setError("");
    if (!canSyncKtu()) {
      setError("KTU sync needs the app. In a browser, paste or drop the card instead.");
      return;
    }
    try {
      setBusy(true);
      const outcome = await syncKtu(user().trim(), pass());
      props.onFetched?.({
        note: `Fetched ${outcome.fetched.join(", ")} from KTU — `
          + `${outcome.courses} subject${outcome.courses === 1 ? "" : "s"} across `
          + `${outcome.semesters} semester${outcome.semesters === 1 ? "" : "s"}.`,
        mismatched: outcome.mismatched,
      });
      // Persist or forget only after a fetch that worked, and only if asked.
      if (canRemember()) {
        try {
          if (remember()) await saveCreds(KTU_CRED_KEY, user().trim(), pass());
          else await deleteCreds(KTU_CRED_KEY);
        } catch { /* remembering is a convenience, never a blocker */ }
      }
    } catch (exc) {
      setError(exc instanceof KtuError ? exc.message : String(exc));
    } finally {
      setBusy(false);
      setPass("");
    }
  };

  return (
    <Show when={canSyncKtu()} fallback={
      <p class="fineprint">
        Signing in to KTU needs the installed app. In a browser, paste or open
        a PDF instead.
      </p>
    }>
      <form onSubmit={run} class="ktu-form">
        <label>
          KTU register number
          <input class="field-input" value={user()} placeholder="e.g. ABC24CS001"
                 autocomplete="username"
                 onInput={(e) => setUser(e.currentTarget.value)} />
        </label>
        <label>
          KTU password
          <input class="field-input" type="password" value={pass()}
                 autocomplete="current-password"
                 onInput={(e) => setPass(e.currentTarget.value)} />
        </label>

        <Show when={canRemember()}>
          <label class="remember">
            <input type="checkbox" checked={remember()}
                   onChange={(e) => setRemember(e.currentTarget.checked)} />
            <span>Remember this login on this device</span>
          </label>
        </Show>

        <div class="setup-actions">
          <button class="primary" type="submit" disabled={busy() || !user().trim()}>
            {busy() ? "Fetching…" : "Fetch from KTU"}
          </button>
        </div>

        <p class="fineprint">
          <Show when={canRemember() && remember()} fallback={
            <>The KTU portal is read once for this fetch; the password is
              never saved and the session stays inside the app.</>
          }>
            Kept in {vaultName()} on this device — never in a backup, a
            log, or off this machine. Untick to forget it.
          </Show>
        </p>

        <Show when={error()}>
          <div class="notice bad"><strong>KTU sync failed.</strong> {error()}</div>
        </Show>
      </form>
    </Show>
  );
}
