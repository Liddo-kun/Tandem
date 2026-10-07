package ai.opencode.android

import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// Generated Tauri activities are replaced by this reviewed edge-to-edge shell.
class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Edge-to-edge apps targeting Android 15+ no longer get adjustResize, so the keyboard covered the
    // page and the visible area could be panned over the hidden strip. Shrink the WebView above the
    // keyboard instead, and hide the keyboard inset from it so it doesn't shrink its viewport again.
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      view.setPadding(0, 0, 0, keyboard)
      WindowInsetsCompat.Builder(insets).setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE).build()
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    super.onWebViewCreate(webView)
    if (applicationContext.packageName == "app.liddokun.tandem.v2") {
      WebView.setWebContentsDebuggingEnabled(true)
    }
    webView.settings.setSupportZoom(false)
    webView.settings.builtInZoomControls = false
    webView.settings.displayZoomControls = false
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val direction = when (event.keyCode) {
      KeyEvent.KEYCODE_VOLUME_UP -> 1
      KeyEvent.KEYCODE_VOLUME_DOWN -> -1
      else -> 0
    }
    if (direction != 0 && webView != null) {
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        webView?.evaluateJavascript("window.dispatchEvent(new CustomEvent('opencode:hardware-zoom',{detail:{direction:$direction}}))", null)
      }
      return true
    }
    return super.dispatchKeyEvent(event)
  }
}
