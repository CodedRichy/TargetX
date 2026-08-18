"""
TargetX - KTU 2024 Scheme academic performance & internal mark tracker.

A local-first desktop app (customtkinter) that tracks Continuous Internal
Evaluation (CIE) component-by-component, predicts SGPA, and - the part every
other KTU calculator skips - reverse-solves the End Semester Exam (ESE) mark
you still need for a target grade.

Run:  python targetx.py
Deps: pip install customtkinter
Data: ktu_data.json (written next to this file)
"""

from __future__ import annotations

import csv
import json
import math
import os
import queue
import re
import sys
import threading
from datetime import datetime
from functools import lru_cache

try:
    import customtkinter as ctk
    from tkinter import messagebox
except ImportError:  # pragma: no cover
    sys.exit("customtkinter missing. Run: pip install customtkinter")


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def _resource_dir() -> str:
    """Where bundled read-only files live (differs once frozen into an exe)."""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def _data_dir() -> str:
    """
    Where the student's own files live.

    Critical for the packaged build: under PyInstaller one-file, the app
    unpacks into a temp folder that is DELETED on exit. Writing marks there
    would silently lose a whole semester. Frozen builds therefore save to
    %LOCALAPPDATA%\\TargetX, which survives, is user-writable, and does not
    need admin rights the way Program Files does.
    """
    if not getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(__file__))
    base = (os.environ.get("LOCALAPPDATA")
            or os.environ.get("XDG_DATA_HOME")
            or os.path.expanduser("~"))
    path = os.path.join(base, "TargetX")
    os.makedirs(path, exist_ok=True)
    return path


RESOURCE_DIR = _resource_dir()
APP_DIR = _data_dir()
DATA_FILE = os.path.join(APP_DIR, "ktu_data.json")
EXPORT_DIR = os.path.join(APP_DIR, "exports")


# ---------------------------------------------------------------------------
# KTU 2024 scheme specification
# ---------------------------------------------------------------------------

# (letter, minimum total out of 100, grade point)
GRADE_BANDS = [
    ("S", 90, 10.0),
    ("A+", 85, 9.0),
    ("A", 80, 8.5),
    ("B+", 75, 8.0),
    ("B", 70, 7.5),
    ("C+", 65, 7.0),
    ("C", 60, 6.5),
    ("D", 55, 6.0),
    ("P", 50, 5.5),
]
GRADE_POINTS = {letter: gp for letter, _, gp in GRADE_BANDS}
GRADE_POINTS["F"] = 0.0
NON_GRADED = set()
GRADE_MIN = {letter: lo for letter, lo, _ in GRADE_BANDS}

TOTAL_PASS_MARK = 50          # CIE + ESE must reach 50/100
ESE_PASS_FRACTION = 0.40      # separate ESE minimum: 40% of ESE maximum
ATTENDANCE_MIN = 75.0         # eligibility threshold (%)
# B.Tech Regulations 2024, R 6.2: the Principal may condone attendance below
# 75% only down to 60%, for at most two semesters and against a fee. Below
# 60% there is no appeal path at all.
ATTENDANCE_CONDONE = 60.0

# Course evaluation patterns. Each component is entered on its own natural
# scale and scaled into the CIE bucket, so a series marked out of 50 stays
# entered as /50 instead of being pre-scaled by hand on paper.
COURSE_TYPES = {
    "TH 40/60": {
        "label": "Theory - CIE 40 / ESE 60",
        "cie_max": 40,
        "ese_max": 60,
        # (json key, column header, raw max, weight inside CIE)
        "components": [
            ("s1", "S1", 50, 15),
            ("s2", "S2", 50, 15),
            ("other", "Asg", 10, 10),
        ],
    },
    "TH 50/50": {
        "label": "Theory - CIE 50 / ESE 50",
        "cie_max": 50,
        "ese_max": 50,
        "components": [
            ("s1", "S1", 50, 20),
            ("s2", "S2", 50, 20),
            ("other", "Asg", 10, 10),
        ],
    },
    # The 2024 scheme's real lab split. Earlier schemes used 75/25, which is
    # why so many calculators still show it - the pass mark differs.
    "LAB 50/50": {
        "label": "Lab / Practical - CIE 50 / ESE 50",
        "cie_max": 50,
        "ese_max": 50,
        "components": [
            ("s1", "Cont", 50, 25),
            ("s2", "Test", 50, 15),
            ("other", "Rec", 10, 10),
        ],
    },
    # Project-based-learning courses invert the split: more weight inside the
    # semester, a smaller final exam - but the 40% ESE rule still applies, so
    # the cutoff is 16/40.
    "PBL 60/40": {
        "label": "Project-based course - CIE 60 / ESE 40",
        "cie_max": 60,
        "ese_max": 40,
        "components": [
            ("s1", "Eval1", 50, 25),
            ("s2", "Eval2", 50, 25),
            ("other", "Work", 10, 10),
        ],
    },
    "LAB 75/25": {
        "label": "Lab / Practical - CIE 75 / ESE 25",
        "cie_max": 75,
        "ese_max": 25,
        "components": [
            ("s1", "Cont", 50, 45),
            ("s2", "Test", 50, 20),
            ("other", "Rec", 10, 10),
        ],
    },
    "PRJ 100/0": {
        "label": "Project / Internal only - CIE 100",
        "cie_max": 100,
        "ese_max": 0,
        "components": [
            ("s1", "Eval1", 50, 50),
            ("s2", "Eval2", 50, 40),
            ("other", "Rep", 10, 10),
        ],
    },
}
TYPE_KEYS = list(COURSE_TYPES.keys())
DEFAULT_TYPE = "TH 40/60"

TARGET_CHOICES = ["S", "A+", "A", "B+", "B", "C+", "C", "D", "P"]


# ---------------------------------------------------------------------------
# Presets. Editable templates - course lists shift between branches and
# revisions, so these seed the grid rather than lock it.
# ---------------------------------------------------------------------------

CURRICULUM_FILE = os.path.join(APP_DIR, "curriculum.json")
BUNDLED_CURRICULUM = os.path.join(RESOURCE_DIR, "curriculum.json")


def _ensure_user_curriculum():
    """
    Copy the bundled catalogue beside the user's data on first run.

    The point of curriculum.json is that a student fixes their batch's course
    codes once. Inside the exe it is read-only and wiped each launch, so it
    gets seeded into the data folder where edits actually persist.
    """
    if os.path.exists(CURRICULUM_FILE) or CURRICULUM_FILE == BUNDLED_CURRICULUM:
        return
    try:
        with open(BUNDLED_CURRICULUM, "r", encoding="utf-8") as src:
            payload = src.read()
        with open(CURRICULUM_FILE, "w", encoding="utf-8") as dst:
            dst.write(payload)
    except OSError:
        pass


_ensure_user_curriculum()


def load_presets() -> dict:
    """
    Build the preset menu from curriculum.json.

    Kept as data, not code, so a college or batch with different course codes
    is a one-file edit rather than a fork. Falls back to the built-ins below
    if the file is missing or malformed.
    """
    presets = {"-- preset --": []}
    path = CURRICULUM_FILE if os.path.exists(CURRICULUM_FILE) else BUNDLED_CURRICULUM
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None

    for sem, rows in sorted(data.get("common", {}).items()):
        presets[f"{sem} Common"] = [tuple(r) for r in rows]
    for branch, sems in sorted(data.get("branches", {}).items()):
        for sem, rows in sorted(sems.items()):
            presets[f"{sem} {branch}"] = [tuple(r) for r in rows]
    for name, rows in sorted(data.get("generic", {}).items()):
        presets[f"Blank: {name.replace('_', ' ')}"] = [tuple(r) for r in rows]
    return presets


BUILTIN_PRESETS = {
    "-- preset --": [],
    "S1 Common (2024)": [
        ("GAMAT101", "Mathematics for Information Science 1", 4, "TH 40/60"),
        ("GAPHT121", "Engineering Physics A", 4, "TH 40/60"),
        ("GBEST103", "Engineering Mechanics", 3, "TH 40/60"),
        ("GXEST104", "Algorithmic Thinking with Python", 3, "TH 40/60"),
        ("GYNMC105", "Life Skills for Engineers", 3, "TH 40/60"),
        ("GAPHL120", "Physics Lab", 1, "LAB 75/25"),
        ("GXEXL107", "Engineering Graphics Lab", 1, "LAB 75/25"),
    ],
    "S2 Common (2024)": [
        ("GBMAT201", "Mathematics for Information Science 2", 4, "TH 40/60"),
        ("GACHT122", "Engineering Chemistry", 4, "TH 40/60"),
        ("GBEST203", "Basic Electrical & Electronics", 3, "TH 40/60"),
        ("GXEST204", "Programming in C", 3, "TH 40/60"),
        ("GYMDL205", "Design & Engineering", 3, "TH 40/60"),
        ("GACHL122", "Chemistry Lab", 1, "LAB 75/25"),
        ("GXEXL208", "Workshop Lab", 1, "LAB 75/25"),
    ],
    "S3 CSE (2024)": [
        ("GCMAT301", "Discrete Mathematical Structures", 4, "TH 40/60"),
        ("PCCST302", "Data Structures & Algorithms", 4, "TH 40/60"),
        ("PCCST303", "Object Oriented Programming", 4, "TH 40/60"),
        ("PCCST304", "Digital Logic Design", 4, "TH 40/60"),
        ("PBCST305", "Computer Organization", 3, "TH 40/60"),
        ("PCCSL307", "Data Structures Lab", 2, "LAB 75/25"),
        ("PCCSL308", "OOP Lab", 2, "LAB 75/25"),
    ],
    "S4 CSE (2024)": [
        ("GDMAT401", "Probability & Statistics", 4, "TH 40/60"),
        ("PCCST402", "Operating Systems", 4, "TH 40/60"),
        ("PCCST403", "Database Management Systems", 4, "TH 40/60"),
        ("PCCST404", "Computer Networks", 4, "TH 40/60"),
        ("PBCST405", "Formal Languages & Automata", 3, "TH 40/60"),
        ("PCCSL407", "DBMS Lab", 2, "LAB 75/25"),
        ("PCCSL408", "Networks Lab", 2, "LAB 75/25"),
    ],
}

PRESETS = load_presets() or BUILTIN_PRESETS


# ---------------------------------------------------------------------------
# Palette / type. Deliberately not the default blue-grey CTk look.
# ---------------------------------------------------------------------------

BG = "#0E1116"
PANEL = "#161B22"
PANEL_HI = "#1D242E"
LINE = "#2A323D"
TEXT = "#E6EDF3"
MUTED = "#8B98A8"
AMBER = "#F2A33C"
TEAL = "#4CC9C0"
DANGER = "#E5484D"
WARN = "#E8A317"
GOOD = "#3FB950"

FONT_UI = "Segoe UI"
FONT_MONO = "Consolas"


# ---------------------------------------------------------------------------
# Pure calculation core (no UI dependency - unit-testable)
# ---------------------------------------------------------------------------

def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def to_float(text, default=0.0):
    try:
        return float(str(text).strip())
    except (TypeError, ValueError):
        return default


def to_optional_float(text):
    """Blank stays blank - an unwritten ESE is not a zero."""
    if text is None:
        return None
    s = str(text).strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def spec_for(type_key: str) -> dict:
    return COURSE_TYPES.get(type_key, COURSE_TYPES[DEFAULT_TYPE])


def ese_cutoff(ese_max: int) -> int:
    """Separate ESE minimum, rounded up so the printed number always passes."""
    if ese_max <= 0:
        return 0
    return int(math.ceil(ese_max * ESE_PASS_FRACTION - 1e-9))


