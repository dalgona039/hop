package __HOP_PACKAGE__

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class HopAndroidBridge(
  private val activity: Activity,
) {
  private val createDocumentInFlight = AtomicBoolean(false)
  private val createDocumentLock = Any()
  private var createDocumentLatch: CountDownLatch? = null
  private var createDocumentResult: String? = null

  private val createDocumentLauncher: ActivityResultLauncher<Intent>? =
    (activity as? ComponentActivity)?.registerForActivityResult(
      ActivityResultContracts.StartActivityForResult(),
    ) { result ->
      val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
      if (uri != null) {
        persistUriPermissionInternal(uri)
      }

      synchronized(createDocumentLock) {
        createDocumentResult = uri?.toString()
        createDocumentLatch?.countDown()
      }
      createDocumentInFlight.set(false)
    }

  @JavascriptInterface
  fun persistUriPermission(uriText: String): Boolean {
    return runCatching {
      val uri = Uri.parse(uriText)
      persistUriPermissionInternal(uri)
    }.getOrDefault(false)
  }

  @JavascriptInterface
  fun getUriMetadata(uriText: String): String {
    return runCatching {
      val uri = Uri.parse(uriText)
      persistUriPermissionInternal(uri)
      metadataJson(uri)
    }.getOrElse {
      JSONObject().apply {
        put("displayName", JSONObject.NULL)
        put("mimeType", JSONObject.NULL)
        put("size", JSONObject.NULL)
        put("writable", false)
      }.toString()
    }
  }

  @JavascriptInterface
  fun readUriBytesBase64(uriText: String): String {
    val uri = Uri.parse(uriText)
    persistUriPermissionInternal(uri)

    val bytes = activity.contentResolver.openInputStream(uri)?.use { input ->
      input.readBytes()
    } ?: throw IllegalStateException("content URI 스트림을 열 수 없습니다: $uriText")

    return Base64.encodeToString(bytes, Base64.NO_WRAP)
  }

  @JavascriptInterface
  fun readUriDocument(uriText: String): String {
    val uri = Uri.parse(uriText)
    persistUriPermissionInternal(uri)

    val metadata = metadataJson(uri)
    val payload = JSONObject(metadata)
    payload.put("base64", readUriBytesBase64(uriText))
    return payload.toString()
  }

  @JavascriptInterface
  fun writeUriBytesBase64(uriText: String, bytesBase64: String) {
    val uri = Uri.parse(uriText)
    persistUriPermissionInternal(uri)

    val bytes = Base64.decode(bytesBase64, Base64.DEFAULT)
    activity.contentResolver.openOutputStream(uri, "wt")?.use { output ->
      output.write(bytes)
      output.flush()
    } ?: throw IllegalStateException("content URI 쓰기 스트림을 열 수 없습니다: $uriText")
  }

  @JavascriptInterface
  fun materializeUriToCachePath(uriText: String): String {
    val uri = Uri.parse(uriText)
    persistUriPermissionInternal(uri)

    val metadata = JSONObject(metadataJson(uri))
    val displayName = metadata.optString("displayName", "")
      .trim()
      .ifBlank { "document.hwp" }
    val safeDisplayName = sanitizeFileName(displayName)
    val cacheFile = File(activity.cacheDir, "hop-uri-${UUID.randomUUID()}-$safeDisplayName")

    activity.contentResolver.openInputStream(uri)?.use { input ->
      FileOutputStream(cacheFile).use { output ->
        input.copyTo(output)
      }
    } ?: throw IllegalStateException("content URI 스트림을 열 수 없습니다: $uriText")

    return JSONObject(metadata.toString()).apply {
      put("path", cacheFile.absolutePath)
      put("displayName", safeDisplayName)
    }.toString()
  }

  @JavascriptInterface
  fun pickWritableUri(suggestedFileName: String, mimeType: String): String? {
    val launcher = createDocumentLauncher ?: return null
    if (!createDocumentInFlight.compareAndSet(false, true)) {
      return null
    }

    val latch = CountDownLatch(1)
    synchronized(createDocumentLock) {
      createDocumentLatch = latch
      createDocumentResult = null
    }

    activity.runOnUiThread {
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = if (mimeType.isBlank()) "application/octet-stream" else mimeType
        putExtra(Intent.EXTRA_TITLE, suggestedFileName)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }
      launcher.launch(intent)
    }

    val completed = runCatching {
      latch.await(120, TimeUnit.SECONDS)
    }.getOrElse {
      false
    }

    val result = synchronized(createDocumentLock) {
      val value = if (completed) createDocumentResult else null
      createDocumentLatch = null
      createDocumentResult = null
      value
    }

    if (!completed) {
      createDocumentInFlight.set(false)
    }

    return result?.trim()?.ifBlank { null }
  }

  private fun metadataJson(uri: Uri): String {
    val resolver = activity.contentResolver
    var displayName: String? = null
    var size: Long? = null

    resolver.query(uri, null, null, null, null)?.use { cursor ->
      val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
      val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
      if (cursor.moveToFirst()) {
        if (nameIndex >= 0) {
          displayName = cursor.getString(nameIndex)
        }
        if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
          size = cursor.getLong(sizeIndex)
        }
      }
    }

    val mimeType = resolver.getType(uri)
    val writable = isWritable(uri)

    return JSONObject().apply {
      put("displayName", displayName ?: JSONObject.NULL)
      put("mimeType", mimeType ?: JSONObject.NULL)
      put("size", size ?: JSONObject.NULL)
      put("writable", writable)
    }.toString()
  }

  private fun isWritable(uri: Uri): Boolean {
    return runCatching {
      activity.contentResolver.openFileDescriptor(uri, "rw")?.use { }
      true
    }.getOrDefault(false)
  }

  private fun persistUriPermissionInternal(uri: Uri): Boolean {
    val resolver = activity.contentResolver
    val readWriteFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    val writeResult = runCatching {
      resolver.takePersistableUriPermission(uri, readWriteFlags)
      true
    }.getOrElse {
      false
    }

    if (writeResult) return true

    return runCatching {
      resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      true
    }.getOrDefault(false)
  }

  private fun sanitizeFileName(fileName: String): String {
    val sanitized = fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim()
    return if (sanitized.isBlank()) "document.hwp" else sanitized
  }
}
