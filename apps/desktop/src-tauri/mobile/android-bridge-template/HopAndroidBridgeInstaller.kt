package __HOP_PACKAGE__

import android.app.Activity
import android.webkit.WebView
import androidx.core.view.WindowCompat
import java.util.Collections
import java.util.WeakHashMap

object HopAndroidBridgeInstaller {
  private const val BRIDGE_INSTALL_RETRY_DELAY_MS = 50L
  private const val BRIDGE_INSTALL_MAX_RETRIES = 40
  private val installedWebViews = Collections.newSetFromMap(WeakHashMap<WebView, Boolean>())

  fun install(activity: Activity, bridge: HopAndroidBridge) {
    // Keep app content below Android system bars to avoid toolbar overlap.
    WindowCompat.setDecorFitsSystemWindows(activity.window, true)
    installBridgeWithRetry(activity, bridge, BRIDGE_INSTALL_MAX_RETRIES)
  }

  private fun installBridgeWithRetry(activity: Activity, bridge: HopAndroidBridge, retriesLeft: Int) {
    val webView = resolveWebView(activity)
    if (webView != null) {
      if (markInstalled(webView)) {
        webView.addJavascriptInterface(bridge, "__HOP_ANDROID_NATIVE__")
      }
      return
    }
    if (retriesLeft <= 0) return
    activity.window.decorView.postDelayed(
      { installBridgeWithRetry(activity, bridge, retriesLeft - 1) },
      BRIDGE_INSTALL_RETRY_DELAY_MS,
    )
  }

  private fun markInstalled(webView: WebView): Boolean {
    synchronized(installedWebViews) {
      if (installedWebViews.contains(webView)) return false
      installedWebViews.add(webView)
      return true
    }
  }

  private fun resolveWebView(activity: Activity): WebView? {
    var klass: Class<*>? = activity.javaClass
    val fieldNames = listOf("webView", "mWebView", "tauriWebView")

    while (klass != null) {
      for (fieldName in fieldNames) {
        try {
          val field = klass.getDeclaredField(fieldName)
          field.isAccessible = true
          val value = field.get(activity)
          if (value is WebView) {
            return value
          }
        } catch (_: NoSuchFieldException) {
          // continue
        } catch (_: SecurityException) {
          // continue
        }
      }
      klass = klass.superclass
    }

    return null
  }
}