def component_max(course: dict, key: str, default_max: float) -> float:
    """
    Per-course component maximum.

    Series exams are marked out of 40 at some colleges and 50 at others, and
    the portal states which. A published maximum always beats a built-in
    assumption, so sync writes it here and the scaling follows it.
    """
    value = to_optional_float(course.get(f"{key}_max"))
    return value if value and value > 0 else default_max


def compute_cie(course: dict) -> float:
    """
    The CIE the college would record.

    If the portal has published an internal total, that number IS the CIE -
    the registrar's arithmetic is authoritative and second-guessing it would
    show the student a figure their result sheet contradicts. Components are
    only summed when nothing has been published yet.
    """
    spec = spec_for(course.get("type", DEFAULT_TYPE))
    published = to_optional_float(course.get("cie_override"))
    if published is not None:
        return round(clamp(published, 0, spec["cie_max"]), 2)

    total = 0.0
    for key, _hdr, raw_max, weight in spec["components"]:
        limit = component_max(course, key, raw_max)
        raw = clamp(to_float(course.get(key, 0)), 0, limit)
        total += (raw / limit) * weight if limit else 0.0
    return round(clamp(total, 0, spec["cie_max"]), 2)


# R 6.3.ii: "Attendance relaxation is allowed up to a maximum of 10%".
DL_CAP_PCT = 10.0

# R 7.5.ii - CIE Marks for Attendance. Attendance is not only an eligibility
# gate, it is worth marks inside the internal total, and this is the part
# every other KTU calculator misses entirely: a student sitting at 76% is not
# "fine", they are two marks down before writing a single exam.
ATTENDANCE_MARK_BANDS = [
    (85.0, 5),
    (80.0, 4),
    (75.0, 3),
    (70.0, 2),
    (60.0, 1),
]
ATTENDANCE_MARK_MAX = 5


def attendance_marks(percent, max_marks: int = ATTENDANCE_MARK_MAX):
    """CIE marks earned by attendance alone, per R 7.5.ii."""
    percent = to_optional_float(percent)
    if percent is None:
        return None
    for floor, marks in ATTENDANCE_MARK_BANDS:
        if percent >= floor:
            return marks if max_marks == ATTENDANCE_MARK_MAX else \
                round(marks / ATTENDANCE_MARK_MAX * max_marks, 2)
    return 0


def next_attendance_band(attended, held, duty_leave=0,
                         dl_cap_pct: float = DL_CAP_PCT) -> dict:
    """
    What the next attendance mark costs, in classes.

    Turns "you are at 76%" into "three classes in a row earns one more CIE
    mark" - the only form of that fact a student can act on.
    """
    attended = to_optional_float(attended)
    held = to_optional_float(held)
    if attended is None or held is None or held <= 0:
        return None

    credited = min(max(0.0, to_float(duty_leave, 0.0)),
                   held * (dl_cap_pct / 100.0))
    effective = min(attended + credited, held)
    current = effective / held * 100.0
    earned = attendance_marks(current)

    for floor, marks in reversed(ATTENDANCE_MARK_BANDS):
        if marks <= earned:
            continue
        fraction = floor / 100.0
        if fraction >= 1:
            continue
        need = math.ceil((fraction * held - effective) / (1 - fraction) - 1e-9)
        if need > 0:
            return {"earned": earned, "next_marks": marks,
                    "attend": int(need), "at_pct": floor}
    return {"earned": earned, "next_marks": None, "attend": 0, "at_pct": None}


# The catalogue must be updatable without shipping a new 47MB binary. KTU
# revises the curriculum between batches, adds electives mid-scheme, and every
# branch is a separate PDF - so the exe carries a snapshot as a fallback while
# the live copy is fetched from the repo and cached beside the student's data.
CATALOGUE_URL = ("https://raw.githubusercontent.com/CodedRichy/TargetX/"
                 "main/curriculum.json")
CATALOGUE_TIMEOUT = 8


def catalogue_version(path: str) -> int:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return int(json.load(handle).get("version", 0))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return -1


def update_catalogue(url: str = CATALOGUE_URL) -> dict:
    """
    Pull a newer course catalogue if one has been published.

    Deliberately conservative: a fetched file replaces the local one only if
    it parses, carries a higher version number, and actually contains
    courses. A corrupt or empty download must never wipe a working catalogue,
    because that would silently break every credit and grade calculation.
    """
    try:
        import requests
    except ImportError:
        return {"updated": False, "reason": "requests not installed"}

    try:
        response = requests.get(url, timeout=CATALOGUE_TIMEOUT)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        return {"updated": False, "reason": f"{exc.__class__.__name__}: {exc}"}

    if not isinstance(payload, dict) or not payload.get("credits"):
        return {"updated": False, "reason": "downloaded catalogue has no courses"}

    remote = int(payload.get("version", 0) or 0)
    local = catalogue_version(CURRICULUM_FILE)
    if remote <= local:
        return {"updated": False, "reason": "already current",
                "version": local}

    tmp = CURRICULUM_FILE + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
        os.replace(tmp, CURRICULUM_FILE)
    except OSError as exc:
        return {"updated": False, "reason": str(exc)}

    course_catalogue.cache_clear()
    return {"updated": True, "version": remote,
            "courses": len(payload.get("credits", {}))}


@lru_cache(maxsize=1)
def course_catalogue() -> dict:
    """
    Flat code -> {credits, type, name} lookup built from curriculum.json.

    Populated by curriculum_import.py straight from KTU's published
    curriculum PDF, so credits and the CIA/ESE split come from the
    university rather than from a guess. Falls back to inference for any
    code the catalogue does not cover.
    """
    path = CURRICULUM_FILE if os.path.exists(CURRICULUM_FILE) \
        else BUNDLED_CURRICULUM
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle).get("credits", {}) or {}
    except (OSError, json.JSONDecodeError):
        return {}


def lookup_course(code: str) -> dict:
    """Catalogue entry for a code, or {} when it is not listed."""
    return course_catalogue().get((code or "").upper(), {})


def infer_credits(code: str) -> int:
    """
    Best estimate of a course's credits from its KTU 2024 code.

    Portals publish credits per SEMESTER, never per course, so this has to be
    inferred - and a wrong credit silently distorts SGPA, which is the one
    number the whole app exists to get right. The rule below reproduces the
    published earned-credit totals exactly for the S3 and S4 patterns it was
    checked against, and is deliberately paired with verify_credits() so a
    semester it gets wrong says so out loud instead of quietly lying.

    First-year semesters use a different structure and are NOT matched by
    this rule; they are expected to fail the check and be corrected by hand.
    """
    listed = lookup_course(code).get("credits")
    if listed:
        return listed
    block = re.match(r"^([A-Z]+)", (code or "").upper())
    letters = block.group(1) if block else ""
    if letters.endswith("L"):        # any lab / practical
        return 2
    if letters.startswith("PCC"):    # programme core theory
        return 4
    if letters.startswith(("PBC", "PEC")):   # bridge / elective theory
        return 3
    if letters.startswith("UCH"):    # humanities
        return 2
    if letters.startswith("UCE"):
        return 3
    return 4


def verify_credits(courses: list, published_total) -> dict:
    """
    Compare the credits in hand against the total the portal published.

    Returns matched=None when there is nothing to check against. This is the
    honesty valve on infer_credits: the student is told when the seeded
    numbers cannot be right, rather than discovering it after results.
    """
    published = to_optional_float(published_total)
    current = sum(to_float(c.get("credits", 0)) for c in courses)
    if published is None or published <= 0:
        return {"matched": None, "current": current, "published": None,
                "delta": None}
    delta = round(current - published, 2)
    return {"matched": abs(delta) < 0.01, "current": current,
            "published": published, "delta": delta}


def attendance_plan(attended, held, duty_leave=0,
                    floor_pct: float = ATTENDANCE_MIN,
                    dl_cap_pct: float = DL_CAP_PCT) -> dict:
    """
    Turn 'you are at 83%' into the number the student actually wants.

    Portals universally show attended/held and stop there, leaving everyone
    to do this arithmetic in their head - badly, because the two directions
    are not symmetric:

      - Above the line: how many classes can be skipped and still stay above
        it. Solve attended / (held + skip) >= f  ->  skip <= attended/f - held.
      - Below the line: how many must be attended CONSECUTIVELY to climb back.
        Solve (attended + n) / (held + n) >= f  ->  n >= (f*held - attended)/(1-f).

    Returns None when the portal gave no raw counts - a percentage alone
    cannot answer either question.
    """
    attended = to_optional_float(attended)
    held = to_optional_float(held)
    if attended is None or held is None or held <= 0:
        return None

    # Approved duty leave (NSS, sports, fests, placement drives) counts as
    # present, but only up to a cap. Students routinely panic over a raw
    # percentage that their DL already covers - and just as often assume DL
    # is unlimited, which it is not. Both errors are worth killing.
    claimed = max(0.0, to_float(duty_leave, 0.0))
    allowed = held * (dl_cap_pct / 100.0)
    credited = min(claimed, allowed)
    effective = min(attended + credited, held)

    fraction = floor_pct / 100.0
    raw = attended / held * 100.0
    current = effective / held * 100.0

    result = {
        "raw": round(raw, 2),
        "current": round(current, 2),
        "dl_claimed": claimed,
        "dl_credited": round(credited, 2),
        "dl_wasted": round(max(0.0, claimed - allowed), 2),
    }

    if current >= floor_pct:
        skip = math.floor(effective / fraction - held + 1e-9)
        result.update({"state": "surplus", "skip": max(0, int(skip)),
                       "attend": 0})
        return result

    if fraction >= 1:
        result.update({"state": "deficit", "skip": 0, "attend": None})
        return result
    need = math.ceil((fraction * held - effective) / (1 - fraction) - 1e-9)
    result.update({"state": "deficit", "skip": 0, "attend": max(0, int(need))})
    return result


def normalise_grade(value):
    """
    Accept the many ways a portal writes a grade, or reject it cleanly.

    Result columns say PASSED/FAILED while grade columns say B+ or P, and the
    two get mixed up in scraped rows - so only real grade letters survive.
    """
    if value is None:
        return None
    text = str(value).strip().upper()
    if text in ("", "-", "--"):
        return None
    # Pass/fail courses (life skills, NSS, professional writing) DO count.
    # Checked against the portal itself: it publishes GPA 5.5 for these rows,
    # and solving S2's published SGPA only works when they are included. An
    # earlier version excluded them and was wrong.
    if text in ("PASS", "PASSED", "P/F", "PF", "COMPLETED"):
        return "P"
    if text in ("FAIL", "FAILED", "F", "FE", "AB", "I", "W"):
        return "F"
    return text if text in GRADE_POINTS else None


def grade_for_total(total: float) -> str:
    for letter, lo, _gp in GRADE_BANDS:
        if total >= lo:
            return letter
    return "F"


def required_ese(cie: float, target_letter: str, ese_max: int) -> dict:
    """
    Reverse-solve the ESE mark needed for `target_letter`.

    Two constraints bind at once and both must hold:
      1. CIE + ESE >= band minimum for the grade
      2. ESE >= 40% of ESE maximum (separate minimum; a huge CIE cannot buy
         a pass, which is exactly where legacy 2019-era calculators lie)
    """
    band_min = GRADE_MIN[target_letter]
    cutoff = ese_cutoff(ese_max)

    if ese_max == 0:
        ok = cie >= band_min
        return {
            "value": 0,
            "possible": ok,
            "text": "n/a" if ok else "Impossible",
            "binding": "cie-only",
        }

    from_total = band_min - cie
    need = max(from_total, cutoff)
    need_int = int(math.ceil(need - 1e-9))
    need_int = max(need_int, 0)

    binding = "cutoff" if cutoff >= from_total else "aggregate"
    possible = need_int <= ese_max
    return {
        "value": need_int,
        "possible": possible,
        "text": f"{need_int}/{ese_max}" if possible else "Impossible",
        "binding": binding,
    }


