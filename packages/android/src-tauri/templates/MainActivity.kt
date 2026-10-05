package ai.opencode.android

import android.os.Bundle
import android.view.KeyEvent
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

// Generated Tauri activities are replaced by this reviewed edge-to-edge shell.
class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
