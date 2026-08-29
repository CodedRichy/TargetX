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
  function platform() {
    var ua = (navigator.userAgent || "");
    if (/Win/i.test(ua)) return "windows";
    if (/Mac|iPhone|iPad/i.test(ua)) return "macos";
    if (/Linux|X11|Android/i.test(ua)) return "linux";
    return "windows";
  }

  var LABEL = { windows: "Windows", macos: "macOS", linux: "Linux" };

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
  var heroBtn = document.getElementById("hero-dl");
  heroBtn.firstChild.nodeValue = "Download for " + LABEL[here] + " ";

  /* --- fill in the real release, if we can reach it --------------------- */
  var meta = document.getElementById("dl-meta");

  function noRelease(message, action, href) {
    meta.textContent = message;
    document.getElementById("dl-what").textContent = LABEL[here];
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
      return a.os.localeCompare(b.os) || a.rank - b.rank;
    });

    if (!assets.length) {
      noRelease("The latest release carries no installer yet.", "Open releases", RELEASES);
      return;
    }

    var version = release.tag_name || "";

    /* The one that matches this machine, promoted. */
    var mine = assets.filter(function (a) { return a.os === here; })[0];
    if (mine) {
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
        "<td class=\"file\">" + a.name + "</td>" +
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
