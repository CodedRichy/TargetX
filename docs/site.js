/*
 * Theme: auto, light or dark.
 *
 * "Auto" is the default and is a real third state, not the absence of a
 * choice — it means "whatever this machine is set to", which is what every
 * other page the visitor has open is already doing. A two-way switch would
 * make that unreachable the moment it was pressed.
 *
 * The stored choice is applied by a tiny script in the <head> BEFORE the page
 * paints. Doing it here instead would show the wrong theme for a frame and
 * then snap — the flash of the other colour scheme, which looks like a bug
 * and is one.
 */
(function () {
  "use strict";

  var KEY = "targetx.theme";
  var group = document.querySelector(".theme");
  if (!group) return;

  function apply(choice) {
    if (choice === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", choice);
    group.querySelectorAll("button").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === choice));
    });
  }

  var stored;
  try { stored = localStorage.getItem(KEY); } catch (error) { stored = null; }
  apply(stored === "light" || stored === "dark" ? stored : "auto");

  group.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-theme]");
    if (!button) return;
    var choice = button.dataset.theme;
    apply(choice);
    // A refused write (private mode, blocked site data) must not stop the
    // theme changing for the page they are looking at now.
    try {
      if (choice === "auto") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch (error) { /* the choice still applies to this page */ }
  });
})();

/*
 * Two enhancements, both optional. Every link on this page already goes
 * somewhere useful with JavaScript switched off or the request refused, which
 * is the point: the static state is the design, and this only sharpens it.
 */
