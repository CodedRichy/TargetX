"""
etlab_sync - authenticated scrape client for etlab student portals.

Design notes (why this is not a hardcoded path list):

etlab is a Yii PHP app deployed per-college. The login route, the CSRF field
name (YII_CSRF_TOKEN on Yii1, _csrf on Yii2), the form field names and the
attendance/internals routes all drift between deployments and versions. Any
client that pins one URL works at one college and fails silently everywhere
else - and a silent failure in a marks tracker is worse than no sync.

So this client discovers instead of assuming:
  1. probe candidate login routes, keep the first page with a password input
  2. harvest every hidden input on that form, POST to the form's own action
  3. probe candidate data routes, keep the first that yields a plausible table
  4. flatten tables to text lines and hand them to the SAME tolerant parser
     used by the manual paste import, so both paths share tested code

Credentials: the password is never written to disk. Session cookies are
written to etlab_session.json only if the caller asks, and that file is kept
out of ktu_data.json because a live cookie is a bearer credential - exporting
or sharing your marks file must not hand over portal access.

CLI:  python etlab_sync.py https://college.etlab.app <username>
"""

from __future__ import annotations

import json
import os
import re
import sys
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:  # pragma: no cover
    sys.exit("Missing deps. Run: pip install requests beautifulsoup4")

from targetx import parse_etlab, CODE_RE


# Same writable folder the app saves marks into - never the temp unpack dir
# of a frozen build, and never inside ktu_data.json.
from targetx import APP_DIR
SESSION_FILE = os.path.join(APP_DIR, "etlab_session.json")

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

LOGIN_PATHS = [
    "/user/login",
    "/site/login",
    "/index.php/user/login",
    "/login",
    "/",
]

ATTENDANCE_PATHS = [
    "/student/attendance",
    "/ktu/student/attendance",
    "/student/attendance/index",
    "/attendance/student",
    "/student/attendancereport",
]

INTERNALS_PATHS = [
    "/student/marks",
    "/ktu/student/internals",
    "/student/internals",
    "/student/exam/internal",
    "/exam/student/internalmarks",
    "/student/marks/index",
]

LOGOUT_HINTS = ("logout", "sign out", "signout")
LOGIN_HINTS = ("password", "login")


class EtlabError(Exception):
    """Any failure the user can act on: bad URL, bad credentials, no table."""


def normalise_base(url: str) -> str:
    url = (url or "").strip()
    if not url:
        raise EtlabError("College portal URL is empty.")
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parsed = urlparse(url)
    if not parsed.netloc:
        raise EtlabError(f"Cannot read a hostname out of {url!r}.")

    # Students copy the URL from the address bar, so it usually arrives as the
    # login page itself. Keeping that path would make every probe request
    # /user/login/user/login. Strip the known entry points back to the root.
    path = parsed.path.rstrip("/")
    for suffix in ("/user/login", "/site/login", "/login", "/index.php",
                   "/user/logout", "/site/logout"):
        if path.lower().endswith(suffix):
            path = path[: -len(suffix)]
            break
    return f"{parsed.scheme}://{parsed.netloc}" + path.rstrip("/")


def row_cells(tr) -> list:
    """
    Cells belonging to this row only.

    recursive=False matters: etlab nests a detail table inside a row, and a
    recursive search pulls every child row's text into its parent, so one
    subject appears to carry the whole table's contents.
    """
    cells = [c.get_text(" ", strip=True)
             for c in tr.find_all(["td", "th"], recursive=False)]
    return [c for c in cells if c]


def table_to_lines(table) -> list:
    """Flatten one HTML table into 'cell  cell  cell' text lines."""
    lines = []
    for tr in table.find_all("tr"):
        cells = row_cells(tr)
        if len(cells) >= 2:
            lines.append("  ".join(cells))
    return lines


def html_to_lines(html: str) -> list:
    soup = BeautifulSoup(html, "html.parser")
    lines = []
    for table in soup.find_all("table"):
        lines.extend(table_to_lines(table))
    return lines


def looks_like_course_data(lines: list) -> bool:
    """A page is worth parsing only if course codes actually appear in it."""
    return sum(1 for line in lines if CODE_RE.search(line)) >= 2


