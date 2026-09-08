package cv.codedrichy.targetx

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
    webView.isVerticalScrollBarEnabled = false
    webView.isHorizontalScrollBarEnabled = false
  }
}
