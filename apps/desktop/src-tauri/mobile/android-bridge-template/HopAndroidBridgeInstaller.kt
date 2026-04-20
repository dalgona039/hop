package __HOP_PACKAGE__

import android.app.Activity
import android.webkit.WebView

object HopAndroidBridgeInstaller {
  fun install(activity: Activity) {
    val webView = resolveWebView(activity) ?: return
    webView.addJavascriptInterface(HopAndroidBridge(activity), "__HOP_ANDROID_NATIVE__")
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
