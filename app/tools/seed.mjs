/**
 * The synthetic fifth semester every visual tool runs against.
 *
 * Invented codes and marks - no student's record - but shaped like a real one:
 * a couple of subjects in trouble, one attendance shortage, one already
 * graded, and a past semester carrying a deliberate credit error so the
 * History cross-check has something to catch. Shared so a screenshot and a
 * measurement are of the same app in the same state; when they were two copies
 * they drifted, and a layout fixed against one was still broken in the other.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

export const course = (code, name, credits, type, extra = {}) => ({
  code, name, credits, type,
  s1: "", s2: "", other: "", s1_max: "", s2_max: "", other_max: "",
  attendance: "", attended: "", held: "", dl: "",
  ese: "", target: "B+", cie_override: "", portal_grade: null,
  ...extra,
});

export const seed = {
  version: 1,
  scheme: "KTU 2024",
  student: { name: "", reg_no: "", branch: "CSE", college: "mits.etlab.app" },
  activeSemester: "S5",
  etlab: {},
  onboarded: true,
  theme: "dark",
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
  // Both totals, and they differ where there is a backlog - S3 registered 25
  // credits and earned 21. A seed carrying only the old single `credits` key
  // migrates to earned-only, which puts every screen into the "no registered
  // credit total" state; that state is worth looking at, but not as the
  // default one every screenshot is taken in.
  history: {
    S1: { sgpa: 7.95, creditsRegistered: 20, creditsEarned: 20 },
    S2: { sgpa: 7.48, creditsRegistered: 23, creditsEarned: 23 },
    S3: { sgpa: 6.42, creditsRegistered: 25, creditsEarned: 21 },
    S4: { sgpa: 6.71, creditsRegistered: 24, creditsEarned: 24 },
  },
  goal: { cgpa: 7.5 },
  // The day-wise attendance calendar and the weekly timetable. Both screens
  // render an empty "sync to see" placeholder without these, so a screenshot
  // run that skipped them would only ever review the empty state. Shaped like
  // the etlab parser output: five teaching days, eight periods, one holiday
  // row, and the mix of statuses (absent, on-duty, duty-leave) the legend has
  // to explain.
  daywiseAttendance: [
    { label: "Mon 18 Aug", periods: [
      { status: "present", subject: "Computer Networks" },
      { status: "present", subject: "Design and Analysis of Algorithms" },
      { status: "absent", subject: "Operating Systems" },
      { status: "present", subject: "Software Engineering" },
      { status: "present", subject: "Networks Lab" },
      { status: "present", subject: "Networks Lab" },
      { status: "none", subject: null },
      { status: "od", subject: "Artificial Intelligence" }] },
    { label: "Tue 19 Aug", periods: [
      { status: "present", subject: "Operating Systems" },
      { status: "absent", subject: "Computer Networks" },
      { status: "absent", subject: "Design and Analysis of Algorithms" },
      { status: "present", subject: "Industrial Economics" },
      { status: "present", subject: "Artificial Intelligence" },
      { status: "dutyleave", subject: "Software Engineering" },
      { status: "dutyleave", subject: "Software Engineering" },
      { status: "none", subject: null }] },
    { label: "Wed 20 Aug", periods: [
      { status: "holiday", subject: null }, { status: "holiday", subject: null },
      { status: "holiday", subject: null }, { status: "holiday", subject: null },
      { status: "holiday", subject: null }, { status: "holiday", subject: null },
      { status: "holiday", subject: null }, { status: "holiday", subject: null }] },
    { label: "Thu 21 Aug", periods: [
      { status: "present", subject: "Design and Analysis of Algorithms" },
      { status: "present", subject: "Computer Networks" },
      { status: "present", subject: "Operating Systems" },
      { status: "leave", subject: "Artificial Intelligence" },
      { status: "leave", subject: "Software Engineering" },
      { status: "present", subject: "Industrial Economics" },
      { status: "none", subject: null }, { status: "none", subject: null }] },
    { label: "Fri 22 Aug", periods: [
      { status: "present", subject: "Computer Networks" },
      { status: "present", subject: "Operating Systems" },
      { status: "present", subject: "Design and Analysis of Algorithms" },
      { status: "present", subject: "Networks Lab" },
      { status: "present", subject: "Networks Lab" },
      { status: "absent", subject: "Artificial Intelligence" },
      { status: "present", subject: "Software Engineering" },
      { status: "none", subject: null }] },
  ],
  timetable: {
    grid: [
      { day: "Monday", periods: [
        { subject: "Computer Networks", teacher: "Dr A Nair" },
        { subject: "Design and Analysis of Algorithms", teacher: "Prof R Menon" },
        { subject: "Operating Systems", teacher: "Dr S Pillai" },
        { subject: "Software Engineering", teacher: "Prof K Das" },
        { subject: "Networks Lab", teacher: "Dr A Nair" },
        { subject: "Networks Lab", teacher: "Dr A Nair" },
        { subject: null, teacher: null },
        { subject: "Artificial Intelligence", teacher: "Dr V Iyer" }] },
      { day: "Tuesday", periods: [
        { subject: "Operating Systems", teacher: "Dr S Pillai" },
        { subject: "Computer Networks", teacher: "Dr A Nair" },
        { subject: "Design and Analysis of Algorithms", teacher: "Prof R Menon" },
        { subject: "Industrial Economics", teacher: "Prof M Joseph" },
        { subject: "Artificial Intelligence", teacher: "Dr V Iyer" },
        { subject: "Software Engineering", teacher: "Prof K Das" },
        { subject: "Software Engineering", teacher: "Prof K Das" },
        { subject: null, teacher: null }] },
      { day: "Wednesday", periods: [
        { subject: "Design and Analysis of Algorithms", teacher: "Prof R Menon" },
        { subject: "Operating Systems", teacher: "Dr S Pillai" },
        { subject: "Computer Networks", teacher: "Dr A Nair" },
        { subject: "Artificial Intelligence", teacher: "Dr V Iyer" },
        { subject: "Software Engineering", teacher: "Prof K Das" },
        { subject: "Industrial Economics", teacher: "Prof M Joseph" },
        { subject: null, teacher: null },
        { subject: null, teacher: null }] },
      { day: "Thursday", periods: [
        { subject: "Computer Networks", teacher: "Dr A Nair" },
        { subject: "Design and Analysis of Algorithms", teacher: "Prof R Menon" },
        { subject: "Operating Systems", teacher: "Dr S Pillai" },
        { subject: "Artificial Intelligence", teacher: "Dr V Iyer" },
        { subject: "Software Engineering", teacher: "Prof K Das" },
        { subject: "Industrial Economics", teacher: "Prof M Joseph" },
        { subject: null, teacher: null },
        { subject: null, teacher: null }] },
      { day: "Friday", periods: [
        { subject: "Computer Networks", teacher: "Dr A Nair" },
        { subject: "Operating Systems", teacher: "Dr S Pillai" },
        { subject: "Design and Analysis of Algorithms", teacher: "Prof R Menon" },
        { subject: "Networks Lab", teacher: "Dr A Nair" },
        { subject: "Networks Lab", teacher: "Dr A Nair" },
        { subject: "Artificial Intelligence", teacher: "Dr V Iyer" },
        { subject: "Software Engineering", teacher: "Prof K Das" },
        { subject: null, teacher: null }] },
    ],
    substitutions: [
      { date: "Thu 21 Aug", period: 6, teacher: "Prof S Kurian", inPlaceOf: "Industrial Economics" },
    ],
  },
};

/**
 * Serve the built app, so a visual tool needs one command rather than two.
 *
 * `vite preview` in another terminal is the documented way and it is a trap:
 * a screenshot run against a preview of a STALE `dist` looks exactly like a
 * screenshot run against a fresh one. Serving the directory from inside the
 * tool means the bytes on screen are the bytes just built.
 */
export async function serve(port = 4173, root = "dist") {
  const TYPES = { ".html": "text/html", ".js": "text/javascript",
                  ".css": "text/css", ".json": "application/json",
                  ".svg": "image/svg+xml", ".png": "image/png",
                  ".woff2": "font/woff2", ".wasm": "application/wasm" };
  const server = createServer((req, res) => {
    const path = normalize(join(root, decodeURI((req.url || "/").split("?")[0])));
    // Anything unrecognised is the SPA's own route, so index.html answers it.
    const file = existsSync(path) && statSync(path).isFile() ? path : join(root, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((ready) => server.listen(port, ready));
  return { url: `http://localhost:${port}/`, stop: () => server.close() };
}
