/**
 * The "This build" card.
 *
 * Both facts on it are worthless on every day the app works, and are the whole
 * of the support conversation on the day it does not. `PRIVACY.md` and the
 * GitHub issue template both tell a student to find them here, so a silent
 * regression in this card breaks two documents that cannot themselves be
 * tested.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@solidjs/testing-library";
import { Data } from "../Data";

const logDir = vi.fn();
vi.mock("../../state/diagnostics", () => ({
  logDir: () => logDir(),
  canDiagnose: () => true,
}));

// The sync panel reaches for the Tauri bridge on mount; the Data screen is not
// what is under test here.
vi.mock("../SyncPanel", () => ({ SyncPanel: () => null }));

afterEach(cleanup);

/**
 * Imported at the top of the file, not with a dynamic `import()` inside each
 * test. The first transform of the Data screen and its dependency tree costs
 * seconds under a loaded full-suite run, and paying that inside a test spends
 * the 5s budget on module loading - which is a timeout that looks like a
 * product failure and appears roughly one run in seven.
 */
const renderData = () => render(() => <Data />);

describe("This build", () => {
  it("shows the version the updater compares against", async () => {
    logDir.mockResolvedValue(null);
    renderData();
    // Substituted by Vite from `src-tauri/tauri.conf.json`, which is the file
    // the updater reads. A second copy in `package.json` could drift from it;
    // this cannot.
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
    await waitFor(() =>
      expect(screen.getByText(__APP_VERSION__)).toBeTruthy());
  });

  it("shows the fault log folder when there is one", async () => {
    const dir = "C:\\Users\\a\\AppData\\Local\\cv.codedrichy.targetx\\logs";
    logDir.mockResolvedValue(dir);
    renderData();
    await waitFor(() => expect(screen.getByText(dir)).toBeTruthy());
  });

  it("says nothing about a log in a browser build, rather than an empty row", async () => {
    // `logDir` answers null both for "not the desktop app" and "the command
    // failed". A blank "Fault log:" row would read as a missing file rather
    // than as a feature that does not exist here.
    logDir.mockResolvedValue(null);
    renderData();
    await waitFor(() => expect(screen.getByText("Version")).toBeTruthy());
    expect(screen.queryByText("Fault log")).toBeNull();
  });

  it("keeps the privacy statement one click away", async () => {
    logDir.mockResolvedValue(null);
    const { container } = renderData();
    const link = container.querySelector('a[href*="PRIVACY.md"]');
    expect(link).toBeTruthy();
    // Opened outside the app: a webview that navigates itself to GitHub has
    // no way back to the dashboard.
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
  });
});