(function () {
  "use strict";

  var REPO = "CodedRichy/TargetX";
  var RELEASES = "https://github.com/" + REPO + "/releases";

  /* --- which platform is this? ------------------------------------------ */
  /*
   * Guessing, and saying so by offering rather than deciding: the full table
   * is directly below, and every row is one click away. A wrong guess should
   * cost a reader one glance, never a download that cannot run.
   *
   * `navigator.userAgentData` is the supported way to ask and is exact where
   * it exists (Chromium). Everything else still needs the user-agent string,
   * which browsers have been freezing for years - so it is read for the OS
   * family only, never for a version.
   */
  function platform() {
    var d = navigator.userAgentData;
    if (d && d.platform) {
      var p = d.platform.toLowerCase();
      if (d.mobile) return "mobile";
      if (p.indexOf("win") === 0) return "windows";
      if (p.indexOf("mac") === 0) return "macos";
      if (p.indexOf("linux") === 0 || p === "chrome os") return "linux";
    }

    var ua = navigator.userAgent || "";

    /* Phones and tablets first, or they are misread as the desktop OS they
       are related to and handed an installer that cannot run. An iPad has
       reported itself as "Macintosh" since iPadOS 13, which no amount of
       string matching distinguishes from a real Mac - the touch points do,
       because no Mac reports more than one. */
    if (/iPhone|iPod|Android/i.test(ua)) return "mobile";
    if (/iPad/i.test(ua)) return "mobile";
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "mobile";

    if (/Windows|Win32|Win64/i.test(ua)) return "windows";
    if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
    if (/Linux|X11|CrOS/i.test(ua)) return "linux";

    /* Unrecognised: fall through to no recommendation rather than a wrong
       one. The table below is the answer either way. */
    return "";
  }

  /* "mobile" and "" are not platforms we build for - they are the two cases
     where the honest thing is to stop recommending and point at the table. */
  var LABEL = {
    windows: "Windows", macos: "macOS", linux: "Linux",
    mobile: "desktop", "": "your computer"
  };

  /* Asset extension -> platform, in the order we would offer them. */
  function classify(name) {
    var n = name.toLowerCase();
    if (/\.exe$/.test(n)) return { os: "windows", kind: "Installer", rank: 0 };
    if (/\.msi$/.test(n)) return { os: "windows", kind: "MSI, for deployment", rank: 1 };
    if (/\.dmg$/.test(n)) return { os: "macos", kind: "Disk image", rank: 0 };
    if (/\.appimage$/.test(n)) return { os: "linux", kind: "AppImage", rank: 0 };
    if (/\.deb$/.test(n)) return { os: "linux", kind: "Debian package", rank: 1 };
    if (/\.rpm$/.test(n)) return { os: "linux", kind: "RPM package", rank: 2 };
    return null;
  }

  function mb(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }

  var here = platform();
  var DESKTOP_ONLY = here === "mobile";

  /* Table order. Sorting by OS name put Linux above Windows, which is the
     alphabet talking rather than anything about the reader - and the row a
     reader wants is the one for the machine they are on, so that OS goes
     first and the rest follow in order of how many students run them. */
  var OS_ORDER = { windows: 1, macos: 2, linux: 3 };
  function weight(os) { return os === here ? 0 : (OS_ORDER[os] || 9); }

  /* The OS warnings the two notices below the table explain. Repeated on the
     row itself so someone who scans straight to a download still meets them.
     Kept here as well as in the static markup because these rows replace it. */
  var UNSIGNED = {
    windows: "unsigned",
    macos: "not notarised"
  };
  var heroBtn = document.getElementById("hero-dl");
  heroBtn.firstChild.nodeValue = DESKTOP_ONLY
    ? "See the downloads "
    : "Download for " + LABEL[here] + " ";
  /* On a phone the button cannot do what it says, so it stops claiming to:
     it scrolls to the table instead of handing over an installer that will
     not run. */
  if (DESKTOP_ONLY) heroBtn.href = "#download";

  /* --- fill in the real release, if we can reach it --------------------- */
  var meta = document.getElementById("dl-meta");

  function noRelease(message, action, href) {
    meta.textContent = message;
    /* "Recommended for you: desktop" reads as though desktop were a platform
       we had picked out. On a phone there is nothing to recommend, so the
       card says what the app is instead. */
    if (DESKTOP_ONLY) {
      document.getElementById("dl-for").textContent = "TargetX";
      document.getElementById("dl-what").textContent = "A desktop app";
    } else {
      document.getElementById("dl-what").textContent = LABEL[here];
    }
    if (action) {
      var button = document.getElementById("dl-button");
      button.textContent = action;
      if (href) { button.href = href; heroBtn.href = href; }
      heroBtn.firstChild.nodeValue = action + " ";
      document.getElementById("hero-dl-meta").textContent = "";
    }
  }

  if (!window.fetch) { noRelease("See the releases page for the current build."); return; }

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
    headers: { Accept: "application/vnd.github+json" }
  }).then(function (response) {
    if (response.status === 404) {
      noRelease(
        "No build has been published yet. Watch the repository and this page " +
        "will offer it the day there is one.",
        "Watch on GitHub", "https://github.com/" + REPO);
      return null;
    }
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }).then(function (release) {
    if (!release) return;

    var assets = (release.assets || []).map(function (asset) {
      var kind = classify(asset.name);
      return kind && {
        os: kind.os, kind: kind.kind, rank: kind.rank,
        name: asset.name, size: asset.size, url: asset.browser_download_url
      };
    }).filter(Boolean).sort(function (a, b) {
      return weight(a.os) - weight(b.os) || a.rank - b.rank;
    });

    if (!assets.length) {
      noRelease("The latest release carries no installer yet.", "Open releases", RELEASES);
      return;
    }

    var version = release.tag_name || "";

    /* The one that matches this machine, promoted. */
    var mine = assets.filter(function (a) { return a.os === here; })[0];
    if (DESKTOP_ONLY) {
      /* Not a failure, and it should not read as one. TargetX is a desktop
         app; a phone is simply not where it gets installed, and saying that
         plainly is more use than offering a .dmg that cannot open. */
      document.getElementById("dl-for").textContent = "TargetX " + version;
      document.getElementById("dl-what").textContent = "A desktop app";
      meta.textContent = "Open this page on your laptop to install it. " +
        "Every build is listed below.";
      var mobileBtn = document.getElementById("dl-button");
      mobileBtn.href = RELEASES;
      mobileBtn.textContent = "All builds";
      document.getElementById("hero-dl-meta").textContent = "· " + version;
    } else if (mine) {
      document.getElementById("dl-what").textContent = LABEL[here] + " · " + mine.kind;
      meta.textContent = mine.name + " · " + mb(mine.size);
      var button = document.getElementById("dl-button");
      button.href = mine.url;
      button.textContent = "Download " + version;
      heroBtn.href = mine.url;
      document.getElementById("hero-dl-meta").textContent = "· " + version;
    } else {
      document.getElementById("dl-for").textContent = "Latest release";
      document.getElementById("dl-what").textContent = version;
      meta.textContent = "No build for " + LABEL[here] + " in this release.";
    }

    /* And the full table, replacing the static one. */
    var rows = assets.map(function (a) {
      return "<tr>" +
        "<td>" + LABEL[a.os] + "</td>" +
        "<td class=\"file\">" + a.name +
          (UNSIGNED[a.os] ? " <span class=\"unsigned\">" + UNSIGNED[a.os] + "</span>" : "") +
        "</td>" +
        "<td class=\"size\">" + mb(a.size) + "</td>" +
        "<td><a href=\"" + a.url + "\">Download</a></td>" +
        "</tr>";
    }).join("");
    document.getElementById("dl-rows").innerHTML = rows;
    document.querySelector("#dl-table caption").textContent =
      "Every build in " + version;
  }).catch(function () {
    noRelease("Could not reach GitHub — the releases page has every build.");
  });
})();

/* --- the quiet entrance ------------------------------------------------- */
(function () {
  if (!window.IntersectionObserver) return;
  var targets = document.querySelectorAll(".band-inner > div, .hero > *");
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("seen");
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  targets.forEach(function (el) { el.classList.add("rise"); observer.observe(el); });
})();
