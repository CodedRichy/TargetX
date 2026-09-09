package cv.codedrichy.targetx

import android.content.res.Configuration
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  /** Held so the Back handler can ask the page whether it has anywhere to go. */
  private var web: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    /*
     * Give Back to the page before giving it to the system.
     *
     * With no handler at all, Back did what an activity that ignores Back
     * always does: it finished, and the app vanished to the launcher. From
     * every screen, and - worse - straight through an open modal, so Back
     * with the Ask palette up threw the student out and took the half-typed
     * question with it. That is the gesture Android users reach for to
     * dismiss a sheet, and it was quitting instead.
     *
     * The web layer is the half that knows what "back" means here: `nav.ts`
     * pushes a history entry per view and per overlay, so `canGoBack` is
     * precisely the question "is there a screen or a modal to undo". While
     * there is, the WebView handles it and the popstate listener does the
     * work. When there is not, we are on the first screen the student saw,
     * and Back there SHOULD leave the app - so the callback disables itself
     * and asks the dispatcher again, which runs the default and finishes.
     *
     * Registered against `onBackPressedDispatcher` rather than by overriding
     * `onBackPressed`, which is deprecated and, with predictive back, is not
     * called at all on newer releases.
     */
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val w = web
        if (w != null && w.canGoBack()) {
          w.goBack()
        } else {
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
        }
      }
    })
  }

  /**
   * Turn off the scrollbar the stylesheet was never able to reach.
   *
   * A vertical scrollbar has been drawn down the right edge of every screen
   * long enough to scroll, in both themes, and `mobile.css` has carried a rule
   * against it the whole time. That rule does nothing here: this WebView
   * reports `CSS.supports("scrollbar-width", "none")` as FALSE - the property
   * is not implemented on Chrome for Android, though it is on the desktop
   * Chromium the rule was presumably checked against. It is the worst kind of
   * fix, the kind that looks applied.
   *
   * `::-webkit-scrollbar` is supported and is NOT dead - it still hides the
   * scrollbars of elements that scroll inside the page, which are ordinary
   * Blink scrollbars. It cannot touch this one, because this one is not a
   * Blink scrollbar at all: it is the Android View's own scroll indicator,
   * painted by the view layer ABOVE the web contents. Two tells confirm that -
   * a CDP content capture taken at the same scroll position does not contain
   * it, and it FADES after a second at rest, which a CSS scrollbar never does
   * and `awakenScrollBars` always does.
   *
   * So it is turned off where it is actually drawn. Scrolling itself is
   * untouched; only the indicator goes, which is the decision the stylesheet
   * had already made for every other scroller in the app.
   */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    web = webView
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = false

    /*
     * NEVER let the platform repaint this app.
     *
     * `setAlgorithmicDarkeningAllowed(true)` was tried first, as the
     * documented way to make `prefers-color-scheme` follow the app's night
     * mode. It did not do that here - measured after a cold start, with the
     * activity configuration reporting `night` and the call confirmed in the
     * shipped dex, the media query still said `light`. What it DID do was
     * give the system permission to invert: with the phone in dark mode and
     * the student having chosen LIGHT in the app, the page declared
     * `color-scheme: light`, WebView darkened it anyway, and light mode came
     * out as neither theme. That is a worse failure than the one it was
     * meant to fix, because it overrides a choice the student made on
     * purpose.
     *
     * So darkening is refused outright and the scheme is carried below, in
     * the user agent, where this app decides its own colours in every case:
     * system dark with "System" selected gives the dark palette; system dark
     * with "Light" selected gives the light one, unmolested.
     */
    if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
      WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
    }

    /*
     * Say the scheme in the user agent, because the media query would not.
     *
     * The setting above is the documented way to make `prefers-color-scheme`
     * follow the app's night mode, and on this device it did not: measured
     * after a cold start, with the activity configuration reporting `night`
     * and the call confirmed present in the shipped dex, the page still read
     * `prefers-color-scheme: light`. Whatever resets it sits below where this
     * class can reach, so the answer is carried where nothing can overwrite it.
     *
     * The user agent, not a plugin - the same reasoning `platform.ts` already
     * gives for detecting Android at all, and the same trade-off: it costs one
     * token on a string the page owns, and the page is the only thing that
     * reads it.
     */
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES
    val ua = webView.settings.userAgentString ?: ""
    if (!ua.contains(SCHEME_TOKEN)) {
      webView.settings.userAgentString =
        ua + " " + SCHEME_TOKEN + (if (night) "dark" else "light")
    }
  }

  /*
   * The UA is fixed at creation, and `uiMode` is in this activity's
   * `configChanges`, so switching the phone to dark mode while the app is open
   * neither recreates the activity nor updates that string. This tells the page
   * directly instead, and the page listens for it.
   */
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    val night = (newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES
    val scheme = if (night) "dark" else "light"
    web?.evaluateJavascript(
      "window.dispatchEvent(new CustomEvent('targetx:scheme'," +
        "{detail:'" + scheme + "'}))",
      null,
    )
  }

  private companion object {
    const val SCHEME_TOKEN = "TargetXScheme/"
  }
}
