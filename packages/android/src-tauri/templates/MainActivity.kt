package ai.opencode.android

import android.os.Bundle
import android.view.KeyEvent
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

// UPSTREAM-DIVERGENCE: Copied over Tauri's generated MainActivity.kt by
// patch-android-generated.ts so mobile zoom can use the hardware volume keys.
class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    super.onWebViewCreate(webView)
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val direction = when (event.keyCode) {
      KeyEvent.KEYCODE_VOLUME_UP -> 1
      KeyEvent.KEYCODE_VOLUME_DOWN -> -1
      else -> 0
    }
    if (direction == 0) return super.dispatchKeyEvent(event)
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
      val script = "window.dispatchEvent(new CustomEvent('opencode:hardware-zoom',{detail:{direction:$direction}}))"
      webView?.evaluateJavascript(script, null)
    }
    return true
  }
}
