package cv.codedrichy.targetx

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

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
  }
}
