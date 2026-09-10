/**
 * Where a portal password is allowed to go.
 *
 * These cover the three decisions the login path makes about a credential:
 * which scheme it travels over, which field name it is bound to, and whether
 * the response counts as authenticated. Each one had a defect that no existing
 * test could see, because the suite only ever proved the TypeScript matched the
 * Python and the Python made the same choices.
 *
 * The DOM-level rules - same-origin form actions, and refusing a form whose
 * fields cannot both be named - are NOT covered here: they need a real
 * DOMParser and the project has no jsdom yet. That gap is deliberate and
 * recorded rather than papered over.
 */
import { describe, expect, it } from "vitest";
import { LOGIN_TITLE_RE, USER_FIELD_RE, normaliseBase, typedInsecure } from "../etlab";

describe("normaliseBase: the password never travels in cleartext", () => {
  it("upgrades an explicit http:// to https://", () => {
    // The defect: an explicit scheme was preserved verbatim, so a student who
    // pasted http://... POSTed their portal password across campus wifi in
    // the clear.
    expect(normaliseBase("http://portal.college.edu")).toBe("https://portal.college.edu");
  });

  it("keeps http:// only when the caller has explicitly allowed it", () => {
    // The downgrade exists so a college genuinely without TLS is still
    // reachable - but only from a code path that had to ask first.
    expect(normaliseBase("http://portal.college.edu", true))
      .toBe("http://portal.college.edu");
  });

  it("defaults a bare hostname to https", () => {
    expect(normaliseBase("cet.etlab.in")).toBe("https://cet.etlab.in");
  });

  it("still strips the login path students paste from the address bar", () => {
    expect(normaliseBase("https://cet.etlab.in/user/login")).toBe("https://cet.etlab.in");
    expect(normaliseBase("http://cet.etlab.in/user/login")).toBe("https://cet.etlab.in");
  });

  it("rejects an empty address", () => {
    expect(() => normaliseBase("  ")).toThrow();
  });
});

describe("LOGIN_TITLE_RE: a bounced login announces itself in the title", () => {
  it.each(["Login", "etlab | login", "Sign In", "Log in", "Logon"])(
    "reads %j as still-at-the-login-page", (title) => {
      expect(LOGIN_TITLE_RE.test(title)).toBe(true);
    });

  it.each([
    "Logout",                 // the old code read this ANYWHERE as success
    "Student Dashboard",
    "MITS | Student Portal",
    "Design in Progress",     // contains "sign in"; word boundaries exclude it
  ])("does not read %j as a login page", (title) => {
    expect(LOGIN_TITLE_RE.test(title)).toBe(false);
  });
});

describe("USER_FIELD_RE: a captcha is never bound as the username", () => {
  it.each(["LoginForm[username]", "admn_no", "regno", "user", "student_id"])(
    "accepts %j as a username field", (name) => {
      expect(USER_FIELD_RE.test(name)).toBe(true);
    });

  it.each(["captcha", "g-recaptcha-response", "verifycode", "securitycode"])(
    "refuses %j as a username field", (name) => {
      // The defect: scoring by input TYPE alone, a session-expired stub with a
      // password box plus a captcha box scored as a real login form, and the
      // first text input - the captcha - was bound as the username.
      expect(USER_FIELD_RE.test(name)).toBe(false);
    });
});

/**
 * Telling the student what we did to their address.
 *
 * The upgrade above is right, and for a long time it was also silent: the
 * request went to https, failed, and the app reported "no login form found" -
 * blaming the portal for something TargetX had done to the URL. Worse, the
 * `allowInsecure` escape above had NO caller anywhere in the app, so a college
 * without https could not sync at all and was never told why.
 *
 * `typedInsecure` is what lets the panel say it plainly and offer the one way
 * through. It answers a narrow question - did the student type http themselves
 * - so the offer appears only for the people it is the answer for, and is
 * never a standing invitation to downgrade a connection that works.
 */
describe("typedInsecure: only for an address the student typed as http", () => {
  it("is true for a plainly typed http address", () => {
    expect(typedInsecure("http://portal.college.edu")).toBe(true);
    expect(typedInsecure("  HTTP://portal.college.edu  ")).toBe(true);
  });

  it("is false for https, which needs no explanation", () => {
    expect(typedInsecure("https://portal.college.edu")).toBe(false);
  });

  it("is false for a bare hostname", () => {
    // This one IS upgraded, but from nothing rather than from a choice - the
    // student expressed no scheme, so there is nothing to explain and nothing
    // to offer. Offering here would teach people to click it by habit.
    expect(typedInsecure("cet.etlab.in")).toBe(false);
  });

  it("is false for empty or rubbish input", () => {
    expect(typedInsecure("")).toBe(false);
    expect(typedInsecure("   ")).toBe(false);
    expect(typedInsecure("not a url")).toBe(false);
  });

  it("is not fooled by http appearing later in the string", () => {
    expect(typedInsecure("https://portal.edu/?next=http://x")).toBe(false);
  });
});
