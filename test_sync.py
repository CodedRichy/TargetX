"""
End-to-end test for etlab_sync against a fake Yii-style portal served locally.

Proves the discovery logic works without touching a real college portal:
the fake server uses a non-obvious login route, a Yii1 CSRF field name, and
data routes that are NOT the first candidate in the list.
"""

import http.server
import socketserver
import threading
import sys
import urllib.parse

CSRF = "yii-token-abc123"
COOKIE = "PHPSESSID=fake-session-value"

LOGIN_PAGE = f"""<html><body>
<form action="/site/login" method="post">
  <input type="hidden" name="YII_CSRF_TOKEN" value="{CSRF}">
  <input type="text" name="LoginForm[username]">
  <input type="password" name="LoginForm[password]">
  <button>Login</button>
</form></body></html>"""

DASHBOARD = "<html><body><a href='/site/logout'>Logout</a> Dashboard</body></html>"

ATTENDANCE_PAGE = """<html><body><a href='/site/logout'>Logout</a>
<table>
<tr><th>Code</th><th>Subject</th><th>Present</th><th>Total</th><th>%</th></tr>
<tr><td>PCCST302</td><td>Data Structures</td><td>38</td><td>42</td><td>90.48%</td></tr>
<tr><td>PCCST303</td><td>Object Oriented Programming</td><td>30</td><td>45</td><td>66.67%</td></tr>
<tr><td>GCMAT301</td><td>Discrete Maths</td><td>40</td><td>44</td><td>90.91%</td></tr>
</table></body></html>"""

INTERNALS_PAGE = """<html><body><a href='/site/logout'>Logout</a>
<table>
<tr><th>Code</th><th>Subject</th><th>Series 1</th><th>Series 2</th><th>Assignment</th></tr>
<tr><td>PCCST302</td><td>Data Structures</td><td>41</td><td>38</td><td>9</td></tr>
<tr><td>PCCST303</td><td>Object Oriented Programming</td><td>22</td><td>19</td><td>6</td></tr>
<tr><td>GCMAT301</td><td>Discrete Maths</td><td>45</td><td>44</td><td>10</td></tr>
</table></body></html>"""

LOGGED_OUT = "<html><body><form><input type='password' name='p'></form></body></html>"


class Handler(http.server.BaseHTTPRequestHandler):
    authed = False

    def log_message(self, *args):
        pass

    def _send(self, body, cookie=False):
        data = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if cookie:
            self.send_header("Set-Cookie", COOKIE + "; Path=/")
        self.end_headers()
        self.wfile.write(data)

    def _404(self):
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        # /user/login (the first candidate) deliberately does not exist here.
        if path in ("/site/login", "/"):
            self._send(LOGIN_PAGE)
        elif not Handler.authed:
            self._send(LOGGED_OUT)
        elif path == "/student/attendance":
            self._send(ATTENDANCE_PAGE)
        elif path == "/ktu/student/internals":
            # NOT the first internals candidate - forces the probe to walk on.
            self._send(INTERNALS_PAGE)
        elif path == "/dashboard":
            self._send(DASHBOARD)
        else:
            self._404()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        form = urllib.parse.parse_qs(self.rfile.read(length).decode("utf-8"))
        token = form.get("YII_CSRF_TOKEN", [""])[0]
        user = form.get("LoginForm[username]", [""])[0]
        password = form.get("LoginForm[password]", [""])[0]
        if token == CSRF and user == "KTU2024CS001" and password == "hunter2":
            Handler.authed = True
            self._send(DASHBOARD, cookie=True)
        else:
            self._send(LOGIN_PAGE)


def main():
    failures = []

    def check(label, got, want):
        if got != want:
            failures.append(label)
            print(f"FAIL {label}: got {got!r}, want {want!r}")
        else:
            print(f"ok   {label}")

    socketserver.TCPServer.allow_reuse_address = True
    server = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    import etlab_sync as es

    # Wrong password must be rejected, not silently accepted.
    client = es.EtlabClient(base)
    try:
        client.login("KTU2024CS001", "wrong")
        check("bad password rejected", "accepted", "raised")
    except es.EtlabError:
        print("ok   bad password rejected")

    client = es.EtlabClient(base)
    check("login", client.login("KTU2024CS001", "hunter2"), True)
    check("discovered login route", client.login_url.endswith("/site/login"), True)

    result = client.sync()
    check("attendance rows", len(result["attendance"]), 3)
    check("marks rows", len(result["marks"]), 3)
    check("no warnings", result["warnings"], [])

    merged = es.merge_sync(result)
    by_code = {r["code"]: r for r in merged}
    check("merged codes", sorted(by_code), ["GCMAT301", "PCCST302", "PCCST303"])
    check("attendance parsed", by_code["PCCST302"]["attendance"], 90.48)
    check("marks parsed", (by_code["PCCST302"]["s1"], by_code["PCCST302"]["s2"],
                           by_code["PCCST302"]["other"]), (41.0, 38.0, 9.0))
    check("shortage subject", by_code["PCCST303"]["attendance"] < 75, True)

    # Feed a merged row straight into the engine - the contract that matters.
    import targetx as tx
    course = tx.blank_course("PCCST302", "Data Structures", 4)
    course.update({k: v for k, v in by_code["PCCST302"].items()
                   if k in ("s1", "s2", "other", "attendance")})
    ev = tx.evaluate(course)
    check("CIE from synced marks", ev["cie"], 32.7)
    check("status from synced data", tx.status_for(ev)[0], "SAFE")

    course2 = tx.blank_course("PCCST303", "OOP", 4)
    course2.update({k: v for k, v in by_code["PCCST303"].items()
                    if k in ("s1", "s2", "other", "attendance")})
    check("shortage status", tx.status_for(tx.evaluate(course2))[0], "SHORTAGE")

    # Session round-trip: cookies persist, password never does.
    import tempfile
    path = tempfile.mktemp(suffix=".json")
    client.save_session(path)
    with open(path, encoding="utf-8") as handle:
        blob = handle.read()
    check("cookie stored", "fake-session-value" in blob, True)
    check("password not stored", "hunter2" in blob, False)
    revived = es.EtlabClient.from_session(path)
    check("session revived", revived is not None and revived.session_alive(), True)
    es.EtlabClient.forget_session(path)

    server.shutdown()
    print()
    if failures:
        print(f"{len(failures)} FAILURES")
        return 1
    print("all sync checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
