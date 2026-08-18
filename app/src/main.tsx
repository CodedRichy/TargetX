/* Fonts are bundled, not fetched. A desktop app that falls back to Segoe UI
   because the campus wifi is down has no business calling itself desktop. */
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";

import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/screens.css";
import "./styles/motion.css";

import { render } from "solid-js/web";
import { App } from "./ui/App";

/**
 * Send uncaught frontend faults to the native side.
 *
 * The webview has no console anyone will ever read in a packaged build, so an
 * exception here is invisible - the UI simply stops responding to input. Both
 * handlers are best-effort: if the bridge is missing (a browser build, or
 * Tauri not ready yet) the failure to report must not itself throw.
 */
function reportFaults() {
  const send = (message: string) => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("log_error", { message }))
      .catch(() => { /* nothing to report to */ });
  };
  window.addEventListener("error", (event) => {
    send(`${event.message} @ ${event.filename}:${event.lineno}:${event.colno}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    send(`unhandled rejection: ${String(event.reason)}`);
  });
}
reportFaults();

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
render(() => <App />, root);