ACADEMICS_PATHS = [
    "/ktuacademics/student/studentacademics",
    "/student/results",
]
SUBJECT_PATHS = ["/student/subject"]

ROMAN_SEM = {
    "I": 1, "II": 2, "III": 3, "IV": 4,
    "V": 5, "VI": 6, "VII": 7, "VIII": 8,
}
SEM_HEADER_RE = re.compile(
    r"\b(I|II|III|IV|V|VI|VII|VIII)(?:st|nd|rd|th)\s+Semester", re.I)
ATT_RE = re.compile(r"(\d+)\s*/\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%\)")
FIELD_RE = re.compile(
    r"SGPA\s*:\s*(?P<sgpa>[\d.]+|-)"
    r".*?Earned Credit\s*:\s*(?P<earned>[\d.]+|-)"
    r".*?Cumulative Credit\s*:\s*(?P<cumulative>[\d.]+|-)"
    r".*?CGPA\s*:\s*(?P<cgpa>[\d.]+|-)", re.I | re.S)
SERIES_RE = re.compile(r"Series\s*Exam\s*(\d+)", re.I)
MARK_RE = re.compile(r"(-|\d+(?:\.\d+)?)\s*/\s*(\d+)")


def _number(text):
    """'-' and '' mean not published yet, which is not the same as zero."""
    if text is None:
        return None
    text = str(text).strip()
    if text in ("", "-", "--", "N/A"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_series(line: str) -> list:
    """
    Pull every 'Series Exam N ... 22.5/40' out of one detail row.

    The row holds all of a subject's exams end to end, so it is split at each
    'Series Exam N' and the first mark pair inside each slice is taken - the
    second pair on the line is the class average, not the student's mark.
    """
    hits = list(SERIES_RE.finditer(line))
    series = []
    for index, hit in enumerate(hits):
        end = hits[index + 1].start() if index + 1 < len(hits) else len(line)
        marks = MARK_RE.findall(line[hit.end():end])
        if not marks:
            continue
        scored, out_of = marks[0]
        series.append({
            "exam": int(hit.group(1)),
            "mark": _number(scored),
            "max": _number(out_of) or 40,
        })
    series.sort(key=lambda item: item["exam"])
    return series


def parse_academics(html: str) -> dict:
    """
    Parse the etlab academic record: every semester, every subject.

    This one page carries the whole picture - past grades and SGPA/CGPA,
    plus the current semester's attendance and series-exam marks - which is
    why it is the primary sync source rather than the internals page that
    other deployments expose.

    Layout: a one-row summary table per semester, followed by that semester's
    subject table, with each subject's series exams in a table nested inside
    its row.
    """
    soup = BeautifulSoup(html, "html.parser")
    semesters = {}
    pending = None

    for table in soup.find_all("table"):
        rows = [tr for tr in table.find_all("tr", recursive=True)]
        if not rows:
            continue

        flat = " ".join(row_cells(rows[0]))
        header_match = SEM_HEADER_RE.search(flat)

        # Case 1: the per-semester summary strip.
        if header_match and "SGPA" in flat.upper():
            number = ROMAN_SEM[header_match.group(1).upper()]
            att = ATT_RE.search(flat)
            fields = FIELD_RE.search(flat)
            entry = semesters.setdefault(number, {"courses": []})
            entry.update({
                "label": f"S{number}",
                "attended": _number(att.group(1)) if att else None,
                "held": _number(att.group(2)) if att else None,
                "attendance": _number(att.group(3)) if att else None,
            })
            if fields:
                entry.update({
                    "sgpa": _number(fields.group("sgpa")),
                    "earned_credits": _number(fields.group("earned")),
                    "cumulative_credits": _number(fields.group("cumulative")),
                    "cgpa": _number(fields.group("cgpa")),
                })
            pending = number
            continue

        # Case 2: a subject table - belongs to the last summary strip seen.
        head_text = " ".join(row_cells(rows[0])).upper()
        if "SUBJECT" not in head_text or "GRADE" not in head_text:
            continue
        if pending is None:
            continue

        entry = semesters.setdefault(pending, {"courses": []})
        for tr in rows[1:]:
            cells = row_cells(tr)
            if not cells:
                continue
            line = "  ".join(cells)
            code_match = CODE_RE.search(line)
            att_match = ATT_RE.search(line)

            # Series marks arrive in a detail row that FOLLOWS its subject
            # row rather than sitting inside it, so they attach backwards.
            if SERIES_RE.search(line) and entry["courses"]:
                entry["courses"][-1]["series"] = _parse_series(line)
                continue

            if not code_match or not att_match:
                continue

            code = code_match.group(1)
            name = line[code_match.end():att_match.start()]
            name = name.strip(" -⬆⬇⯆⯅").strip()

            tail = line[att_match.end():].split()
            internal = _number(tail[0]) if len(tail) > 0 else None
            grade = tail[1] if len(tail) > 1 and tail[1] not in ("-",) else None
            result = tail[2] if len(tail) > 2 else None
            gpa = _number(tail[4]) if len(tail) > 4 else None

            series = []
            for nested in tr.find_all("table"):
                for nested_row in nested.find_all("tr"):
                    nested_cells = row_cells(nested_row)
                    if not nested_cells:
                        continue
                    nested_line = "  ".join(nested_cells)
                    exam = SERIES_RE.search(nested_line)
                    if not exam:
                        continue
                    marks = MARK_RE.findall(nested_line)
                    if not marks:
                        continue
                    scored, out_of = marks[0]
                    series.append({
                        "exam": int(exam.group(1)),
                        "mark": _number(scored),
                        "max": _number(out_of) or 40,
                    })

            entry["courses"].append({
                "code": code,
                "name": name,
                "attended": _number(att_match.group(1)),
                "held": _number(att_match.group(2)),
                "attendance": _number(att_match.group(3)),
                "internal": internal,
                "grade": grade,
                "result": result,
                "gpa": gpa,
                "series": sorted(series, key=lambda s: s["exam"]),
            })

    current = None
    for number in sorted(semesters):
        if semesters[number]["courses"]:
            current = number
    return {"semesters": semesters, "current": current}


def parse_subject_types(html: str) -> dict:
    """
    Map course code -> Theory / Practical from /student/subject.

    Worth a second request: it decides whether a course is scored 40/60 or
    75/25, and guessing that from the code letters is only a heuristic.
    """
    soup = BeautifulSoup(html, "html.parser")
    types = {}
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = row_cells(tr)
            if len(cells) < 3:
                continue
            line = "  ".join(cells)
            code_match = CODE_RE.search(line)
            if not code_match:
                continue
            lowered = line.lower()
            if "practical" in lowered or " lab" in lowered:
                types[code_match.group(1)] = "LAB 75/25"
            elif "theory" in lowered or "elective" in lowered:
                types[code_match.group(1)] = "TH 40/60"
    return types


class EtlabClient:
    def __init__(self, base_url: str, timeout: int = 20):
        self.base = normalise_base(base_url)
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self.login_url = None
        self.last_error = ""

    # -- low level ---------------------------------------------------------

    def _get(self, path: str):
        return self.session.get(urljoin(self.base + "/", path.lstrip("/")),
                                timeout=self.timeout, allow_redirects=True)

    @staticmethod
    def _score_form(form) -> int:
        """2 = username + password (a real login form), 1 = password only."""
        has_password = has_user = False
        for inp in form.find_all("input"):
            if not inp.get("name"):
                continue
            itype = (inp.get("type") or "text").lower()
            if itype == "password":
                has_password = True
            elif itype in ("text", "email"):
                has_user = True
        if not has_password:
            return 0
        return 2 if has_user else 1

    def _find_login_form(self):
        """
        Return (action_url, form) for the best login form across candidates.

        Scored rather than first-match: a session-expired page often carries a
        stub form with only a password box, and picking that one sends the
        credentials nowhere useful. A form with both fields always wins.
        """
        errors = []
        fallback = None
        for path in LOGIN_PATHS:
            try:
                response = self._get(path)
            except requests.RequestException as exc:
                errors.append(f"{path}: {exc.__class__.__name__}")
                continue
            if response.status_code >= 400:
                errors.append(f"{path}: HTTP {response.status_code}")
                continue
            soup = BeautifulSoup(response.text, "html.parser")
            best = None
            for form in soup.find_all("form"):
                score = self._score_form(form)
                if score and (best is None or score > best[0]):
                    best = (score, urljoin(response.url, form.get("action")
                                           or response.url), form)
            if best is None:
                errors.append(f"{path}: no password field")
                continue
            if best[0] == 2:
                return best[1], best[2]
            fallback = fallback or best
        if fallback:
            return fallback[1], fallback[2]
        raise EtlabError("No login form found. Tried: " + "; ".join(errors))

    @staticmethod
    def _field_names(form):
        """Guess the username/password field names from the form itself."""
        user_field = pass_field = None
        for inp in form.find_all("input"):
            name = inp.get("name")
            if not name:
                continue
            itype = (inp.get("type") or "text").lower()
            if itype == "password" and pass_field is None:
                pass_field = name
            elif itype in ("text", "email") and user_field is None:
                user_field = name
        if not user_field or not pass_field:
            raise EtlabError("Login form is missing a username or password field.")
        return user_field, pass_field

    @staticmethod
    def _is_logged_in(html: str) -> bool:
        lowered = html.lower()
        if any(hint in lowered for hint in LOGOUT_HINTS):
            return True
        # Still showing a password box means the POST bounced.
        return "type=\"password\"" not in lowered and "type='password'" not in lowered

    # -- public ------------------------------------------------------------

    def login(self, username: str, password: str) -> bool:
        if not username or not password:
            raise EtlabError("Username and password are both required.")

        action, form = self._find_login_form()
        self.login_url = action
        user_field, pass_field = self._field_names(form)

        payload = {}
        # Every hidden input, verbatim - this covers YII_CSRF_TOKEN, _csrf,
        # rememberMe, returnUrl and whatever the next version invents.
        for inp in form.find_all("input"):
            name = inp.get("name")
            if name and (inp.get("type") or "").lower() == "hidden":
                payload[name] = inp.get("value", "")
        payload[user_field] = username
        payload[pass_field] = password

        try:
            response = self.session.post(action, data=payload,
                                         timeout=self.timeout,
                                         headers={"Referer": action},
                                         allow_redirects=True)
        except requests.RequestException as exc:
            raise EtlabError(f"Login request failed: {exc}") from exc

        if response.status_code >= 400:
            raise EtlabError(f"Login returned HTTP {response.status_code}.")

        if not self._is_logged_in(response.text):
            lowered = response.text.lower()
            if "captcha" in lowered:
                raise EtlabError(
                    "This portal shows a captcha. Automated sync cannot pass it "
                    "- use the paste import instead.")
            raise EtlabError("Login rejected. Check the username and password.")
        return True

    def fetch_lines(self, paths: list, what: str) -> list:
        tried = []
        for path in paths:
            try:
                response = self._get(path)
            except requests.RequestException as exc:
                tried.append(f"{path}: {exc.__class__.__name__}")
                continue
            if response.status_code >= 400:
                tried.append(f"{path}: HTTP {response.status_code}")
                continue
            lines = html_to_lines(response.text)
            if looks_like_course_data(lines):
                return lines
            tried.append(f"{path}: no course rows")
        raise EtlabError(f"Could not locate the {what} page. Tried: "
                         + "; ".join(tried))

    def discover_links(self) -> dict:
        """
        Read the real routes off the dashboard instead of guessing them.

        Guessed paths were wrong on the first real portal tested - the
        internals route 404'd on all six candidates while the dashboard
        linked it plainly. Harvesting links first turns a guess into a fact.
        """
        found = {}
        try:
            response = self._get("/")
        except requests.RequestException:
            return found
        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.find_all("a"):
            href = anchor.get("href") or ""
            if not href.startswith("/"):
                continue
            lowered = href.lower()
            if "academic" in lowered:
                found.setdefault("academics", href)
            elif lowered.endswith("/student/subject"):
                found.setdefault("subjects", href)
            elif "result" in lowered:
                found.setdefault("results", href)
        return found

    def fetch_academics(self) -> dict:
        """Full academic record: past semesters plus the current one."""
        links = self.discover_links()
        paths = ([links["academics"]] if "academics" in links else []) \
            + ACADEMICS_PATHS
        tried = []
        for path in paths:
            try:
                response = self._get(path)
            except requests.RequestException as exc:
                tried.append(f"{path}: {exc.__class__.__name__}")
                continue
            if response.status_code >= 400:
                tried.append(f"{path}: HTTP {response.status_code}")
                continue
            parsed = parse_academics(response.text)
            if parsed["semesters"]:
                return parsed
            tried.append(f"{path}: no semester tables")
        raise EtlabError("Could not read the academic record. Tried: "
                         + "; ".join(tried))

    def fetch_subject_types(self) -> dict:
        for path in SUBJECT_PATHS:
            try:
                response = self._get(path)
            except requests.RequestException:
                continue
            if response.status_code < 400:
                types = parse_subject_types(response.text)
                if types:
                    return types
        return {}

    def fetch_attendance(self) -> list:
        lines = self.fetch_lines(ATTENDANCE_PATHS, "attendance")
        return parse_etlab("\n".join(lines), "attendance")

    def fetch_internals(self) -> list:
        lines = self.fetch_lines(INTERNALS_PATHS, "internal marks")
        return parse_etlab("\n".join(lines), "marks")

    def sync(self) -> dict:
        """
        Pull both pages. Either half may fail on its own - a college that
        hides internals until results are published should still give you
        attendance rather than an all-or-nothing error.
        """
        result = {"attendance": [], "marks": [], "warnings": []}
        for key, fetch in (("attendance", self.fetch_attendance),
                           ("marks", self.fetch_internals)):
            try:
                result[key] = fetch()
            except EtlabError as exc:
                result["warnings"].append(str(exc))
        if not result["attendance"] and not result["marks"]:
            raise EtlabError("Logged in, but nothing parseable was found. "
                             + " | ".join(result["warnings"]))
        return result

    # -- session reuse -----------------------------------------------------

    def save_session(self, path: str = SESSION_FILE) -> None:
        """Cookies only. Never the password, never inside ktu_data.json."""
        blob = {
            "base": self.base,
            "cookies": requests.utils.dict_from_cookiejar(self.session.cookies),
        }
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(blob, handle, indent=2)
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass

    @classmethod
    def from_session(cls, path: str = SESSION_FILE):
        """Rebuild a client from stored cookies. Returns None if unusable."""
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as handle:
                blob = json.load(handle)
            client = cls(blob["base"])
            client.session.cookies.update(blob.get("cookies", {}))
        except (OSError, KeyError, ValueError, json.JSONDecodeError):
            return None
        return client

    def session_alive(self) -> bool:
        try:
            response = self._get(ATTENDANCE_PATHS[0])
        except requests.RequestException:
            return False
        return response.status_code < 400 and self._is_logged_in(response.text)

    @staticmethod
    def forget_session(path: str = SESSION_FILE) -> None:
        try:
            os.remove(path)
        except OSError:
            pass


def academics_to_state(academics: dict, types: dict = None) -> dict:
    """
    Turn a parsed portal record into TargetX semesters plus locked history.

    Design rules that matter for correctness:
      - The portal's published internal total becomes cie_override, so the
        CIE shown always matches the college's own figure.
      - Series maxima come from the page (40 here, 50 elsewhere) instead of
        being assumed.
      - Credits are NOT published per course, only per semester, so they are
        seeded by course type and flagged for the student to confirm. A
        wrong credit silently corrupts SGPA, so it must not look settled.
      - Only semesters the portal marks with an SGPA get locked into history.
        An in-progress semester stays editable.
    """
    from targetx import (blank_course, infer_credits, verify_credits,
                         lookup_course)

    types = types or {}
    semesters, history, needs_credits = {}, {}, []

    for number, entry in academics.get("semesters", {}).items():
        name = f"S{number}"
        courses = []
        for item in entry.get("courses", []):
            code = item["code"]
            # The published curriculum is the authority on the CIA/ESE split;
            # the portal's Theory/Practical label is only a hint.
            listed = lookup_course(code)
            type_key = listed.get("type") or types.get(code) or _infer_type(code)
            # A published internal above the pattern's CIE ceiling means the
            # pattern is wrong, not the mark. Colleges run 40- and 50-mark
            # internals side by side, so fit the pattern to the evidence
            # rather than clamping the student's real score down.
            type_key = _fit_type(type_key, item.get("internal"))
            course = blank_course(code, item.get("name", ""),
                                  infer_credits(code), type_key)

            if item.get("attendance") is not None:
                course["attendance"] = item["attendance"]
            # Raw counts, not just the percentage: they are what makes
            # "you can skip 2 more" answerable.
            if item.get("attended") is not None:
                course["attended"] = item["attended"]
            if item.get("held") is not None:
                course["held"] = item["held"]
            if item.get("internal") is not None:
                course["cie_override"] = item["internal"]

            for slot, exam in zip(("s1", "s2"), item.get("series", [])):
                if exam.get("mark") is not None:
                    course[slot] = exam["mark"]
                    course[f"{slot}_max"] = exam.get("max") or 40

            course["portal_grade"] = item.get("grade") or ""
            course["portal_gpa"] = item.get("gpa")
            course["credits_confirmed"] = False
            courses.append(course)
            needs_credits.append(f"{name}/{code}")

        if not courses:
            continue
        # Check the seeded credits against the total the portal published for
        # this semester, so a bad inference is visible immediately.
        check = verify_credits(courses, entry.get("earned_credits"))
        semesters[name] = {"courses": courses, "credit_check": check}

        sgpa_value = entry.get("sgpa")
        if sgpa_value:
            history[name] = {
                "sgpa": sgpa_value,
                "credits": entry.get("earned_credits") or 0,
            }

    return {
        "semesters": semesters,
        "history": history,
        "current": f"S{academics['current']}" if academics.get("current") else None,
        "needs_credits": needs_credits,
    }


def _infer_type(code: str) -> str:
    letters = re.match(r"^([A-Z]+)", (code or "").upper())
    block = letters.group(1) if letters else ""
    return "LAB 75/25" if block.endswith("L") else "TH 40/60"


def _fit_type(type_key: str, internal) -> str:
    from targetx import COURSE_TYPES
    if internal is None:
        return type_key
    ceiling = COURSE_TYPES[type_key]["cie_max"]
    if internal <= ceiling:
        return type_key
    for candidate in ("TH 50/50", "LAB 75/25", "PRJ 100/0"):
        if internal <= COURSE_TYPES[candidate]["cie_max"]:
            return candidate
    return type_key


def _default_credits(type_key: str) -> int:
    return 2 if type_key.startswith("LAB") else 4


def merge_sync(result: dict) -> list:
    """Fold the attendance and marks passes into one row per course code."""
    merged = {}
    for bucket in ("attendance", "marks"):
        for entry in result.get(bucket, []):
            code = entry["code"].upper()
            row = merged.setdefault(code, {"code": code, "name": ""})
            for key, value in entry.items():
                if key == "code":
                    continue
                if key == "name":
                    if value and not row.get("name"):
                        row["name"] = value
                else:
                    row[key] = value
    return list(merged.values())


def _cli():  # pragma: no cover - manual debugging aid
    import getpass

    if len(sys.argv) < 3:
        print(__doc__)
        print("usage: python etlab_sync.py <portal-url> <username>")
        return 1
    base, username = sys.argv[1], sys.argv[2]
    password = getpass.getpass("etlab password: ")

    client = EtlabClient(base)
    try:
        client.login(username, password)
        print("login ok ->", client.login_url)
        result = client.sync()
    except EtlabError as exc:
        print("ERROR:", exc)
        return 2

    for warning in result["warnings"]:
        print("warn:", warning)
    for row in merge_sync(result):
        print(row)
    client.save_session()
    print("session cookies ->", SESSION_FILE)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_cli())
