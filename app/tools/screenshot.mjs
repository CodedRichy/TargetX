/**
 * Screenshot every screen, in the order a real user meets them.
 *
 * Shipping UI without looking at it is how you get a layout that only works on
 * the one state you had in mind. The seed data below is synthetic - invented
 * codes and marks, no student's record - but shaped like a real fifth semester:
 * a couple of subjects in trouble, one attendance shortage, one already graded.
 *
 *   npx vite preview --port 4173
 *   node tools/screenshot.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = "http://localhost:4173/";
const VIEWPORT = { width: 1600, height: 950 };

const course = (code, name, credits, type, extra = {}) => ({
  code, name, credits, type,
  s1: "", s2: "", other: "", s1_max: "", s2_max: "", other_max: "",
  attendance: "", attended: "", held: "", dl: "",
  ese: "", target: "B+", cie_override: "", portal_grade: null,
  ...extra,
});

const seed = {
  version: 1,
  scheme: "KTU 2024",
  student: { name: "", reg_no: "", branch: "CSE", college: "mits.etlab.app" },
  activeSemester: "S5",
  etlab: {},
  onboarded: true,
  lastSync: "2026-08-18T09:12:00.000Z",
  semesters: {
    S5: {
      courses: [
        course("PCCST501", "Computer Networks", 4, "TH 40/60",
               { s1: 38, s2: 31, other: 8, attended: 41, held: 48 }),
        course("PCCST502", "Design and Analysis of Algorithms", 4, "TH 40/60",
               { s1: 22, s2: 19, other: 6, attended: 33, held: 46, target: "A" }),
        course("PCCST503", "Operating Systems", 3, "TH 40/60",
               { s1: 44, s2: 41, other: 9, attended: 45, held: 47, ese: 51 }),
        course("PBCST504", "Software Engineering", 3, "PBL 60/40",
               { s1: 40, s2: 36, other: 7, attended: 30, held: 44, dl: 3 }),
        course("PCCSL507", "Networks Lab", 2, "LAB 50/50",
               { s1: 42, s2: 38, other: 9, attended: 21, held: 22 }),
        course("PECST522", "Artificial Intelligence", 3, "TH 40/60",
               { attended: 18, held: 40 }),
        course("UCHUT501", "Industrial Economics", 2, "TH 40/60",
               { cie_override: 33, portal_grade: "B+", attended: 36, held: 42 }),
      ],
    },
    // A past semester with a deliberate credit error, so the History
    // cross-check has something real to catch.
    S4: {
      courses: [
        course("PCCST401", "Theory of Computation", 4, "TH 40/60", { portal_grade: "B" }),
        course("PCCST402", "Database Systems", 4, "TH 40/60", { portal_grade: "C+" }),
        course("PBCST404", "Compiler Design", 3, "PBL 60/40", { portal_grade: "B+" }),
        course("PCCSL408", "DBMS Lab", 2, "LAB 50/50", { portal_grade: "A" }),
      ],
    },
  },
  history: {
    S1: { sgpa: 7.95, credits: 20 },
    S2: { sgpa: 7.48, credits: 23 },
    S3: { sgpa: 6.42, credits: 25 },
    S4: { sgpa: 6.71, credits: 24 },
  },
  goal: { cgpa: 7.5 },
};

const browser = await chromium.launch();
mkdirSync("shots", { recursive: true });

/** A page with no saved state - what a first-time user gets. */
async function freshPage() {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/**
 * A page with the seed already in storage.
 *
 * addInitScript rather than "load, write, reload": it must be present before
 * the app's first render. Note the flip side, which caught me out once - an
 * init script also re-runs on reload, so a "cleared" page is never actually
 * clear. That is why the empty states above use a separate context.
 */
async function seededPage() {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await context.addInitScript((data) => {
    localStorage.setItem("targetx.state.v1", JSON.stringify(data));
  }, seed);
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// --- first run -------------------------------------------------------------

const setup = await freshPage();
await setup.screenshot({ path: "shots/01-welcome.png" });

await setup.getByRole("button", { name: "Get started" }).click();
await setup.waitForTimeout(250);
await setup.screenshot({ path: "shots/02-how-data-gets-in.png" });

await setup.getByText("Sign in to your college portal").click();
await setup.waitForTimeout(250);
await setup.screenshot({ path: "shots/03-sync.png" });

await setup.getByRole("button", { name: "← Other ways to start" }).click();
await setup.getByText("Pick from the KTU curriculum").click();
await setup.waitForTimeout(300);
await setup.screenshot({ path: "shots/04-subject-picker.png" });

// Straight to the goal step without committing a preset.
await setup.getByRole("button", { name: "← Other ways to start" }).click();
await setup.getByText("Start empty").click();
await setup.waitForTimeout(250);
await setup.screenshot({ path: "shots/05-goal.png" });

// --- the app ---------------------------------------------------------------

const app = await seededPage();
await app.screenshot({ path: "shots/06-home.png" });

// Home is the landing screen now, so the ledger has to be asked for. Scoping
// the row click to the table matters: a subject code appears on Home too.
await app.getByRole("button", { name: "Semester", exact: true }).click();
await app.waitForTimeout(250);
await app.screenshot({ path: "shots/07-ledger.png" });

await app.locator("table").getByText("PCCST502").first().click();
await app.waitForTimeout(250);
await app.screenshot({ path: "shots/08-subject-detail.png" });

await app.getByRole("button", { name: "History" }).click();
await app.waitForTimeout(250);
await app.screenshot({ path: "shots/09-history.png" });

await app.getByRole("button", { name: "Data" }).click();
await app.waitForTimeout(250);
await app.screenshot({ path: "shots/10-data.png" });

await browser.close();
console.log("wrote shots/01-welcome.png .. 10-data.png");