def evaluate(course: dict) -> dict:
    """Full per-course verdict: CIE, projected total, grade, targets, flags."""
    spec = spec_for(course.get("type", DEFAULT_TYPE))
    ese_max = spec["ese_max"]
    cie = compute_cie(course)
    cutoff = ese_cutoff(ese_max)
    ese = to_optional_float(course.get("ese"))
    if ese is not None:
        ese = clamp(ese, 0, ese_max)

    attendance = clamp(to_float(course.get("attendance", 100), 100.0), 0, 100)
    plan = attendance_plan(course.get("attended"), course.get("held"),
                           course.get("dl", 0))
    # Duty leave changes eligibility, so the effective figure governs once
    # raw counts are known. Flagging a student short when their approved DL
    # already covers it is the exact false alarm this replaces.
    if plan is not None:
        attendance = plan["current"]
    eligible = attendance >= ATTENDANCE_MIN

    # A grade published by the university is final. It outranks anything this
    # app could derive, and it arrives WITHOUT an ESE mark - portals publish
    # the letter, never the exam score. Requiring an ESE before trusting it
    # would leave completed semesters permanently "unconfirmed".
    published_grade = normalise_grade(course.get("portal_grade"))

    total = None
    grade = None
    failed_reason = ""
    if published_grade is not None:
        grade = published_grade
        if ese is not None:
            total = round(cie + ese, 2)
    elif ese is not None or ese_max == 0:
        total = round(cie + (ese or 0), 2)
        if ese_max and ese < cutoff:
            grade = "F"
            failed_reason = f"ESE {ese:.0f} < cutoff {cutoff}"
        elif total < TOTAL_PASS_MARK:
            grade = "F"
            failed_reason = f"Total {total:.0f} < {TOTAL_PASS_MARK}"
        else:
            grade = grade_for_total(total)

    target = course.get("target", "B+")
    if target not in GRADE_MIN:
        target = "B+"

    # Has this course been assessed at all yet? With no series marks and no
    # published internal, a CIE of 0 is an absence of data, not a score of
    # zero - and reporting "you need 50/25, impossible" for a lab nobody has
    # graded yet would be a straight falsehood.
    assessed = published_grade is not None or         to_optional_float(course.get("cie_override")) is not None or any(
        to_optional_float(course.get(key)) is not None
        for key, _hdr, _raw, _w in spec["components"])

    return {
        "cie": cie,
        "cie_max": spec["cie_max"],
        "ese_max": ese_max,
        "ese": ese,
        "ese_cutoff": cutoff,
        "total": total,
        "grade": grade,
        "failed_reason": failed_reason,
        "attendance": attendance,
        "eligible": eligible,
        "assessed": assessed,
        "plan": plan,
        "att_marks": attendance_marks(attendance),
        "att_band": next_attendance_band(course.get("attended"),
                                         course.get("held"),
                                         course.get("dl", 0)),
        "credits": clamp(to_float(course.get("credits", 0)), 0, 20),
        "need_pass": required_ese(cie, "P", ese_max),
        "need_target": required_ese(cie, target, ese_max),
        "target": target,
        "max_possible_grade": grade_for_total(cie + ese_max),
    }


def sgpa(pairs) -> float:
    """pairs = iterable of (credits, grade_point)."""
    credits = sum(c for c, _ in pairs)
    if credits <= 0:
        return 0.0
    return round(sum(c * gp for c, gp in pairs) / credits, 3)


def summarise(courses: list) -> dict:
    """Whole-semester rollup. Confirmed vs projected are kept separate."""
    confirmed, projected = [], []
    total_credits = 0.0
    at_risk, impossible, low_attendance = [], [], []

    pending = 0
    for course in courses:
        ev = evaluate(course)
        credits = ev["credits"]
        total_credits += credits

        # An unassessed course contributes nothing but its attendance. Folding
        # a zero CIE into a projection would invent a bad prediction out of
        # missing data, which is the failure mode this app exists to avoid.
        if ev["grade"] is None and not ev["assessed"]:
            pending += 1
            if not ev["eligible"]:
                low_attendance.append(course.get("code") or "?")
            continue

        if ev["grade"] is not None:
            confirmed.append((credits, GRADE_POINTS[ev["grade"]]))
            projected.append((credits, GRADE_POINTS[ev["grade"]]))
        else:
            # Not yet written: project the target if reachable, else the best
            # grade still mathematically on the table.
            if ev["need_target"]["possible"]:
                projected.append((credits, GRADE_POINTS[ev["target"]]))
            else:
                projected.append((credits, GRADE_POINTS[ev["max_possible_grade"]]))

        if not ev["need_pass"]["possible"] and ev["grade"] is None:
            # A published grade settles the matter; do not warn that a course
            # already on the record is unreachable.
            impossible.append(course.get("code") or course.get("name") or "?")
        elif ev["grade"] == "F":
            at_risk.append(course.get("code") or "?")
        if not ev["eligible"]:
            low_attendance.append(course.get("code") or "?")

    return {
        "pending": pending,
        "assessed": len(projected),
        "sgpa_confirmed": sgpa(confirmed),
        "sgpa_projected": sgpa(projected),
        "credits": total_credits,
        "credits_confirmed": sum(c for c, _ in confirmed),
        "percent_confirmed": round(sgpa(confirmed) * 10, 2),
        "percent_projected": round(sgpa(projected) * 10, 2),
        "at_risk": at_risk,
        "impossible": impossible,
        "low_attendance": low_attendance,
    }


def required_sgpa_for_cgpa(target_cgpa: float, history: dict,
                           semester_credits: float) -> dict:
    """
    "I want an 8.0 CGPA" -> what this semester has to deliver.

    Solves target = (past_points + sgpa * credits) / (past_credits + credits)
    for sgpa. Reports impossibility honestly: past semesters are frozen, so
    a target can be arithmetically out of reach no matter what happens now,
    and telling a student to chase it anyway would be the cruel kind of wrong.
    """
    past_credits = sum(v.get("credits", 0) for v in history.values())
    past_points = sum(v.get("sgpa", 0) * v.get("credits", 0)
                      for v in history.values())
    credits = to_float(semester_credits, 0)

    if credits <= 0:
        return {"required": None, "possible": False,
                "reason": "no credits registered this semester"}

    needed = (target_cgpa * (past_credits + credits) - past_points) / credits
    needed = round(needed, 3)

    if needed > 10:
        # Even straight S grades cannot get there.
        best = round((past_points + 10 * credits) / (past_credits + credits), 3)
        return {"required": needed, "possible": False, "ceiling": best,
                "reason": f"even all-S this semester tops out at {best:.2f}"}
    if needed <= 0:
        return {"required": 0.0, "possible": True, "slack": True,
                "reason": "already secured by past semesters"}
    return {"required": needed, "possible": True, "slack": False}


def course_options(course: dict) -> list:
    """
    Every grade still reachable in a course, with what it costs.

    Cost is the ESE mark required - the only currency a student actually
    spends. Grades already impossible are omitted rather than shown greyed,
    because a plan built on them is not a plan.
    """
    ev = evaluate(course)
    if ev["grade"] is not None:          # already decided by a published grade
        return [{"grade": ev["grade"], "gp": GRADE_POINTS[ev["grade"]],
                 "ese": ev["ese"] or 0, "locked": True,
                 "credits": ev["credits"], "ese_max": ev["ese_max"]}]

    options = []
    for letter, _floor, gp in GRADE_BANDS:
        need = required_ese(ev["cie"], letter, ev["ese_max"])
        if need["possible"]:
            options.append({"grade": letter, "gp": gp, "ese": need["value"],
                            "locked": False, "credits": ev["credits"],
                            "ese_max": ev["ese_max"]})
    options.sort(key=lambda o: o["gp"])
    return options


def plan_for_sgpa(courses: list, target_sgpa: float) -> dict:
    """
    Cheapest route to a target SGPA: which subject to push, and how far.

    Greedy on the DIFFICULTY OF THE RESULT, not on marginal cost. Minimising
    total marks looks optimal and gives terrible advice: it buys the biggest
    credit jumps first and hands back a plan demanding 60/60 in two papers
    while leaving others at D. Pushing whichever subject has the easiest next
    rung spreads the load and produces a plan a person can actually attempt.
    """
    total_credits = sum(to_float(c.get("credits", 0)) for c in courses)
    if total_credits <= 0:
        return {"reachable": False, "reason": "no credits", "plan": []}

    needed_points = target_sgpa * total_credits

    ladders, current = {}, 0.0
    for course in courses:
        options = course_options(course)
        if not options:
            return {"reachable": False, "plan": [],
                    "reason": f"{course.get('code') or 'a course'} cannot be passed"}
        code = course.get("code") or course.get("name") or "?"
        ladders[code] = options
        current += options[0]["gp"] * options[0]["credits"]

    chosen = {code: 0 for code in ladders}
    ceiling = sum(opts[-1]["gp"] * opts[-1]["credits"]
                  for opts in ladders.values())

    if needed_points > ceiling + 1e-9:
        return {"reachable": False, "plan": [],
                "max_sgpa": round(ceiling / total_credits, 3),
                "reason": "target is above the best still available"}

    while current < needed_points - 1e-9:
        best_code, best_cost, best_gain = None, None, 0
        for code, options in ladders.items():
            index = chosen[code]
            if index + 1 >= len(options):
                continue
            here, nxt = options[index], options[index + 1]
            gain = (nxt["gp"] - here["gp"]) * here["credits"]
            if gain <= 0:
                continue
            ceiling_marks = nxt.get("ese_max") or 60
            # How hard the resulting requirement is, as a share of the paper.
            cost = nxt["ese"] / max(ceiling_marks, 1e-9)
            if best_cost is None or cost < best_cost:
                best_code, best_cost, best_gain = code, cost, gain
        if best_code is None:
            break
        chosen[best_code] += 1
        current += best_gain

    plan = []
    for code, index in chosen.items():
        pick = ladders[code][index]
        plan.append({"code": code, "grade": pick["grade"], "ese": pick["ese"],
                     "credits": pick["credits"], "locked": pick["locked"]})
    plan.sort(key=lambda row: -row["ese"])

    return {
        "reachable": current >= needed_points - 1e-9,
        "sgpa": round(current / total_credits, 3),
        "target": target_sgpa,
        "credits": total_credits,
        "plan": plan,
        "max_sgpa": round(ceiling / total_credits, 3),
    }


def cgpa_from_semesters(sem_map: dict) -> dict:
    """sem_map = {sem_name: {"sgpa": float, "credits": float}}."""
    credits = sum(v.get("credits", 0) for v in sem_map.values())
    if credits <= 0:
        return {"cgpa": 0.0, "credits": 0.0, "percent": 0.0}
    weighted = sum(v.get("sgpa", 0) * v.get("credits", 0) for v in sem_map.values())
    cgpa = round(weighted / credits, 3)
    # 2024 scheme: Percentage = 10 x CGPA. No (10 x CGPA) - 2.5 legacy fudge.
    return {"cgpa": cgpa, "credits": credits, "percent": round(cgpa * 10, 2)}


# ---------------------------------------------------------------------------
# etlab paste import
# ---------------------------------------------------------------------------

