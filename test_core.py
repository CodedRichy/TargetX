"""Headless checks for the TargetX calculation core (no UI, no display needed)."""

import sys
import types

# Stub customtkinter so the module imports without a display server.
if "customtkinter" not in sys.modules:
    try:
        import customtkinter  # noqa: F401
    except Exception:  # pragma: no cover
        sys.modules["customtkinter"] = types.ModuleType("customtkinter")

import targetx as tx

FAILED = []


def check(label, got, want):
    if got != want:
        FAILED.append(f"{label}: got {got!r}, want {want!r}")
        print(f"FAIL {label}: got {got!r}, want {want!r}")
    else:
        print(f"ok   {label}")


# --- CIE scaling -----------------------------------------------------------
c = tx.blank_course("PCCST302", "DSA", 4, "TH 40/60")
c.update({"s1": 40, "s2": 30, "other": 8})
# 40/50*15 + 30/50*15 + 8/10*10 = 12 + 9 + 8 = 29
check("CIE 40 scaling", tx.compute_cie(c), 29.0)

c50 = tx.blank_course("X", "Y", 3, "TH 50/50")
c50.update({"s1": 50, "s2": 50, "other": 10})
check("CIE 50 full marks", tx.compute_cie(c50), 50.0)

# --- ESE cutoff ------------------------------------------------------------
check("cutoff /60", tx.ese_cutoff(60), 24)
check("cutoff /50", tx.ese_cutoff(50), 20)
check("cutoff /25", tx.ese_cutoff(25), 10)

# --- Reverse engine: aggregate binds --------------------------------------
r = tx.required_ese(cie=29, target_letter="S", ese_max=60)
check("need S from CIE 29", r["value"], 61)       # 90-29=61 > 60 max
check("S reported impossible", r["text"], "Impossible")
check("S impossible", r["possible"], False)

r = tx.required_ese(cie=29, target_letter="B+", ese_max=60)
check("need B+ from CIE 29", (r["value"], r["binding"]), (46, "aggregate"))

# --- Reverse engine: separate ESE cutoff binds ----------------------------
r = tx.required_ese(cie=38, target_letter="P", ese_max=60)
# aggregate would say 12, but 40% of 60 = 24 rules
check("cutoff overrides aggregate", (r["value"], r["binding"]), (24, "cutoff"))

# --- Grade + fail paths ----------------------------------------------------
c2 = tx.blank_course("A", "A", 4, "TH 40/60")
c2.update({"s1": 50, "s2": 50, "other": 10, "ese": 23, "attendance": 90})
ev = tx.evaluate(c2)
# CIE 40 + ESE 23 = 63 total, but ESE 23 < 24 cutoff -> F
check("high CIE cannot buy a pass", ev["grade"], "F")

c2["ese"] = 24
ev = tx.evaluate(c2)
check("64 total -> C", ev["grade"], "C")

c2["ese"] = 50
ev = tx.evaluate(c2)
check("90 total -> S", ev["grade"], "S")

# --- Attendance eligibility ------------------------------------------------
c2["attendance"] = 70
check("attendance flag", tx.evaluate(c2)["eligible"], False)

# --- SGPA / percentage -----------------------------------------------------
check("sgpa weighted", tx.sgpa([(4, 10.0), (2, 5.5)]), 8.5)
check("percent = 10 x cgpa",
      tx.cgpa_from_semesters({"S1": {"sgpa": 8.5, "credits": 20}})["percent"], 85.0)

# --- etlab parser ----------------------------------------------------------
att = tx.parse_etlab(
    "PCCST302  Data Structures   38  42  90.48%\n"
    "PCCST303  OOP   30 40\n"
    "junk line no code here 55\n", "attendance")
check("etlab attendance rows", len(att), 2)
check("etlab percent parsed", att[0]["attendance"], 90.48)
check("etlab present/total derived", round(att[1]["attendance"], 1), 75.0)

marks = tx.parse_etlab("PCCST304 Digital Logic 45 38 9\n", "marks")
check("etlab marks mapped", (marks[0]["s1"], marks[0]["s2"], marks[0]["other"]),
      (45.0, 38.0, 9.0))

# --- Attendance marks (Regulations 2024, R 7.5.ii) -------------------------
check("att marks 85+", tx.attendance_marks(88), 5)
check("att marks 80-85", tx.attendance_marks(83), 4)
check("att marks 75-80", tx.attendance_marks(77), 3)
check("att marks 70-75", tx.attendance_marks(72), 2)
check("att marks 60-70", tx.attendance_marks(64), 1)
check("att marks below 60", tx.attendance_marks(55), 0)
check("condonation floor is 60", tx.ATTENDANCE_CONDONE, 60.0)
check("duty leave cap is 10pct", tx.DL_CAP_PCT, 10.0)

band = tx.next_attendance_band(15, 18)
check("next band from 83pct", (band["earned"], band["attend"], band["next_marks"]),
      (4, 2, 5))

# --- Duty leave ------------------------------------------------------------
plan = tx.attendance_plan(14, 18, 2)
check("DL lifts effective attendance", plan["current"], 87.78)
check("DL beyond cap is wasted", tx.attendance_plan(30, 50, 8)["dl_wasted"], 3.0)

# --- Goal engine -----------------------------------------------------------
history = {"S1": {"sgpa": 8.0, "credits": 20}, "S2": {"sgpa": 8.0, "credits": 20}}
need = tx.required_sgpa_for_cgpa(8.0, history, 20)
check("holding CGPA needs same SGPA", need["required"], 8.0)

need = tx.required_sgpa_for_cgpa(9.9, history, 20)
check("unreachable CGPA flagged", need["possible"], False)

goal_courses = [
    dict(tx.blank_course("PCCST501", "CN", 4), cie_override=30),
    dict(tx.blank_course("PCCST502", "DAA", 4), cie_override=32),
]
plan = tx.plan_for_sgpa(goal_courses, 7.5)
check("plan reaches target", plan["reachable"], True)
check("plan covers every course", len(plan["plan"]), 2)
check("plan stays inside the paper",
      all(row["ese"] <= 60 for row in plan["plan"]), True)
# With CIE 30/32 straight S is still reachable (needs 60 and 58), so the
# unreachable case needs genuinely capped courses: CIE 10 tops out at 70/100.
capped = [dict(tx.blank_course("X1", "low", 4), cie_override=10),
          dict(tx.blank_course("X2", "low", 4), cie_override=10)]
capped_plan = tx.plan_for_sgpa(capped, 9.0)
check("impossible target rejected", capped_plan["reachable"], False)
check("ceiling reported", capped_plan["max_sgpa"], 7.5)

# A published grade is final - no ESE mark needed to confirm it.
graded = dict(tx.blank_course("PCCST403", "OS", 4), cie_override=30,
              portal_grade="C", attendance=87)
check("published grade wins", tx.evaluate(graded)["grade"], "C")
check("published grade counts as assessed", tx.evaluate(graded)["assessed"], True)
check("PASSED maps to P", tx.normalise_grade("PASSED"), "P")
check("result word is not a grade", tx.normalise_grade("-"), None)


print()
if FAILED:
    print(f"{len(FAILED)} FAILURES")
    sys.exit(1)
print("all core checks passed")
