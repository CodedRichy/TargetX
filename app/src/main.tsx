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

import { render } from "solid-js/web";
import { App } from "./ui/App";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
render(() => <App />, root);
