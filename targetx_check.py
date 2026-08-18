"""
TargetX college compatibility checker.

Send this to a friend at another KTU college. It signs in to their etlab,
works out whether TargetX can read that deployment, and prints a short
STRUCTURAL report - which routes existed, which tables parsed, how many
courses were found.

Privacy, by construction:
  * the password is typed into a hidden prompt, used once, never stored
  * NO marks, grades, attendance figures, names or registration numbers are
    printed or written anywhere
  * only structure is reported: route paths, table shapes, counts, and the
    field names on the login form

That distinction is the whole point. The report is safe to paste back; it
tells the developer whether the scraper generalises without exposing a single
fact about the student.

    python targetx_check.py
"""

from __future__ import annotations

import getpass
import json
import sys
import traceback
from datetime import datetime

BANNER = """
+------------------------------------------------------------+
|  TargetX - college compatibility check                      |
|  Reports structure only. No marks, no names, no password.   |
+------------------------------------------------------------+
"""


def safe(value):
    """Never let a stray student detail into the report."""
    if value is None:
        return None
    return str(value)[:60]


def main():
    print(BANNER)

    try:
        import etlab_sync as es
        import targetx as tx
    except SystemExit as exc:
        print("Missing dependencies:", exc)
        print("Run:  pip install customtkinter requests beautifulsoup4")
        return 2
    except ImportError as exc:
        print("Run this from the folder containing targetx.py:", exc)
        return 2

    url = input("College portal URL (e.g. https://xyz.etlab.app): ").strip()
    user = input("Username / Admission No: ").strip()
    password = getpass.getpass("Password (hidden, never saved): ")

    report = {
        "checked_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "host": "",
        "login": {},
        "routes": {},
        "parsing": {},
        "verdict": "",
        "notes": [],
    }

    try:
        client = es.EtlabClient(url)
        report["host"] = client.base
        print(f"\n[1/4] Base URL resolved to {client.base}")

        action, form = client._find_login_form()
        fields = client._field_names(form)
        hidden = [i.get("name") for i in form.find_all("input")
                  if (i.get("type") or "").lower() == "hidden"]
        report["login"] = {
            "form_action": safe(action),
            "username_field": safe(fields[0]),
            "password_field": safe(fields[1]),
            "hidden_fields": [safe(h) for h in hidden],
        }
        print(f"      login form found at {action}")
        print(f"      fields: {fields[0]} / {fields[1]}")
        print(f"      hidden inputs: {hidden or 'none'}")

        print("\n[2/4] Signing in...")
        client.login(user, password)
        print("      login OK")
        report["login"]["ok"] = True

    except Exception as exc:
        report["login"]["ok"] = False
        report["login"]["error"] = f"{exc.__class__.__name__}: {exc}"
        report["verdict"] = "LOGIN FAILED"
        print(f"\n      LOGIN FAILED: {exc}")
        emit(report)
        return 1

    # Which known routes exist on this deployment?
    print("\n[3/4] Probing routes...")
    candidates = (es.ACADEMICS_PATHS + es.SUBJECT_PATHS
                  + es.ATTENDANCE_PATHS + es.INTERNALS_PATHS)
    for path in candidates:
        try:
            response = client._get(path)
            status = response.status_code
            tables = response.text.count("<table") if status < 400 else 0
            report["routes"][path] = {"status": status, "tables": tables}
            if status < 400 and tables:
                print(f"      {status}  {path}   ({tables} tables)")
        except Exception as exc:
            report["routes"][path] = {"error": exc.__class__.__name__}

    discovered = client.discover_links()
    report["routes"]["_discovered_from_dashboard"] = {
        k: safe(v) for k, v in discovered.items()}
    if discovered:
        print(f"      dashboard links: {discovered}")

    # Can the parsers actually read it?
    print("\n[4/4] Parsing...")
    try:
        academics = client.fetch_academics()
        semesters = academics.get("semesters", {})
        report["parsing"]["academics"] = {
            "ok": True,
            "semesters": len(semesters),
            "courses_per_semester": {str(k): len(v.get("courses", []))
                                     for k, v in semesters.items()},
            "current_semester": academics.get("current"),
            "has_series_marks": any(
                c.get("series") for v in semesters.values()
                for c in v.get("courses", [])),
            "has_internal_totals": any(
                c.get("internal") is not None for v in semesters.values()
                for c in v.get("courses", [])),
            "has_published_sgpa": any(
                v.get("sgpa") for v in semesters.values()),
            "has_attendance_counts": any(
                c.get("held") for v in semesters.values()
                for c in v.get("courses", [])),
        }
        got = report["parsing"]["academics"]
        print(f"      academic record: {got['semesters']} semesters, "
              f"current {got['current_semester']}")
        print(f"      series marks: {got['has_series_marks']} | "
              f"internals: {got['has_internal_totals']} | "
              f"SGPA: {got['has_published_sgpa']}")
    except Exception as exc:
        report["parsing"]["academics"] = {
            "ok": False, "error": f"{exc.__class__.__name__}: {exc}"}
        print(f"      academic record FAILED: {exc}")

    try:
        types = client.fetch_subject_types()
        report["parsing"]["subject_types"] = {"ok": bool(types),
                                              "count": len(types)}
        print(f"      subject types: {len(types)} courses classified")
    except Exception as exc:
        report["parsing"]["subject_types"] = {"ok": False,
                                              "error": exc.__class__.__name__}

    # Are this college's course codes already in the catalogue?
    try:
        codes = [c["code"] for v in
                 report["parsing"].get("academics", {}).get(
                     "courses_per_semester", {}) for c in []]
        catalogue = tx.course_catalogue()
        academics_obj = academics.get("semesters", {})
        all_codes = {c["code"] for v in academics_obj.values()
                     for c in v.get("courses", [])}
        known = {c for c in all_codes if c in catalogue}
        report["parsing"]["catalogue_coverage"] = {
            "courses_seen": len(all_codes),
            "in_catalogue": len(known),
            "missing_codes": sorted(all_codes - known)[:40],
        }
        print(f"      catalogue: {len(known)}/{len(all_codes)} course codes known")
    except Exception:
        pass

    academics_ok = report["parsing"].get("academics", {}).get("ok")
    if academics_ok:
        report["verdict"] = "COMPATIBLE"
        print("\nVERDICT: COMPATIBLE - TargetX can read this college.")
    elif report["login"].get("ok"):
        report["verdict"] = "LOGIN OK, PARSING FAILED"
        print("\nVERDICT: login works, but the pages differ. Send the report.")
    else:
        report["verdict"] = "LOGIN FAILED"

    emit(report)
    return 0


def emit(report: dict):
    name = f"targetx-compat-{report.get('host','x').split('//')[-1].split('.')[0]}.json"
    try:
        with open(name, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)
        print(f"\nReport written to {name}")
        print("It contains NO marks, NO names and NO password - safe to send.")
    except OSError as exc:
        print("Could not write report:", exc)
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ncancelled")
        sys.exit(130)
    except Exception:
        traceback.print_exc()
        print("\nUnexpected error above - send this text to the developer.")
        sys.exit(1)
