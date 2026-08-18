"""
curriculum_import - build the course catalogue from KTU's own curriculum PDF.

Why this exists: credits and the CIA/ESE split are NOT published per course by
any student portal, and they cannot be guessed reliably. A prefix rule that
reproduced two semesters exactly still got PCCST503 wrong (3 credits, not 4),
and missed that PBL courses invert the split to 60/40 and that 2024-scheme
labs are 50/50 rather than 75/25. Those are not rounding errors - they change
the pass mark and the SGPA.

KTU publishes the full curriculum as a PDF per branch. That is the primary
source, so the catalogue is extracted from it rather than typed by hand.

    python curriculum_import.py <curriculum.pdf> --branch CSE

Reads every semester table it can find and merges the result into
curriculum.json, leaving any hand-corrections for other branches intact.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CURRICULUM_FILE = os.path.join(APP_DIR, "curriculum.json")

CODE_RE = re.compile(r"\b([A-Z]{2,6}\d{3}[A-Z]?)\b")
NUM_RE = re.compile(r"\d+(?:\.\d+)?")

SEM_WORDS = {
    "FIRST": 1, "SECOND": 2, "THIRD": 3, "FOURTH": 4,
    "FIFTH": 5, "SIXTH": 6, "SEVENTH": 7, "EIGHTH": 8,
}
SEM_RE = re.compile(r"\b(" + "|".join(SEM_WORDS) + r")\s+SEMESTER", re.I)

# Course-type tokens that sit between the code and the title in the table.
TYPE_TOKENS = {"PC", "PB", "PE", "PCL", "PBL", "PC-PBL", "UC", "HMC", "VAC",
               "GA", "GB", "MC", "PWS", "PRJ", "SC", "HM", "ES", "BS",
               "BSC", "ESC", "GC", "HSC", "PCC", "PBC", "PEC", "PSC", "MNC",
               "S1/", "S2", "S3/S", "S4", "S5/", "S6", "PE-1", "PE-2", "I*"}


def split_pattern(cia: float, ese: float, code: str = "") -> str:
    """
    Map a published CIA/ESE split onto a TargetX course pattern.

    A 50/50 split is used by both labs and some theory courses, so the code
    decides the label. The marks maxima are identical either way - this only
    keeps the grid readable.
    """
    pair = (int(cia), int(ese))
    if pair == (50, 50):
        block = re.match(r"^([A-Z]+)", (code or "").upper())
        letters = block.group(1) if block else ""
        return "LAB 50/50" if letters.endswith("L") else "TH 50/50"
    return {
        (40, 60): "TH 40/60",
        (60, 40): "PBL 60/40",
        (75, 25): "LAB 75/25",
        (100, 0): "PRJ 100/0",
    }.get(pair, "TH 40/60")


def parse_row(line: str):
    """
    Pull one course out of a curriculum table row.

    Row shape (whitespace varies wildly between PDF exports):
        1 A PCCST501 PC PC Computer Networks 3 1 0 0 5 40 60 4 4
                                             L T P R SS CIA ESE Cr Hrs

    The CIA/ESE pair is found by looking for two adjacent numbers summing to
    100 - far more stable than counting columns, which shift whenever a row
    has a footnote marker or a missing tutorial value.
    """
    code_match = CODE_RE.search(line)
    if not code_match:
        return None
    code = code_match.group(1)
    tail = line[code_match.end():]

    numbers = [(m.group(0), m.start()) for m in NUM_RE.finditer(tail)]
    if len(numbers) < 3:
        return None

    values = [float(text) for text, _pos in numbers]
    split_at = None
    for index in range(len(values) - 1):
        if abs(values[index] + values[index + 1] - 100) < 0.01 \
                and values[index] >= 25:
            split_at = index
            break
    if split_at is None:
        return None

    cia, ese = values[split_at], values[split_at + 1]
    credits = values[split_at + 2] if split_at + 2 < len(values) else None
    # No KTU course carries more than 6 credits; anything larger is a row
    # that wrapped badly, and a bad credit is worse than a missing one.
    if credits is None or credits <= 0 or credits > 6:
        return None

    title = tail[:numbers[0][1]]
    words = [w for w in title.replace("-", " ").split()
             if w.upper() not in TYPE_TOKENS]
    name = " ".join(words).strip(" .:-")
    name = re.sub(r"\s*\d+\s*/\s*$", "", name).strip()   # trailing "5/" artefacts
    if not name:
        return None

    return {
        "code": code,
        "name": name,
        "credits": int(credits) if float(credits).is_integer() else credits,
        "cia": cia,
        "ese": ese,
        "type": split_pattern(cia, ese, code),
    }


def parse_elective_row(record: str):
    """
    Elective tables use a different shape with no CIA/ESE columns:

        PECST522 Artificial Intelligence 3-0-0-0 3

    Credits are the last standalone number; the L-T-P-R group is skipped.
    Electives follow the ordinary theory split unless stated otherwise.
    """
    code_match = CODE_RE.search(record)
    if not code_match:
        return None
    tail = record[code_match.end():]
    # Require the L-T-P-R group. Without it this is not an elective-table row
    # but a fragment of some other record, and guessing credits off a stray
    # digit is worse than returning nothing - a missing course falls back to
    # inference, a wrong credit silently corrupts SGPA.
    if not re.search(r"\d\s*-\s*\d\s*-\s*\d\s*-\s*\d", tail):
        return None
    cleaned = re.sub(r"\d\s*-\s*\d\s*-\s*\d\s*-\s*\d", " ", tail)
    numbers = NUM_RE.findall(cleaned)
    if not numbers:
        return None
    credits = float(numbers[-1])
    if credits <= 0 or credits > 6:
        return None

    name = " ".join(w for w in cleaned[:cleaned.find(numbers[-1])].split()
                    if w.upper() not in TYPE_TOKENS).strip(" .:-")
    if not name or len(name) < 3:
        return None
    return {
        "code": code_match.group(1),
        "name": name,
        "credits": int(credits) if credits.is_integer() else credits,
        "cia": 40, "ese": 60, "type": "TH 40/60",
    }


def parse_curriculum(text: str) -> dict:
    """
    Walk the document semester by semester.

    Rows in these PDFs wrap across newlines mid-record - a course type token
    routinely lands on its own line - so line-by-line parsing drops real
    courses silently. Instead each semester's block is reflowed to a single
    string and then split at course-code boundaries, which is where records
    actually begin.
    """
    semesters = {}
    marks = [(m.start(), SEM_WORDS[m.group(1).upper()])
             for m in SEM_RE.finditer(text)]
    if not marks:
        return semesters

    for index, (start, number) in enumerate(marks):
        end = marks[index + 1][0] if index + 1 < len(marks) else len(text)
        block = re.sub(r"\s+", " ", text[start:end])
        courses = semesters.setdefault(number, {})

        hits = list(CODE_RE.finditer(block))
        for position, hit in enumerate(hits):
            stop = hits[position + 1].start() if position + 1 < len(hits) \
                else len(block)
            record = block[hit.start():stop]
            row = parse_row(record) or parse_elective_row(record)
            if row:
                courses.setdefault(row["code"], row)
    return semesters


def pdf_text(path: str) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise SystemExit("Needs pypdf. Run: pip install pypdf") from exc
    reader = PdfReader(path)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def merge_into_catalogue(semesters: dict, branch: str,
                         path: str = CURRICULUM_FILE) -> dict:
    """Write the extracted courses into curriculum.json under `branch`."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        data = {}

    data.setdefault("branches", {}).setdefault(branch, {})
    data.setdefault("credits", {})

    written = 0
    for number, courses in sorted(semesters.items()):
        if not courses:
            continue
        rows = []
        for code, row in sorted(courses.items()):
            rows.append([row["code"], row["name"], row["credits"], row["type"]])
            # Flat lookup so a synced course can find its credits and split
            # even when the student never loads a preset.
            data["credits"][code] = {
                "credits": row["credits"],
                "type": row["type"],
                "name": row["name"],
            }
            written += 1
        data["branches"][branch][f"S{number}"] = rows

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
    os.replace(tmp, path)
    return {"courses": written, "semesters": sorted(semesters)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", help="KTU curriculum PDF for one branch")
    parser.add_argument("--branch", default="CSE")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    text = pdf_text(args.pdf) if args.pdf.lower().endswith(".pdf") \
        else open(args.pdf, encoding="utf-8", errors="replace").read()
    semesters = parse_curriculum(text)

    for number in sorted(semesters):
        courses = semesters[number]
        total = sum(c["credits"] for c in courses.values())
        print(f"\nS{number}: {len(courses)} courses, {total} credits listed")
        for row in sorted(courses.values(), key=lambda r: r["code"]):
            print(f"   {row['code']:<10} {row['credits']:>2}cr  "
                  f"{row['type']:<10} {row['name'][:44]}")

    if args.dry_run:
        return 0
    result = merge_into_catalogue(semesters, args.branch)
    print(f"\nWrote {result['courses']} courses for {args.branch} "
          f"into {CURRICULUM_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
