"""
ktu_import - read past results and public college pages into TargetX.

Three sources, three honest verdicts:

  1. KTU grade card (PDF or copied text)
     The official portal (app.ktu.edu.in) gates login behind a captcha and,
     on many flows, an OTP. Scripting that login is brittle and puts the
     student's own account at risk, so this module does NOT attempt it.
     Instead it parses the grade card the student already downloads. That
     gives real, published grades - the only trustworthy source of past CGPA.

  2. Public college result / internal-mark pages
     No login, so a plain fetch plus the shared table parser is enough.

  3. Anything else
     Copy the table, paste it in. The same parser handles it.

Optional dep: pypdf (for PDF grade cards). Without it, paste the text.
"""

from __future__ import annotations

import re
import sys

from targetx import (CODE_RE, GRADE_POINTS, blank_course, sgpa as sgpa_of)

# Longest-first so "A+" is never truncated to "A".
GRADE_TOKENS = ["A+", "B+", "C+", "S", "A", "B", "C", "D", "P", "F",
                "FE", "I", "W", "AB"]
GRADE_RE = re.compile(r"(?<![A-Za-z+])(" +
                      "|".join(re.escape(g) for g in GRADE_TOKENS) +
                      r")(?![A-Za-z+])")
SEM_RE = re.compile(r"\bS(?:EM(?:ESTER)?)?\s*[-: ]?\s*([1-8])\b", re.I)
ORDINAL_SEM = {
    "first": 1, "second": 2, "third": 3, "fourth": 4,
    "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8,
}
SGPA_RE = re.compile(r"\bSGPA\s*[:=]?\s*(\d+(?:\.\d+)?)", re.I)

# Non-passing tokens: no grade point, and they must not silently count as a
# pass when the CGPA is recomputed.
FAIL_TOKENS = {"F", "FE", "I", "W", "AB"}


def infer_type(code: str, credits: float = 3) -> str:
    """
    Pick a course pattern from the code.

    KTU 2024 codes end their letter block with the course kind: ...L for a
    lab (PCCSL307, GAPHL120), ...T/S for theory. Getting this wrong changes
    the ESE maximum, so it is a guess the user can override in the grid.
    """
    match = re.match(r"^([A-Z]+)", (code or "").upper())
    letters = match.group(1) if match else ""
    if letters.endswith("L"):
        return "LAB 75/25"
    if letters.endswith("D") or "PRJ" in letters or "PWS" in letters:
        return "PRJ 100/0"
    if credits and float(credits) <= 1:
        return "LAB 75/25"
    return "TH 40/60"


def _semester_from_line(line: str):
    match = SEM_RE.search(line)
    if match:
        return f"S{match.group(1)}"
    lowered = line.lower()
    for word, number in ORDINAL_SEM.items():
        if f"{word} semester" in lowered:
            return f"S{number}"
    return None


def parse_grade_card(text: str) -> dict:
    """
    Parse a KTU grade card into {semester: {courses, sgpa_printed, sgpa_calc}}.

    Tolerant by design: layouts differ between the PDF grade card, the portal
    HTML view, and a pasted table. Every line is scanned for a course code,
    a grade token after it, and a small integer that looks like credits.
    """
    semesters = {}
    current = "S1"
    seen_sem = False

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        found_sem = _semester_from_line(line)
        code_match = CODE_RE.search(line)

        # A bare semester heading (no course code on it) switches context.
        if found_sem and not code_match:
            current = found_sem
            seen_sem = True
            continue

        sgpa_match = SGPA_RE.search(line)
        if sgpa_match and not code_match:
            semesters.setdefault(current, {"courses": []})
            semesters[current]["sgpa_printed"] = float(sgpa_match.group(1))
            continue

        if not code_match:
            continue

        code = code_match.group(1)
        tail = line[code_match.end():]

        grade_match = None
        for grade_match in GRADE_RE.finditer(tail):
            pass  # keep the last - the grade sits at the end of the row
        if grade_match is None:
            continue
        grade = grade_match.group(1)

        credits = 0.0
        for number in re.findall(r"\b(\d+(?:\.\d+)?)\b", tail[:grade_match.start()]):
            value = float(number)
            if 0 < value <= 8:
                credits = value
        if not credits:
            credits = 3.0

        name = ""
        for chunk in re.split(r"\s{2,}|\t|\|", tail.strip()):
            chunk = chunk.strip()
            if chunk and not re.fullmatch(r"[\d.\s]+", chunk) and chunk != grade:
                name = chunk
                break

        # A code seen on the same line as a semester marker belongs to it.
        if found_sem:
            current = found_sem
            seen_sem = True

        entry = semesters.setdefault(current, {"courses": []})
        entry["courses"].append({
            "code": code,
            "name": name,
            "credits": credits,
            "grade": grade,
            "passed": grade not in FAIL_TOKENS,
        })

    for name, entry in semesters.items():
        pairs = [(c["credits"], GRADE_POINTS.get(c["grade"], 0.0))
                 for c in entry["courses"]]
        entry["sgpa_calc"] = sgpa_of(pairs)
        entry["credits"] = sum(c["credits"] for c in entry["courses"])
        entry["credits_earned"] = sum(c["credits"] for c in entry["courses"]
                                      if c["passed"])
        printed = entry.get("sgpa_printed")
        # If our recomputation disagrees with the printed SGPA, the parse ate
        # a row or a credit value. Surface it instead of quietly being wrong.
        entry["mismatch"] = (printed is not None
                             and abs(printed - entry["sgpa_calc"]) > 0.05)

    return {"semesters": semesters, "semester_detected": seen_sem}