CODE_RE = re.compile(r"\b([A-Z]{2,6}\d{3}[A-Z]?)\b")
NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def parse_etlab(text: str, mode: str) -> list:
    """
    Tolerant parser for text copied out of an etlab page.

    etlab is session-authenticated and its markup varies per college, so
    scraping it is a maintenance treadmill. Copy-paste of the rendered table
    is stable across every deployment, so that is the contract here.

    mode "attendance": pulls a percentage, or derives one from a
                       present/total pair.
    mode "marks":      maps the numbers on the line onto S1, S2, Asg in order.
    """
    rows = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        code_match = CODE_RE.search(line)
        if not code_match:
            continue
        code = code_match.group(1)

        rest = line[code_match.end():]
        name_bits = re.split(r"\s{2,}|\t|\|", rest.strip())
        name = ""
        for bit in name_bits:
            candidate = bit.strip()
            if candidate and not NUM_RE.fullmatch(candidate.replace("%", "")):
                name = candidate
                break

        numbers = [float(n) for n in NUM_RE.findall(rest)]
        entry = {"code": code, "name": name}

        if mode == "attendance":
            percent = None
            pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%", rest)
            if pct_match:
                percent = float(pct_match.group(1))
            elif len(numbers) >= 2:
                present, total = numbers[0], numbers[1]
                if total > 0 and present <= total:
                    percent = present / total * 100
            elif len(numbers) == 1 and numbers[0] <= 100:
                percent = numbers[0]
            if percent is None:
                continue
            entry["attendance"] = round(clamp(percent, 0, 100), 2)
        else:
            marks = numbers[:3]
            if not marks:
                continue
            keys = ["s1", "s2", "other"]
            for key, value in zip(keys, marks):
                entry[key] = value

        rows.append(entry)
    return rows


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def blank_course(code="", name="", credits=3, type_key=DEFAULT_TYPE) -> dict:
    return {
        "code": code,
        "name": name,
        "credits": credits,
        "type": type_key,
        "s1": "",
        "s2": "",
        "other": "",
        "attendance": "",
        "ese": "",
        "target": "B+",
        "cie_override": "",
        "attended": "",
        "held": "",
        "dl": "",
        "s1_max": "",
        "s2_max": "",
        "other_max": "",
    }


def default_state() -> dict:
    return {
        "version": 1,
        "scheme": "KTU 2024",
        "student": {"name": "", "reg_no": "", "branch": "", "college": ""},
        "active_semester": "S1",
        "etlab": {},
        "semesters": {"S1": {"courses": []}},
        "history": {},  # {"S1": {"sgpa": 7.8, "credits": 21}}
    }


def load_state() -> dict:
    if not os.path.exists(DATA_FILE):
        return default_state()
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (json.JSONDecodeError, OSError):
        backup = DATA_FILE + ".corrupt"
        try:
            os.replace(DATA_FILE, backup)
        except OSError:
            pass
        return default_state()

    state = default_state()
    state.update({k: v for k, v in data.items() if k in state})
    if not state.get("semesters"):
        state["semesters"] = {"S1": {"courses": []}}
    if state.get("active_semester") not in state["semesters"]:
        state["active_semester"] = sorted(state["semesters"])[0]
    return state


def save_state(state: dict) -> None:
    """Atomic write - a crash mid-save must not eat a semester of marks."""
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------

def make_entry(parent, width, var, justify="center", mono=True):
    entry = ctk.CTkEntry(
        parent,
        width=width,
        height=28,
        textvariable=var,
        justify=justify,
        font=(FONT_MONO if mono else FONT_UI, 12),
        fg_color=PANEL_HI,
        border_color=LINE,
        border_width=1,
        text_color=TEXT,
        corner_radius=5,
    )
    return entry


def make_cell(parent, text, width, color=TEXT, bold=False, mono=True):
    return ctk.CTkLabel(
        parent,
        text=text,
        width=width,
        height=28,
        text_color=color,
        font=(FONT_MONO if mono else FONT_UI, 12, "bold" if bold else "normal"),
        anchor="center",
    )


# Column layout: (header, width)
COLUMNS = [
    ("CODE", 88),
    ("COURSE", 178),
    ("CR", 34),
    ("TYPE", 96),
    ("SER1", 48),
    ("SER2", 48),
    ("ASGN", 48),
    ("ATT%", 52),
    ("CIE", 62),
    ("ESE", 52),
    ("TOTAL", 58),
    ("GR", 40),
    ("TARGET", 78),
    ("NEED PASS", 78),
    ("NEED TGT", 78),
    ("DL", 40),
    ("BUNK", 62),
    ("ATT MK", 56),
    ("STATUS", 76),
    ("", 34),
]


# Plain-language explanation for every column. Jargon like CIE/ESE is the
# university's, not the student's - the app has to translate it, not echo it.
COLUMN_HELP = {
    "CODE": "The course code from your portal, e.g. PCCST502.",
    "COURSE": "Subject name. Edit it to whatever you actually call it.",
    "CR": ("Credits. Heavier subjects pull your SGPA harder. Your portal does "
           "not publish these per subject, so they are estimated - check them."),
    "TYPE": ("How the 100 marks are split.\n"
             "TH 40/60 = 40 internal + 60 final exam.\n"
             "TH 50/50 = 50 internal + 50 final exam.\n"
             "LAB 75/25 = 75 continuous + 25 lab exam."),
    "SER1": "Series exam 1 mark, out of whatever your college marks it (40 or 50).",
    "SER2": "Series exam 2 mark, same scale as Series 1.",
    "ASGN": "Assignment / course work mark.",
    "ATT%": "Attendance percentage. Below 75% you lose exam eligibility.",
    "CIE": ("Internal marks total - everything you earn BEFORE the final exam.\n"
            "Left blank it is calculated from your series and assignment marks.\n"
            "Type a number to use the exact total your college published."),
    "ESE": ("End Semester Exam - the big final university exam.\n"
            "Leave blank until you know your mark."),
    "TOTAL": "Internal + final exam, out of 100. Decides your grade.",
    "GR": "The grade that total earns. S is best, F is fail.",
    "TARGET": "The grade you are aiming for. Change it and the next column updates.",
    "NEED PASS": ("The minimum final exam mark that still passes you.\n"
                  "A * means the 40% exam rule is what is binding, not the "
                  "total - you cannot pass on internals alone."),
    "NEED TGT": "The final exam mark needed for your target grade.",
    "DL": ("Duty leave classes - NSS, sports, fests, placement drives.\n"
           "These count as attended, but only up to 10% of classes held."),
    "BUNK": ("+2 means you can miss 2 more classes and stay at 75%.\n"
             "-3 means you must attend 3 in a row to climb back to 75%."),
    "ATT MK": ("Marks your attendance itself earns inside the internal total "
               "(KTU 2024 rule R 7.5).\n"
               "85%+ = 5 marks, 80% = 4, 75% = 3, 70% = 2, 60% = 1, "
               "below 60% = 0.\n"
               "So 76% is not 'fine' - it is two marks gone before any exam."),
    "STATUS": ("SAFE - on track.\n"
               "TIGHT - passing needs a big final exam mark.\n"
               "PENDING - no internal marks published yet.\n"
               "SHORTAGE - attendance under 75%.\n"
               "DEBARRED - attendance under 65%.\n"
               "FAILED / UNREACHABLE - cannot pass this attempt."),
}


class Tooltip:
    """Hover help. Plain tkinter, because CTk has no tooltip of its own."""

    def __init__(self, widget, text: str):
        self.widget = widget
        self.text = text
        self.window = None
        widget.bind("<Enter>", self.show, add="+")
        widget.bind("<Leave>", self.hide, add="+")

    def show(self, _event=None):
        if self.window or not self.text:
            return
        x = self.widget.winfo_rootx() + 12
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 6
        self.window = ctk.CTkToplevel(self.widget)
        self.window.wm_overrideredirect(True)
        self.window.wm_geometry(f"+{x}+{y}")
        self.window.configure(fg_color=LINE)
        ctk.CTkLabel(self.window, text=self.text, justify="left",
                     font=(FONT_UI, 11), text_color=TEXT, fg_color=PANEL_HI,
                     corner_radius=6, wraplength=330,
                     padx=10, pady=8).pack(padx=1, pady=1)

    def hide(self, _event=None):
        if self.window is not None:
            self.window.destroy()
            self.window = None


def status_for(ev: dict) -> tuple:
    """Single verdict per subject: (label, colour). Worst condition wins."""
    if not ev["assessed"] and ev["total"] is None:
        # No internal assessment published yet. Attendance is still real and
        # still worth flagging, but nothing can be said about the marks.
        if ev["attendance"] < ATTENDANCE_CONDONE:
            return "DEBARRED", DANGER
        if ev["attendance"] < ATTENDANCE_MIN:
            return "SHORTAGE", WARN
        return "PENDING", MUTED
    if not ev["need_pass"]["possible"]:
        return "UNREACHABLE", DANGER
    if ev["grade"] == "F":
        return "FAILED", DANGER
    if ev["attendance"] < ATTENDANCE_CONDONE:
        return "DEBARRED", DANGER
    if ev["attendance"] < ATTENDANCE_MIN:
        return "SHORTAGE", WARN
    if ev["ese_max"] and ev["need_pass"]["value"] / ev["ese_max"] > 0.70:
        return "TIGHT", WARN
    return "SAFE", GOOD


