/**
 * Screenshot the running app with seeded data.
 *
 * Shipping UI without looking at it is how you get a layout that only works on
 * an empty state. The data below is synthetic - invented codes and marks, no
 * student's record - but shaped like a real fifth semester: a couple of
 * subjects in trouble, one attendance shortage, one already graded.
 *
 *   npx vite preview --port 4173
 *   node tools/screenshot.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

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
  student: { name: "", reg_no: "", branch: "CSE", college: "" },
  activeSemester: "S5",
  etlab: {},
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
const page = await browser.newPage({
  viewport: { width: 1600, height: 950 },
  deviceScaleFactor: 2,
});

await page.addInitScript((data) => {
  localStorage.setItem("targetx.state.v1", JSON.stringify(data));
}, seed);

await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

mkdirSync("shots", { recursive: true });
await page.screenshot({ path: "shots/01-ledger.png" });

// The expanded row is the replacement for the old modal, so it needs looking
// at in place rather than in isolation.
await page.getByText("PCCST502").click();
await page.waitForTimeout(250);
await page.screenshot({ path: "shots/02-expanded.png" });

await page.getByRole("button", { name: "What the columns mean" }).click();
await page.waitForTimeout(150);
await page.screenshot({ path: "shots/03-glossary.png" });

// Empty state is the first thing every new user sees; it is not an edge case.
// It needs a context with no init script - clearing storage and reloading just
// lets the seed run again, which is how the first version of this file quietly
// screenshotted the populated app four times.
const fresh = await browser.newContext({
  viewport: { width: 1600, height: 950 },
  deviceScaleFactor: 2,
});
const blank = await fresh.newPage();
await blank.goto("http://localhost:4173/", { waitUntil: "networkidle" });
await blank.evaluate(() => document.fonts.ready);
await blank.screenshot({ path: "shots/04-empty.png" });

await browser.close();
console.log("wrote shots/01-ledger.png .. 04-empty.png");
