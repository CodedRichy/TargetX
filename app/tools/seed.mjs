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
};