class CourseRow:
    """One subject. Owns its tk vars and pushes changes upward on every edit."""

    def __init__(self, parent, course: dict, on_change, on_delete):
        self.parent = parent
        self.course = course
        self.on_change = on_change
        self.on_delete = on_delete
        self._muted = False

        self.frame = ctk.CTkFrame(parent, fg_color="transparent")

        self.vars = {}
        for key in ("code", "name", "credits", "s1", "s2", "other",
                    "attendance", "ese"):
            var = ctk.StringVar(value=str(course.get(key, "")))
            var.trace_add("write", self._on_var_write)
            self.vars[key] = var

        col = 0

        def place(widget):
            nonlocal col
            widget.grid(row=0, column=col, padx=2, pady=2)
            col += 1

        place(make_entry(self.frame, COLUMNS[0][1], self.vars["code"], "left", False))
        place(make_entry(self.frame, COLUMNS[1][1], self.vars["name"], "left", False))
        place(make_entry(self.frame, COLUMNS[2][1], self.vars["credits"]))

        self.type_menu = ctk.CTkOptionMenu(
            self.frame,
            values=TYPE_KEYS,
            width=COLUMNS[3][1],
            height=28,
            font=(FONT_MONO, 11),
            fg_color=PANEL_HI,
            button_color=LINE,
            button_hover_color=AMBER,
            text_color=TEXT,
            dropdown_fg_color=PANEL_HI,
            dropdown_text_color=TEXT,
            command=self._on_type_change,
        )
        self.type_menu.set(course.get("type", DEFAULT_TYPE))
        place(self.type_menu)

        self.comp_entries = []
        for idx, key in enumerate(("s1", "s2", "other")):
            entry = make_entry(self.frame, COLUMNS[4 + idx][1], self.vars[key])
            self.comp_entries.append(entry)
            place(entry)

        place(make_entry(self.frame, COLUMNS[7][1], self.vars["attendance"]))

        self.vars["cie_override"] = ctk.StringVar(
            value=str(course.get("cie_override", "")))
        self.vars["cie_override"].trace_add("write", self._on_var_write)
        self.cie_label = make_entry(self.frame, COLUMNS[8][1],
                                    self.vars["cie_override"])
        place(self.cie_label)

        place(make_entry(self.frame, COLUMNS[9][1], self.vars["ese"]))

        self.total_label = make_cell(self.frame, "-", COLUMNS[10][1])
        place(self.total_label)
        self.grade_label = make_cell(self.frame, "-", COLUMNS[11][1], MUTED, True)
        place(self.grade_label)

        self.target_menu = ctk.CTkOptionMenu(
            self.frame,
            values=TARGET_CHOICES,
            width=COLUMNS[12][1],
            height=28,
            font=(FONT_MONO, 11),
            fg_color=PANEL_HI,
            button_color=LINE,
            button_hover_color=TEAL,
            text_color=TEXT,
            dropdown_fg_color=PANEL_HI,
            dropdown_text_color=TEXT,
            command=self._on_target_change,
        )
        self.target_menu.set(course.get("target", "B+"))
        place(self.target_menu)

        self.need_pass_label = make_cell(self.frame, "-", COLUMNS[13][1])
        place(self.need_pass_label)
        self.need_target_label = make_cell(self.frame, "-", COLUMNS[14][1])
        place(self.need_target_label)
        self.vars["dl"] = ctk.StringVar(value=str(course.get("dl", "")))
        self.vars["dl"].trace_add("write", self._on_var_write)
        place(make_entry(self.frame, COLUMNS[15][1], self.vars["dl"]))
        self.bunk_label = make_cell(self.frame, "-", COLUMNS[16][1], MUTED, True)
        place(self.bunk_label)
        self.att_marks_label = make_cell(self.frame, "-", COLUMNS[17][1],
                                         MUTED, True)
        place(self.att_marks_label)
        self.status_label = make_cell(self.frame, "-", COLUMNS[18][1], MUTED,
                                      True, mono=False)
        place(self.status_label)

        self.del_button = ctk.CTkButton(
            self.frame,
            text="X",
            width=COLUMNS[19][1],
            height=28,
            font=(FONT_UI, 12, "bold"),
            fg_color=PANEL_HI,
            hover_color=DANGER,
            text_color=MUTED,
            corner_radius=5,
            command=lambda: self.on_delete(self),
        )
        place(self.del_button)

        self.apply_type_headers()
        self.refresh()

    # -- events ------------------------------------------------------------

    def _on_var_write(self, *_):
        if self._muted:
            return
        self.pull()
        self.refresh()
        self.on_change()

    def _on_type_change(self, value):
        self.course["type"] = value
        self.apply_type_headers()
        self.refresh()
        self.on_change()

    def _on_target_change(self, value):
        self.course["target"] = value
        self.refresh()
        self.on_change()

    # -- data --------------------------------------------------------------

    def pull(self):
        for key, var in self.vars.items():
            self.course[key] = var.get()

    def set_values(self, updates: dict):
        """External write (etlab import) without recursing through on_change."""
        self._muted = True
        for key, value in updates.items():
            if key in self.vars:
                self.vars[key].set("" if value is None else str(value))
                self.course[key] = self.vars[key].get()
            elif key in ("type", "target"):
                self.course[key] = value
        self._muted = False
        self.apply_type_headers()
        self.refresh()

    def apply_type_headers(self):
        spec = spec_for(self.course.get("type", DEFAULT_TYPE))
        for entry, (_key, header, raw_max, _w) in zip(self.comp_entries,
                                                      spec["components"]):
            entry.configure(placeholder_text=f"{header}/{raw_max}")

    # -- render ------------------------------------------------------------

    def refresh(self):
        ev = evaluate(self.course)

        published = self.course.get("cie_override", "") != ""
        self.cie_label.configure(
            placeholder_text=f"{ev['cie']:.1f}/{ev['cie_max']}",
            text_color=AMBER if published else TEXT)

        if ev["total"] is None:
            self.total_label.configure(text="-", text_color=MUTED)
            self.grade_label.configure(text="--", text_color=MUTED)
        else:
            self.total_label.configure(text=f"{ev['total']:.0f}", text_color=TEXT)
            grade = ev["grade"]
            colour = DANGER if grade == "F" else (
                GOOD if GRADE_POINTS[grade] >= 8.0 else TEXT)
            self.grade_label.configure(text=grade, text_color=colour)

        def paint(label, info, good_colour):
            # Nothing assessed yet means no honest target can be stated. A
            # figure here would be arithmetic on absent data.
            if not ev["assessed"] and ev["total"] is None:
                label.configure(text="--", text_color=MUTED)
                return
            if not info["possible"]:
                label.configure(text="IMPOSSIBLE", text_color=DANGER)
                return
            if ev["ese_max"] == 0:
                label.configure(text=info["text"],
                                text_color=GOOD if info["possible"] else DANGER)
                return
            ratio = info["value"] / ev["ese_max"]
            colour = good_colour if ratio <= 0.6 else (
                WARN if ratio <= 0.85 else DANGER)
            suffix = "*" if info["binding"] == "cutoff" else ""
            label.configure(text=info["text"] + suffix, text_color=colour)

        paint(self.need_pass_label, ev["need_pass"], GOOD)
        paint(self.need_target_label, ev["need_target"], TEAL)

        plan = ev["plan"]
        if plan is None:
            self.bunk_label.configure(text="--", text_color=MUTED)
        elif plan["state"] == "surplus":
            self.bunk_label.configure(
                text=f"+{plan['skip']}",
                text_color=GOOD if plan["skip"] else WARN)
        else:
            self.bunk_label.configure(
                text=("--" if plan["attend"] is None else f"-{plan['attend']}"),
                text_color=DANGER)

        marks = ev["att_marks"]
        if marks is None:
            self.att_marks_label.configure(text="--", text_color=MUTED)
        else:
            colour = GOOD if marks == ATTENDANCE_MARK_MAX else (
                DANGER if marks <= 1 else WARN)
            self.att_marks_label.configure(
                text=f"{marks}/{ATTENDANCE_MARK_MAX}", text_color=colour)

        label, colour = status_for(ev)
        self.status_label.configure(text=label, text_color=colour)

        self.frame.configure(fg_color="transparent" if ev["eligible"] else "#2A1416")

    def destroy(self):
        self.frame.destroy()


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

