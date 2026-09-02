import { invoke } from "@tauri-apps/api/core";

/**
 * A development-only record of what the ask box was asked and what came back.
 *
 * Written because the box could only be judged from the outside. Every unit
 * test asserts the behaviour the code was written to have; none of them could
 * say what happens when a real student types "cn attendance" into a real
 * semester - and the answer, when it was finally looked at, was a confident
 * figure about the wrong subject. This is the instrument that made that
 * visible, kept so the next regression is seen rather than deduced.
 *
 * It rides on `log_error`, which already exists and already writes to the app
 * log, so no new Rust command and no new capability is added for it.
 *
 * DEV ONLY, and the guard is the point rather than a detail: the questions a
 * student types into this box are the most private thing in the app, and
 * PRIVACY.md says nothing they type leaves this machine unless they ask a
 * question of the router. `import.meta.env.DEV` is a compile-time constant, so
 * in a shipped build the call below is not merely skipped - it is not present.
 */
export function trace(event: string, detail: string): void {
  if (!import.meta.env.DEV) return;
  void invoke("log_error", { message: `[ask] ${event}: ${detail}` })
    // Tracing must never be able to break the thing it is watching.
    .catch(() => {});
}
