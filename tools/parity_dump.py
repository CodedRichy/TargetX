"""
Generate a parity fixture: the Python engine's answers for a synthetic corpus.

The TypeScript port has to agree with the Python original everywhere, not just
on the 33 hand-written cases. Those cases were written by the same person who
wrote the code, so they share its blind spots. This sweeps the input space
instead - every course type, marks present and absent, attendance above and
below both thresholds, duty leave inside and outside the cap - and records what
Python says. app/src/engine/__tests__/parity.test.ts then asserts TypeScript
says the same thing.

The corpus is synthetic and seeded, so the fixture is deterministic and carries
no student's data.

    python tools/parity_dump.py
"""

from __future__ import annotations

import json
import os
import random
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Stub customtkinter so the module imports without a display server.
if "customtkinter" not in sys.modules:
    try:
        import customtkinter  # noqa: F401
    except Exception:  # pragma: no cover
        sys.modules["customtkinter"] = types.ModuleType("customtkinter")

import targetx as tx  # noqa: E402

OUT = os.path.join(ROOT, "app", "src", "engine", "__tests__", "parity.json")

# Blank is a first-class value here: an unwritten mark must stay distinct from
# a zero all the way through the port, and that only gets tested if blanks are
# in the corpus.
MARKS = ["", 0, 7, 18, 25, 33, 40, 45, 50]
ASSIGN = ["", 0, 3, 6, 8, 10]
ESE = ["", 0, 9, 16, 20, 24, 31, 40, 48, 55, 60]
COUNTS = [("", ""), (0, 0), (14, 18), (15, 18), (30, 50), (45, 50),
          (9, 20), (38, 42), (17, 17)]
DL = ["", 0, 1, 2, 5, 8]
GRADES = [None, "", "-", "B+", "P", "PASSED", "FAILED", "F", "AB", "N/A", "S"]


def cases(count: int = 600) -> list:
    rng = random.Random(20260818)
    rows = []
    for _ in range(count):
        type_key = rng.choice(tx.TYPE_KEYS)
        attended, held = rng.choice(COUNTS)
        course = tx.blank_course("PCCST501", "Sample", rng.choice([0, 2, 3, 4, 5]),
                                 type_key)
        course.update({
            "s1": rng.choice(MARKS),
            "s2": rng.choice(MARKS),
            "other": rng.choice(ASSIGN),
            "ese": rng.choice(ESE),
            "attendance": rng.choice(["", 0, 55, 62, 71, 76, 83, 88, 100]),
            "attended": attended,
            "held": held,
            "dl": rng.choice(DL),
            "target": rng.choice(tx.TARGET_CHOICES),
            "cie_override": rng.choice(["", "", "", 10, 22, 30, 37, 48]),
            "portal_grade": rng.choice(GRADES),
        })
        rows.append(course)

    # Force the shapes the random draw makes vanishingly rare but that carry
    # the sharpest rules: a course nobody has marked at all (absence is not a
    # zero), and one that is graded but has no internals published.
    for type_key in tx.TYPE_KEYS:
        blank = tx.blank_course("PCCST777", "Untouched", 4, type_key)
        blank["attended"], blank["held"] = rng.choice(COUNTS)
        rows.append(blank)

        graded = tx.blank_course("PCCST888", "Graded only", 4, type_key)
        graded["portal_grade"] = rng.choice(["B+", "P", "F", "S"])
        graded["attendance"] = rng.choice([55, 71, 83, 92])
        rows.append(graded)

    return rows


def slim(ev: dict) -> dict:
    """Only the fields the UI actually reads. Keys are the TypeScript names."""
    need = lambda r: {"value": r["value"], "possible": r["possible"],
                      "text": r["text"], "binding": r["binding"]}
    plan = ev["plan"]
    band = ev["att_band"]
    return {
        "cie": ev["cie"],
        "cieMax": ev["cie_max"],
        "eseMax": ev["ese_max"],
        "ese": ev["ese"],
        "eseCutoff": ev["ese_cutoff"],
        "total": ev["total"],
        "grade": ev["grade"],
        "failedReason": ev["failed_reason"],
        "attendance": ev["attendance"],
        "eligible": ev["eligible"],
        "assessed": ev["assessed"],
        "attMarks": ev["att_marks"],
        "credits": ev["credits"],
        "needPass": need(ev["need_pass"]),
        "needTarget": need(ev["need_target"]),
        "target": ev["target"],
        "maxPossibleGrade": ev["max_possible_grade"],
        "status": tx.status_for(ev)[0],
        "plan": None if plan is None else {
            "raw": plan["raw"], "current": plan["current"],
            "dlClaimed": plan["dl_claimed"], "dlCredited": plan["dl_credited"],
            "dlWasted": plan["dl_wasted"], "state": plan["state"],
            "skip": plan["skip"], "attend": plan["attend"],
        },
        "attBand": None if band is None else {
            "earned": band["earned"], "nextMarks": band["next_marks"],
            "attend": band["attend"], "atPct": band["at_pct"],
        },
    }


def semester_cases(rows: list, rng: random.Random, count: int = 60) -> list:
    """Whole-semester rollups, where the confirmed/projected split lives."""
    out = []
    for _ in range(count):
        size = rng.randint(1, 8)
        courses = [dict(rng.choice(rows)) for _ in range(size)]
        summary = tx.summarise(courses)
        out.append({
            "courses": courses,
            "summary": {
                "pending": summary["pending"],
                "assessed": summary["assessed"],
                "sgpaConfirmed": summary["sgpa_confirmed"],
                "sgpaProjected": summary["sgpa_projected"],
                "credits": summary["credits"],
                "creditsConfirmed": summary["credits_confirmed"],
                "percentConfirmed": summary["percent_confirmed"],
                "percentProjected": summary["percent_projected"],
                "atRisk": summary["at_risk"],
                "impossible": summary["impossible"],
                "lowAttendance": summary["low_attendance"],
            },
        })
    return out


def main() -> int:
    rows = cases()
    fixture = {
        "generatedBy": "tools/parity_dump.py",
        "note": "Synthetic, seeded. Regenerate after any engine change.",
        "courses": [{"course": c, "expected": slim(tx.evaluate(c))} for c in rows],
        "semesters": semester_cases(rows, random.Random(4242)),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(fixture, handle, indent=1)
    print(f"wrote {len(fixture['courses'])} course cases and "
          f"{len(fixture['semesters'])} semester cases -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