class TargetX(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("TargetX  -  KTU 2024 Scheme Tracker")
        self.geometry("1420x880")
        self.minsize(1180, 700)
        self.configure(fg_color=BG)

        self.state_data = load_state()
        self.rows: list[CourseRow] = []
        self._save_job = None

        self._build_header()
        self._build_toolbar()
        self._build_grid()
        self._build_footer()

        self.load_semester(self.state_data["active_semester"])
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.after(1500, self.refresh_catalogue)

    def refresh_catalogue(self):
        """
        Check for a newer course catalogue in the background.

        Never blocks startup and never reports failure loudly - an offline
        student still has the bundled snapshot, which is the whole point of
        shipping one.
        """
        result_queue = queue.Queue()

        def worker():
            result_queue.put(update_catalogue())

        def poll():
            try:
                outcome = result_queue.get_nowait()
            except queue.Empty:
                self.after(400, poll)
                return
            if outcome.get("updated"):
                self.alert_label.configure(
                    text=f"Course catalogue updated to v{outcome['version']} "
                         f"({outcome['courses']} courses). Re-sync to apply.",
                    text_color=TEAL)

        threading.Thread(target=worker, daemon=True).start()
        self.after(400, poll)

    # -- layout ------------------------------------------------------------

    def _build_header(self):
        header = ctk.CTkFrame(self, fg_color=PANEL, corner_radius=0, height=104)
        header.pack(fill="x", side="top")
        header.pack_propagate(False)

        left = ctk.CTkFrame(header, fg_color="transparent")
        left.pack(side="left", padx=22, pady=14)
        ctk.CTkLabel(left, text="TARGET X", font=(FONT_UI, 26, "bold"),
                     text_color=AMBER).pack(anchor="w")
        ctk.CTkLabel(left, text="KTU 2024 scheme  |  offline  |  reverse-grade engine",
                     font=(FONT_UI, 11), text_color=MUTED).pack(anchor="w")

        metrics = ctk.CTkFrame(header, fg_color="transparent")
        metrics.pack(side="right", padx=18, pady=10)

        self.metric_labels = {}
        for idx, (key, caption) in enumerate([
            ("sgpa_conf", "SGPA (confirmed)"),
            ("sgpa_proj", "SGPA (projected)"),
            ("percent", "PERCENTAGE"),
            ("credits", "CREDITS"),
            ("attendance", "ATTENDANCE"),
            ("at_risk", "AT RISK"),
        ]):
            card = ctk.CTkFrame(metrics, fg_color=PANEL_HI, corner_radius=8,
                                width=150, height=74)
            card.grid(row=0, column=idx, padx=5)
            card.pack_propagate(False)
            value = ctk.CTkLabel(card, text="-", font=(FONT_MONO, 22, "bold"),
                                 text_color=TEXT)
            value.pack(pady=(12, 0))
            ctk.CTkLabel(card, text=caption, font=(FONT_UI, 9),
                         text_color=MUTED).pack()
            self.metric_labels[key] = value

    def _build_toolbar(self):
        bar = ctk.CTkFrame(self, fg_color=BG, height=52)
        bar.pack(fill="x", padx=18, pady=(12, 6))

        def button(text, command, colour=PANEL_HI, hover=AMBER, width=118):
            return ctk.CTkButton(bar, text=text, command=command, width=width,
                                 height=32, corner_radius=6,
                                 font=(FONT_UI, 12, "bold"),
                                 fg_color=colour, hover_color=hover,
                                 text_color=TEXT)

        ctk.CTkLabel(bar, text="SEM", font=(FONT_UI, 11, "bold"),
                     text_color=MUTED).pack(side="left", padx=(0, 6))
        self.sem_menu = ctk.CTkOptionMenu(
            bar, values=sorted(self.state_data["semesters"]), width=86, height=32,
            font=(FONT_MONO, 12), fg_color=PANEL_HI, button_color=LINE,
            button_hover_color=AMBER, dropdown_fg_color=PANEL_HI,
            command=self.load_semester)
        self.sem_menu.set(self.state_data["active_semester"])
        self.sem_menu.pack(side="left", padx=(0, 6))

        button("+ Semester", self.add_semester, width=104).pack(side="left", padx=3)
        button("+ Subject", self.add_subject, width=100).pack(side="left", padx=3)

        self.preset_menu = ctk.CTkOptionMenu(
            bar, values=list(PRESETS), width=160, height=32,
            font=(FONT_MONO, 11), fg_color=PANEL_HI, button_color=LINE,
            button_hover_color=TEAL, dropdown_fg_color=PANEL_HI,
            command=self.apply_preset)
        self.preset_menu.set("-- preset --")
        self.preset_menu.pack(side="left", padx=3)

        self.sync_button = button("Sync etlab", self.open_sync, colour=TEAL,
                                  hover=AMBER, width=104)
        self.sync_button.configure(text_color="#08201F")
        self.sync_button.pack(side="left", padx=3)
        self.import_menu = ctk.CTkOptionMenu(
            bar, values=["Paste a table", "KTU grade card", "Public page URL"],
            width=140, height=32, font=(FONT_MONO, 11), fg_color=PANEL_HI,
            button_color=LINE, button_hover_color=TEAL,
            dropdown_fg_color=PANEL_HI, command=self.route_import)
        self.import_menu.set("Import from...")
        self.import_menu.pack(side="left", padx=3)
        button("Export", self.export_report, hover=TEAL,
               width=84).pack(side="left", padx=3)
        button("Lock SGPA", self.lock_semester, hover=TEAL,
               width=100).pack(side="left", padx=3)

        self.cgpa_label = ctk.CTkLabel(bar, text="CGPA -", font=(FONT_MONO, 14, "bold"),
                                       text_color=AMBER)
        self.cgpa_label.pack(side="right", padx=8)

        help_button = ctk.CTkButton(
            bar, text="?  What do these mean", command=self.open_help,
            width=160, height=32, corner_radius=6,
            font=(FONT_UI, 12, "bold"), fg_color=PANEL_HI, hover_color=TEAL,
            text_color=TEXT)
        help_button.pack(side="right", padx=6)

    def _build_grid(self):
        shell = ctk.CTkFrame(self, fg_color=PANEL, corner_radius=10)
        shell.pack(fill="both", expand=True, padx=18, pady=(0, 6))

        head = ctk.CTkFrame(shell, fg_color="transparent", height=30)
        head.pack(fill="x", padx=10, pady=(10, 0))
        for idx, (title, width) in enumerate(COLUMNS):
            label = ctk.CTkLabel(head, text=title, width=width, height=22,
                                 font=(FONT_UI, 10, "bold"),
                                 text_color=TEAL if title in COLUMN_HELP else MUTED,
                                 anchor="center")
            label.grid(row=0, column=idx, padx=2)
            if title in COLUMN_HELP:
                Tooltip(label, title + "\n\n" + COLUMN_HELP[title])

        self.scroll = ctk.CTkScrollableFrame(shell, fg_color="transparent")
        self.scroll.pack(fill="both", expand=True, padx=8, pady=8)

        self.empty_label = ctk.CTkLabel(
            self.scroll,
            text="No subjects yet.  Pick a preset, or hit + Subject.",
            font=(FONT_UI, 13), text_color=MUTED)

    def _build_footer(self):
        foot = ctk.CTkFrame(self, fg_color=PANEL, corner_radius=10, height=76)
        foot.pack(fill="x", padx=18, pady=(0, 14))
        foot.pack_propagate(False)

        self.alert_label = ctk.CTkLabel(
            foot, text="", font=(FONT_UI, 12), text_color=WARN,
            anchor="w", justify="left")
        self.alert_label.pack(side="left", padx=16, pady=8, fill="x", expand=True)

        legend = ("C1/C2/C3 scale into CIE  |  * = ESE 40% cutoff binds, not the "
                  "aggregate  |  autosaved to ktu_data.json")
        ctk.CTkLabel(foot, text=legend, font=(FONT_UI, 10),
                     text_color=MUTED).pack(side="right", padx=16)

    # -- semester plumbing -------------------------------------------------

    @property
    def courses(self) -> list:
        sem = self.state_data["active_semester"]
        return self.state_data["semesters"].setdefault(sem, {"courses": []})["courses"]

    def load_semester(self, name):
        if name not in self.state_data["semesters"]:
            self.state_data["semesters"][name] = {"courses": []}
        self.state_data["active_semester"] = name
        self.sem_menu.set(name)
        self.rebuild_rows()
        self.schedule_save()

    def add_semester(self):
        existing = self.state_data["semesters"]
        for idx in range(1, 13):
            name = f"S{idx}"
            if name not in existing:
                existing[name] = {"courses": []}
                self.sem_menu.configure(values=sorted(existing))
                self.load_semester(name)
                return
        messagebox.showinfo("TargetX", "All 8+ semesters already exist.")

    def rebuild_rows(self):
        for row in self.rows:
            row.destroy()
        self.rows.clear()
        self.empty_label.pack_forget()

        if not self.courses:
            self.empty_label.pack(pady=40)
        for course in self.courses:
            row = CourseRow(self.scroll, course, self.on_row_change, self.delete_row)
            row.frame.pack(fill="x", pady=1)
            self.rows.append(row)
        self.recompute()

    def add_subject(self):
        self.courses.append(blank_course())
        self.rebuild_rows()
        self.schedule_save()

    def delete_row(self, row: CourseRow):
        label = row.course.get("code") or row.course.get("name") or "this subject"
        if not messagebox.askyesno("Remove subject", f"Remove {label}?"):
            return
        try:
            self.courses.remove(row.course)
        except ValueError:
            pass
        self.rebuild_rows()
        self.schedule_save()

    def apply_preset(self, name):
        rows = PRESETS.get(name, [])
        self.preset_menu.set("-- preset --")
        if not rows:
            return
        if self.courses and not messagebox.askyesno(
                "Apply preset",
                f"Replace the {len(self.courses)} subject(s) in "
                f"{self.state_data['active_semester']} with {name}?"):
            return
        self.courses.clear()
        for code, title, credits, type_key in rows:
            self.courses.append(blank_course(code, title, credits, type_key))
        self.rebuild_rows()
        self.schedule_save()

    # -- compute + persist -------------------------------------------------

    def on_row_change(self):
        self.recompute()
        self.schedule_save()

    def recompute(self):
        stats = summarise(self.courses)

        history = dict(self.state_data.get("history", {}))
        current = self.state_data["active_semester"]
        # Only a semester with real results belongs in CGPA. A projection
        # built from unassessed courses would drag the headline number down
        # for no reason the student could act on.
        # Never let a recomputation overwrite a semester the university has
        # already published - that would make CGPA drift just by clicking
        # through semesters.
        if stats["credits_confirmed"] and current not in history:
            history[current] = {"sgpa": stats["sgpa_confirmed"],
                                "credits": stats["credits_confirmed"]}
        overall = cgpa_from_semesters(history)

        # A semester whose SGPA the university has published shows THAT
        # number. Recomputing it is still done, but only as a cross-check:
        # if the two disagree the credits are wrong, and the student is told
        # rather than shown a figure their result sheet contradicts.
        published_sgpa = to_optional_float(
            self.state_data.get("history", {}).get(current, {}).get("sgpa"))
        self.sgpa_mismatch = None
        if published_sgpa is not None:
            shown = f"{published_sgpa:.2f}"
            if stats["credits_confirmed"] and \
                    abs(published_sgpa - stats["sgpa_confirmed"]) > 0.05:
                self.sgpa_mismatch = (published_sgpa, stats["sgpa_confirmed"])
        elif stats["credits_confirmed"]:
            shown = f"{stats['sgpa_confirmed']:.2f}"
        else:
            shown = "-"
        self.metric_labels["sgpa_conf"].configure(
            text=shown,
            text_color=WARN if self.sgpa_mismatch else TEXT)
        self.metric_labels["sgpa_proj"].configure(
            text=f"{stats['sgpa_projected']:.2f}" if stats["assessed"] else "-",
            text_color=TEAL)
        self.metric_labels["percent"].configure(
            text=f"{overall['percent']:.1f}" if overall["credits"] else "-")
        self.metric_labels["credits"].configure(text=f"{stats['credits']:.0f}")

        attendances = [to_float(c.get("attendance"), -1) for c in self.courses]
        attendances = [a for a in attendances if a >= 0]
        if attendances:
            worst = min(attendances)
            mean = sum(attendances) / len(attendances)
            colour = GOOD if worst >= ATTENDANCE_MIN else (
                WARN if worst >= ATTENDANCE_CONDONE else DANGER)
            self.metric_labels["attendance"].configure(
                text=f"{mean:.0f}%", text_color=colour)
        else:
            self.metric_labels["attendance"].configure(text="-", text_color=TEXT)

        flagged = [status_for(evaluate(c))[0] for c in self.courses]
        risky = [s for s in flagged if s not in ("SAFE", "PENDING")]
        critical = [s for s in risky
                    if s in ("UNREACHABLE", "FAILED", "DEBARRED")]
        self.metric_labels["at_risk"].configure(
            text=str(len(risky)),
            text_color=DANGER if critical else (WARN if risky else GOOD))

        self.cgpa_label.configure(
            text=f"CGPA {overall['cgpa']:.2f}   =   {overall['percent']:.1f}%")

        alerts = []
        if getattr(self, "sgpa_mismatch", None):
            published, computed = self.sgpa_mismatch
            alerts.append(
                f"SGPA: portal published {published:.2f}, these credits give "
                f"{computed:.2f}. The portal is right - fix the CR column.")
        check = self.state_data["semesters"].get(current, {}).get("credit_check")
        if check and check.get("matched") is False:
            alerts.append(
                f"CREDITS: these add to {check['current']:.0f} but the portal "
                f"published {check['published']:.0f} earned for {current}. "
                f"Fix the CR column - SGPA depends on it.")
        if stats["impossible"]:
            alerts.append("UNREACHABLE PASS: " + ", ".join(stats["impossible"]))
        if stats["at_risk"]:
            alerts.append("FAILED as entered: " + ", ".join(stats["at_risk"]))
        if stats["low_attendance"]:
            alerts.append(f"ATTENDANCE < {ATTENDANCE_MIN:.0f}%: "
                          + ", ".join(stats["low_attendance"]))
        if alerts:
            self.alert_label.configure(text="   |   ".join(alerts), text_color=DANGER)
        else:
            self.alert_label.configure(
                text="All subjects eligible and mathematically reachable.",
                text_color=GOOD)

    def schedule_save(self):
        """Debounced autosave - keystrokes must not hammer the disk."""
        if self._save_job is not None:
            self.after_cancel(self._save_job)
        self._save_job = self.after(400, self._do_save)

    def _do_save(self):
        self._save_job = None
        for row in self.rows:
            row.pull()
        try:
            save_state(self.state_data)
        except OSError as exc:
            self.alert_label.configure(text=f"SAVE FAILED: {exc}", text_color=DANGER)

    def lock_semester(self):
        """Freeze the current semester's SGPA into history for CGPA maths."""
        stats = summarise(self.courses)
        if not stats["credits_confirmed"]:
            messagebox.showwarning(
                "Nothing to lock",
                "No course has an ESE mark entered yet, so there is no "
                "confirmed SGPA to lock.")
            return
        sem = self.state_data["active_semester"]
        self.state_data.setdefault("history", {})[sem] = {
            "sgpa": stats["sgpa_confirmed"],
            "credits": stats["credits_confirmed"],
        }
        self._do_save()
        self.recompute()
        messagebox.showinfo(
            "Locked",
            f"{sem} locked at SGPA {stats['sgpa_confirmed']:.2f} over "
            f"{stats['credits_confirmed']:.0f} credits.")

    # -- etlab live sync ---------------------------------------------------

    def open_sync(self):
        try:
            import etlab_sync
        except SystemExit:
            messagebox.showerror(
                "Missing dependencies",
                "Live sync needs:\n\npip install requests beautifulsoup4\n\n"
                "Paste import works without them.")
            return

        window = ctk.CTkToplevel(self)
        window.title("Sync from etlab")
        window.geometry("560x440")
        window.configure(fg_color=BG)
        window.transient(self)
        window.after(120, window.grab_set)

        ctk.CTkLabel(window, text="etlab live sync", font=(FONT_UI, 18, "bold"),
                     text_color=AMBER).pack(anchor="w", padx=20, pady=(18, 2))
        ctk.CTkLabel(
            window,
            text=("Your password is used once for this login and never written "
                  "to disk.\nOnly session cookies are cached, in "
                  "etlab_session.json - separate from your marks file."),
            font=(FONT_UI, 11), text_color=MUTED, justify="left"
        ).pack(anchor="w", padx=20, pady=(0, 12))

        saved = self.state_data.get("etlab", {})
        fields = {}
        for key, caption, secret, default in [
            ("url", "College portal URL", False, saved.get("url", "")),
            ("user", "Username / Admission No.", False, saved.get("user", "")),
            ("password", "Password", True, ""),
        ]:
            ctk.CTkLabel(window, text=caption.upper(), font=(FONT_UI, 10, "bold"),
                         text_color=MUTED).pack(anchor="w", padx=20)
            var = ctk.StringVar(value=default)
            entry = ctk.CTkEntry(
                window, textvariable=var, height=34, font=(FONT_MONO, 13),
                fg_color=PANEL, border_color=LINE, border_width=1,
                text_color=TEXT, show="*" if secret else "")
            entry.pack(fill="x", padx=20, pady=(2, 10))
            fields[key] = var

        remember = ctk.BooleanVar(value=bool(saved.get("remember", True)))
        ctk.CTkCheckBox(window, text="Keep this session for one-click re-sync",
                        variable=remember, font=(FONT_UI, 12), text_color=TEXT,
                        fg_color=TEAL, border_color=LINE, hover_color=AMBER
                        ).pack(anchor="w", padx=20, pady=(0, 8))

        status = ctk.CTkLabel(window, text="", font=(FONT_UI, 12),
                              text_color=MUTED, wraplength=500, justify="left")
        status.pack(anchor="w", padx=20, pady=(2, 6))

        button = ctk.CTkButton(window, text="Sync now", height=36, fg_color=TEAL,
                               hover_color=AMBER, text_color="#08201F",
                               font=(FONT_UI, 13, "bold"))
        button.pack(fill="x", padx=20, pady=(0, 16))

        result_queue = queue.Queue()

        def worker(url, user, password, reuse):
            """Network work off the Tk thread - the UI must stay alive."""
            try:
                client = None
                if reuse:
                    client = etlab_sync.EtlabClient.from_session()
                    if client is not None and not client.session_alive():
                        client = None
                if client is None:
                    client = etlab_sync.EtlabClient(url)
                    client.login(user, password)

                # The academic record carries every semester at once, so it
                # is tried first; the per-page scrape is the fallback for
                # deployments that do not expose it.
                payload = None
                try:
                    academics = client.fetch_academics()
                    payload = ("full", etlab_sync.academics_to_state(
                        academics, client.fetch_subject_types()))
                except etlab_sync.EtlabError:
                    payload = ("rows", client.sync())

                if remember_flag:
                    client.save_session()
                else:
                    etlab_sync.EtlabClient.forget_session()
                result_queue.put(("ok", payload))
            except etlab_sync.EtlabError as exc:
                result_queue.put(("error", str(exc)))
            except Exception as exc:  # network stacks throw a wide zoo
                result_queue.put(("error", f"{exc.__class__.__name__}: {exc}"))

        def poll():
            try:
                kind, payload = result_queue.get_nowait()
            except queue.Empty:
                window.after(150, poll)
                return

            button.configure(state="normal", text="Sync now")
            if kind == "error":
                status.configure(text=payload, text_color=DANGER)
                return

            kind_tag, body = payload
            if kind_tag == "full":
                summary = self.apply_full_sync(body)
            else:
                updated, added = self.merge_import(etlab_sync.merge_sync(body))
                summary = f"{updated} subject(s) updated, {added} added."
            self.state_data["etlab"] = {
                "url": fields["url"].get().strip(),
                "user": fields["user"].get().strip(),
                "remember": bool(remember.get()),
            }
            self.schedule_save()
            warnings = "\n".join(body.get("warnings", [])
                                 if isinstance(body, dict) else [])
            window.destroy()
            messagebox.showinfo(
                "Sync complete",
                summary + (f"\n\nPartial:\n{warnings}" if warnings else ""))

        def start():
            nonlocal remember_flag
            url = fields["url"].get().strip()
            user = fields["user"].get().strip()
            password = fields["password"].get()
            remember_flag = bool(remember.get())
            reuse = remember_flag and not password
            if not reuse and not (url and user and password):
                status.configure(
                    text="URL, username and password are all required "
                         "(or leave the password blank to reuse a saved session).",
                    text_color=WARN)
                return
            button.configure(state="disabled", text="Syncing...")
            status.configure(text="Contacting portal...", text_color=TEAL)
            threading.Thread(target=worker, args=(url, user, password, reuse),
                             daemon=True).start()
            window.after(150, poll)

        remember_flag = bool(remember.get())
        button.configure(command=start)

    def open_help(self):
        """
        The whole grid explained in student language.

        The university's vocabulary (CIE, ESE, condonation) is not the
        student's, and an unexplained grid of jargon is why most of these
        tools get opened once and abandoned.
        """
        window = ctk.CTkToplevel(self)
        window.title("What everything means")
        window.geometry("720x640")
        window.configure(fg_color=BG)
        window.transient(self)
        window.after(120, window.grab_set)

        ctk.CTkLabel(window, text="What everything means",
                     font=(FONT_UI, 20, "bold"), text_color=AMBER).pack(
            anchor="w", padx=22, pady=(18, 2))
        ctk.CTkLabel(window, text="Hover any column heading for the same note.",
                     font=(FONT_UI, 11), text_color=MUTED).pack(
            anchor="w", padx=22, pady=(0, 10))

        body = ctk.CTkScrollableFrame(window, fg_color=PANEL, corner_radius=8)
        body.pack(fill="both", expand=True, padx=18, pady=(0, 8))

        def block(title, text, colour=TEXT):
            ctk.CTkLabel(body, text=title, font=(FONT_UI, 13, "bold"),
                         text_color=colour, anchor="w", justify="left").pack(
                anchor="w", padx=14, pady=(12, 2))
            ctk.CTkLabel(body, text=text, font=(FONT_UI, 12), text_color=MUTED,
                         anchor="w", justify="left", wraplength=620).pack(
                anchor="w", padx=14)

        block("The two words KTU uses everywhere", (
            "CIE = internal marks. Series exams, assignments, everything you "
            "earn before the final exam.\n"
            "ESE = the End Semester Exam. The one big university exam at the "
            "end.\n\n"
            "CIE + ESE = 100 marks. That total decides your grade."), AMBER)

        block("The rule that catches people out", (
            "You must clear TWO separate bars, not one:\n\n"
            "   1. CIE + ESE must reach 50 out of 100.\n"
            "   2. The ESE alone must reach 40% - that is 24/60, or 20/50, "
            "or 10/25.\n\n"
            "So a huge internal mark cannot carry you. With 38/40 internal you "
            "still need 24 in the final exam, not 12. Wherever that second "
            "rule is the one binding you, this app prints a * next to the "
            "number."), DANGER)

        block("Reading a row left to right", "\n".join(
            f"{name} - {COLUMN_HELP[name]}" for name in
            ("CR", "TYPE", "SER1", "CIE", "ESE", "NEED PASS", "NEED TGT")))

        block("Attendance, DL and BUNK", (
            "75% is the eligibility line. Under it you can be barred from the "
            "exam; under 65% there is usually no appeal.\n\n"
            "BUNK answers the real question. +2 means you can miss two more "
            "and still hold 75%. -3 means three straight classes to get back.\n\n"
            "DL is duty leave - NSS, sports, fests, placement drives. It "
            "counts as attended, but only up to 10% of classes held, so "
            "claiming more than that gains you nothing. Type the number of DL "
            "classes and every figure recalculates."), TEAL)

        block("Grades", (
            "S 90+  |  A+ 85  |  A 80  |  B+ 75  |  B 70  |  C+ 65  |  "
            "C 60  |  D 55  |  P 50  |  F below 50\n\n"
            "SGPA is this semester, weighted by credits. CGPA is every "
            "semester so far. Percentage is simply 10 x CGPA under the 2024 "
            "scheme - no subtracting 2.5, that was the old rule."))

        block("Two SGPA numbers, on purpose", (
            "CONFIRMED counts only subjects where you have entered a real "
            "final exam mark.\n"
            "PROJECTED assumes you hit your target where that is still "
            "possible.\n\n"
            "Subjects with nothing published yet show PENDING and are left out "
            "of both, because guessing from a blank is how other tools mislead "
            "you."))

        ctk.CTkButton(window, text="Got it", command=window.destroy, height=36,
                      fg_color=TEAL, hover_color=AMBER, text_color="#08201F",
                      font=(FONT_UI, 13, "bold")).pack(fill="x", padx=18,
                                                       pady=(0, 16))

    # -- import router -----------------------------------------------------

    def route_import(self, choice):
        self.import_menu.set("Import from...")
        if choice == "Paste a table":
            self.open_import()
        elif choice == "KTU grade card":
            self.open_grade_card()
        elif choice == "Public page URL":
            self.open_public_url()

    def open_grade_card(self):
        """
        Past results -> real CGPA.

        KTU's own portal is captcha and OTP gated, so this reads the grade
        card the student already has rather than pretending to log in there.
        """
        try:
            import ktu_import
        except Exception as exc:
            messagebox.showerror("Import unavailable", str(exc))
            return

        window = ctk.CTkToplevel(self)
        window.title("Import KTU grade card")
        window.geometry("680x580")
        window.configure(fg_color=BG)
        window.transient(self)
        window.after(120, window.grab_set)

        ctk.CTkLabel(window, text="KTU grade card import",
                     font=(FONT_UI, 18, "bold"), text_color=AMBER).pack(
            anchor="w", padx=20, pady=(18, 2))
        ctk.CTkLabel(
            window,
            text=("Load the grade card PDF, or paste its text. Published "
                  "grades become locked semester history,\nso the CGPA shown "
                  "is real rather than projected. Recomputed SGPA is checked "
                  "against the printed one."),
            font=(FONT_UI, 11), text_color=MUTED, justify="left").pack(
            anchor="w", padx=20, pady=(0, 10))

        box = ctk.CTkTextbox(window, height=300, fg_color=PANEL,
                             border_color=LINE, border_width=1,
                             text_color=TEXT, font=(FONT_MONO, 11))
        box.pack(fill="both", expand=True, padx=20, pady=(0, 10))

        status = ctk.CTkLabel(window, text="", font=(FONT_UI, 11),
                              text_color=MUTED, wraplength=620, justify="left")
        status.pack(anchor="w", padx=20)

        def load_pdf():
            from tkinter import filedialog
            path = filedialog.askopenfilename(
                parent=window, title="Select grade card",
                filetypes=[("Grade card", "*.pdf *.txt"), ("All files", "*.*")])
            if not path:
                return
            try:
                text = (ktu_import.pdf_to_text(path)
                        if path.lower().endswith(".pdf")
                        else open(path, encoding="utf-8", errors="replace").read())
            except Exception as exc:
                status.configure(text=str(exc), text_color=DANGER)
                return
            box.delete("1.0", "end")
            box.insert("1.0", text)
            status.configure(text=f"Loaded {os.path.basename(path)}",
                             text_color=TEAL)

        def apply_card():
            parsed = ktu_import.parse_grade_card(box.get("1.0", "end"))
            found = {k: v for k, v in parsed["semesters"].items() if v["courses"]}
            if not found:
                status.configure(
                    text="No course rows found. Each row needs a code, credits "
                         "and a grade letter.", text_color=DANGER)
                return

            history = ktu_import.grade_card_to_history(parsed)
            self.state_data.setdefault("history", {}).update(history)

            mismatched = [k for k, v in found.items() if v["mismatch"]]
            self._do_save()
            self.recompute()
            window.destroy()

            summary = "\n".join(
                f"  {k}: {len(v['courses'])} courses, "
                f"{v['credits_earned']:.0f} credits earned, "
                f"SGPA {history[k]['sgpa']:.2f}"
                for k, v in sorted(found.items()))
            warning = ""
            if mismatched:
                warning = ("\n\nCheck these - recomputed SGPA disagrees with the "
                           "printed value, so a row or credit may have been "
                           "misread: " + ", ".join(sorted(mismatched)))
            messagebox.showinfo("Grade card imported",
                                f"Locked into history:\n{summary}{warning}")

        row = ctk.CTkFrame(window, fg_color="transparent")
        row.pack(fill="x", padx=20, pady=14)
        ctk.CTkButton(row, text="Load PDF / text file", command=load_pdf,
                      height=34, width=180, fg_color=PANEL_HI, hover_color=LINE,
                      text_color=TEXT, font=(FONT_UI, 12, "bold")).pack(
            side="left")
        ctk.CTkButton(row, text="Import grades", command=apply_card, height=34,
                      fg_color=TEAL, hover_color=AMBER, text_color="#08201F",
                      font=(FONT_UI, 13, "bold")).pack(side="right", fill="x",
                                                       expand=True, padx=(12, 0))

    def open_public_url(self):
        """Fetch a login-free college result/marks page and parse its tables."""
        window = ctk.CTkToplevel(self)
        window.title("Import from a public page")
        window.geometry("560x260")
        window.configure(fg_color=BG)
        window.transient(self)
        window.after(120, window.grab_set)

        ctk.CTkLabel(window, text="Public college page",
                     font=(FONT_UI, 18, "bold"), text_color=AMBER).pack(
            anchor="w", padx=20, pady=(18, 2))
        ctk.CTkLabel(
            window,
            text=("For pages that need no login. If the page is behind a "
                  "portal login,\nuse etlab sync or paste the table instead."),
            font=(FONT_UI, 11), text_color=MUTED, justify="left").pack(
            anchor="w", padx=20, pady=(0, 12))

        url_var = ctk.StringVar()
        ctk.CTkEntry(window, textvariable=url_var, height=34,
                     font=(FONT_MONO, 12), fg_color=PANEL, border_color=LINE,
                     border_width=1, text_color=TEXT,
                     placeholder_text="https://college.ac.in/results/...").pack(
            fill="x", padx=20)

        mode = ctk.StringVar(value="attendance")
        modes = ctk.CTkFrame(window, fg_color="transparent")
        modes.pack(anchor="w", padx=20, pady=10)
        for value, caption in [("attendance", "Attendance %"),
                               ("marks", "Internal marks")]:
            ctk.CTkRadioButton(modes, text=caption, variable=mode, value=value,
                               font=(FONT_UI, 12), text_color=TEXT,
                               fg_color=TEAL, border_color=LINE).pack(
                side="left", padx=(0, 18))

        status = ctk.CTkLabel(window, text="", font=(FONT_UI, 11),
                              text_color=MUTED, wraplength=500, justify="left")
        status.pack(anchor="w", padx=20)

        result_queue = queue.Queue()

        def worker(url, kind):
            try:
                import ktu_import
                text = ktu_import.fetch_public_page(url)
                result_queue.put(("ok", parse_etlab(text, kind)))
            except Exception as exc:
                result_queue.put(("error", f"{exc.__class__.__name__}: {exc}"))

        def poll():
            try:
                kind, payload = result_queue.get_nowait()
            except queue.Empty:
                window.after(150, poll)
                return
            go.configure(state="normal", text="Fetch and import")
            if kind == "error":
                status.configure(text=payload, text_color=DANGER)
                return
            if not payload:
                status.configure(text="Page loaded, but no course rows matched.",
                                 text_color=WARN)
                return
            updated, added = self.merge_import(payload)
            window.destroy()
            messagebox.showinfo("Imported",
                                f"{updated} subject(s) updated, {added} added.")

        def start():
            url = url_var.get().strip()
            if not url:
                status.configure(text="Enter a URL first.", text_color=WARN)
                return
            go.configure(state="disabled", text="Fetching...")
            status.configure(text="Fetching...", text_color=TEAL)
            threading.Thread(target=worker, args=(url, mode.get()),
                             daemon=True).start()
            window.after(150, poll)

        go = ctk.CTkButton(window, text="Fetch and import", command=start,
                           height=34, fg_color=TEAL, hover_color=AMBER,
                           text_color="#08201F", font=(FONT_UI, 13, "bold"))
        go.pack(fill="x", padx=20, pady=16)

    # -- etlab paste import ------------------------------------------------

    def open_import(self):
        window = ctk.CTkToplevel(self)
        window.title("Import from etlab")
        window.geometry("620x520")
        window.configure(fg_color=BG)
        window.transient(self)
        window.after(120, window.grab_set)

        ctk.CTkLabel(window, text="etlab paste import", font=(FONT_UI, 18, "bold"),
                     text_color=AMBER).pack(anchor="w", padx=18, pady=(16, 2))
        ctk.CTkLabel(
            window,
            text=("Open etlab, select the attendance or internal-marks table, "
                  "copy, paste below.\nLines are matched by course code; "
                  "unknown codes are added as new subjects."),
            font=(FONT_UI, 11), text_color=MUTED, justify="left"
        ).pack(anchor="w", padx=18, pady=(0, 10))

        mode = ctk.StringVar(value="attendance")
        modes = ctk.CTkFrame(window, fg_color="transparent")
        modes.pack(anchor="w", padx=18)
        for value, caption in [("attendance", "Attendance %"),
                               ("marks", "Internal marks (C1 C2 C3)")]:
            ctk.CTkRadioButton(modes, text=caption, variable=mode, value=value,
                               font=(FONT_UI, 12), text_color=TEXT,
                               fg_color=TEAL, border_color=LINE).pack(
                side="left", padx=(0, 18))

        box = ctk.CTkTextbox(window, height=280, fg_color=PANEL,
                             border_color=LINE, border_width=1,
                             text_color=TEXT, font=(FONT_MONO, 12))
        box.pack(fill="both", expand=True, padx=18, pady=12)

        def run_import():
            parsed = parse_etlab(box.get("1.0", "end"), mode.get())
            if not parsed:
                messagebox.showwarning(
                    "Nothing parsed",
                    "No course codes found. Each line needs a code like "
                    "PCCST302 plus its numbers.", parent=window)
                return
            updated, added = self.merge_import(parsed)
            window.destroy()
            messagebox.showinfo(
                "Import complete",
                f"{updated} subject(s) updated, {added} added.")

        ctk.CTkButton(window, text="Import", command=run_import, height=34,
                      fg_color=TEAL, hover_color=AMBER, text_color="#08201F",
                      font=(FONT_UI, 13, "bold")).pack(pady=(0, 16), padx=18,
                                                       fill="x")

    def apply_full_sync(self, state: dict) -> str:
        """
        Merge a whole portal record: every semester, plus locked history.

        Edits the student made by hand are preserved. The portal owns
        attendance, published internals and grades; the student owns credits,
        targets and any ESE mark they entered, because the portal has none of
        those. Overwriting them on every sync would make the app hostile to
        use between syncs.
        """
        semesters = self.state_data.setdefault("semesters", {})
        added = updated = 0

        for name, block in state.get("semesters", {}).items():
            existing = semesters.setdefault(name, {"courses": []})
            if block.get("credit_check"):
                existing["credit_check"] = block["credit_check"]
            by_code = {(c.get("code") or "").upper(): c
                       for c in existing["courses"]}

            for incoming in block["courses"]:
                code = incoming["code"].upper()
                current = by_code.get(code)
                if current is None:
                    existing["courses"].append(incoming)
                    added += 1
                    continue
                for key in ("name", "attendance", "attended", "held",
                            "cie_override", "s1", "s2", "s1_max", "s2_max",
                            "type", "portal_grade", "portal_gpa"):
                    if incoming.get(key) not in (None, ""):
                        current[key] = incoming[key]
                updated += 1

        history = self.state_data.setdefault("history", {})
        history.update(state.get("history", {}))

        if state.get("current"):
            self.state_data["active_semester"] = state["current"]
        self.sem_menu.configure(values=sorted(semesters))
        self.load_semester(self.state_data["active_semester"])

        overall = cgpa_from_semesters(history)
        note = ""
        if state.get("needs_credits"):
            note = ("\n\nCredits are not published per course by the portal, "
                    "so they were seeded from the course type. Check them - a "
                    "wrong credit skews SGPA.")
        return (f"{len(state.get('semesters', {}))} semester(s) synced: "
                f"{added} subject(s) added, {updated} updated.\n"
                f"{len(state.get('history', {}))} semester(s) locked from "
                f"published results.\n"
                f"CGPA {overall['cgpa']:.2f} over {overall['credits']:.0f} "
                f"credits ({overall['percent']:.1f}%)." + note)

    def merge_import(self, parsed: list):
        by_code = {}
        for row in self.rows:
            code = (row.course.get("code") or "").strip().upper()
            if code:
                by_code[code] = row

        updated = added = 0
        for entry in parsed:
            code = entry["code"].upper()
            payload = {k: v for k, v in entry.items()
                       if k in ("s1", "s2", "other", "attendance")}
            if not payload:
                continue
            if code in by_code:
                by_code[code].set_values(payload)
                updated += 1
            else:
                course = blank_course(code, entry.get("name", ""))
                course.update({k: str(v) for k, v in payload.items()})
                self.courses.append(course)
                added += 1

        if added:
            self.rebuild_rows()
        else:
            self.recompute()
        self.schedule_save()
        return updated, added

    # -- export ------------------------------------------------------------

    def export_report(self):
        if not self.courses:
            messagebox.showwarning("Nothing to export", "No subjects in this semester.")
            return
        os.makedirs(EXPORT_DIR, exist_ok=True)
        sem = self.state_data["active_semester"]
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        txt_path = os.path.join(EXPORT_DIR, f"targetx-{sem}-{stamp}.txt")
        csv_path = os.path.join(EXPORT_DIR, f"targetx-{sem}-{stamp}.csv")

        stats = summarise(self.courses)
        evaluated = [(c, evaluate(c)) for c in self.courses]

        lines = [
            "TargetX report - KTU 2024 scheme",
            f"Semester : {sem}",
            f"Generated: {datetime.now():%Y-%m-%d %H:%M}",
            "-" * 96,
            f"{'CODE':<10}{'COURSE':<30}{'CR':>3}{'CIE':>9}{'ESE':>8}"
            f"{'TOT':>6}{'GR':>4}{'NEED-P':>9}{'NEED-T':>9}{'ATT%':>7}",
            "-" * 96,
        ]
        for course, ev in evaluated:
            ese_text = f"{ev['ese']:.0f}/{ev['ese_max']}" if ev["ese"] is not None else "-"
            total_text = "-" if ev["total"] is None else format(ev["total"], ".0f")
            target_text = f"{ev['need_target']['text']} ({ev['target']})"
            lines.append(
                f"{(course.get('code') or '-')[:10]:<10}"
                f"{(course.get('name') or '-')[:29]:<30}"
                f"{ev['credits']:>3.0f}"
                f"{ev['cie']:>6.1f}/{ev['cie_max']:<2}"
                f"{ese_text:>8}"
                f"{total_text:>6}"
                f"{ev['grade'] or '--':>4}"
                f"{ev['need_pass']['text']:>9}"
                f"{target_text:>14}"
                f"{ev['attendance']:>7.0f}"
            )

        history = dict(self.state_data.get("history", {}))
        history[sem] = {"sgpa": stats["sgpa_projected"], "credits": stats["credits"]}
        overall = cgpa_from_semesters(history)

        lines += [
            "-" * 96,
            f"Credits enrolled     : {stats['credits']:.0f}",
            f"SGPA (confirmed)     : {stats['sgpa_confirmed']:.3f}",
            f"SGPA (projected)     : {stats['sgpa_projected']:.3f}",
            f"CGPA / Percentage    : {overall['cgpa']:.3f} / "
            f"{overall['percent']:.1f}%   (2024 scheme: % = 10 x CGPA)",
            f"Attendance flags     : {', '.join(stats['low_attendance']) or 'none'}",
            f"Unreachable passes   : {', '.join(stats['impossible']) or 'none'}",
        ]

        with open(txt_path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")

        with open(csv_path, "w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["code", "name", "credits", "type", "cie", "cie_max",
                             "ese", "ese_max", "ese_cutoff", "total", "grade",
                             "grade_point", "target", "need_ese_pass",
                             "need_ese_target", "attendance", "eligible"])
            for course, ev in evaluated:
                writer.writerow([
                    course.get("code", ""), course.get("name", ""),
                    f"{ev['credits']:.0f}", course.get("type", DEFAULT_TYPE),
                    f"{ev['cie']:.2f}", ev["cie_max"],
                    "" if ev["ese"] is None else f"{ev['ese']:.0f}",
                    ev["ese_max"], ev["ese_cutoff"],
                    "" if ev["total"] is None else f"{ev['total']:.0f}",
                    ev["grade"] or "",
                    "" if ev["grade"] is None else GRADE_POINTS[ev["grade"]],
                    ev["target"], ev["need_pass"]["text"],
                    ev["need_target"]["text"],
                    f"{ev['attendance']:.0f}", "yes" if ev["eligible"] else "no",
                ])

        messagebox.showinfo("Exported", f"Written to:\n{txt_path}\n{csv_path}")

    # -- shutdown ----------------------------------------------------------

    def _on_close(self):
        if self._save_job is not None:
            self.after_cancel(self._save_job)
            self._save_job = None
        self._do_save()
        self.destroy()


def main():
    ctk.set_appearance_mode("dark")
    app = TargetX()
    app.mainloop()


if __name__ == "__main__":
    main()