def pdf_to_text(path: str) -> str:
    """Extract text from a grade card PDF. Needs pypdf."""
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader  # older installs
        except ImportError as exc:
            raise RuntimeError(
                "PDF reading needs pypdf. Run: pip install pypdf\n"
                "Or open the PDF, select the table, and paste the text instead."
            ) from exc
    reader = PdfReader(path)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def fetch_public_page(url: str, timeout: int = 20) -> str:
    """
    Pull a public (no login) college result or marks page and flatten its
    tables to text lines the shared parsers understand.
    """
    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("Needs requests. Run: pip install requests") from exc
    from etlab_sync import html_to_lines, USER_AGENT

    response = requests.get(url, timeout=timeout,
                            headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    lines = html_to_lines(response.text)
    if not lines:
        raise RuntimeError("No tables found on that page. If it needs a login, "
                           "use etlab sync or paste import instead.")
    return "\n".join(lines)


def grade_card_to_history(parsed: dict) -> dict:
    """Shape parse_grade_card output into TargetX's history block."""
    history = {}
    for name, entry in parsed["semesters"].items():
        if not entry["courses"]:
            continue
        history[name] = {
            "sgpa": entry.get("sgpa_printed") or entry["sgpa_calc"],
            "credits": entry["credits_earned"] or entry["credits"],
        }
    return history


def grade_card_to_courses(entry: dict) -> list:
    """Turn one parsed semester into editable TargetX course rows."""
    courses = []
    for item in entry["courses"]:
        course = blank_course(item["code"], item["name"], item["credits"],
                              infer_type(item["code"], item["credits"]))
        course["locked_grade"] = item["grade"]
        courses.append(course)
    return courses


def _cli():  # pragma: no cover - manual aid
    if len(sys.argv) < 2:
        print(__doc__)
        print("usage: python ktu_import.py <gradecard.pdf | gradecard.txt | url>")
        return 1
    source = sys.argv[1]
    if source.lower().startswith("http"):
        text = fetch_public_page(source)
    elif source.lower().endswith(".pdf"):
        text = pdf_to_text(source)
    else:
        with open(source, encoding="utf-8", errors="replace") as handle:
            text = handle.read()

    parsed = parse_grade_card(text)
    for name in sorted(parsed["semesters"]):
        entry = parsed["semesters"][name]
        flag = "  <-- MISMATCH vs printed SGPA" if entry["mismatch"] else ""
        print(f"\n{name}: {len(entry['courses'])} courses, "
              f"{entry['credits']:.0f} credits, "
              f"SGPA calc {entry['sgpa_calc']:.3f}, "
              f"printed {entry.get('sgpa_printed', '-')}{flag}")
        for course in entry["courses"]:
            print(f"   {course['code']:<10} {course['credits']:>3.0f}  "
                  f"{course['grade']:<3} {course['name'][:40]}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_cli())
