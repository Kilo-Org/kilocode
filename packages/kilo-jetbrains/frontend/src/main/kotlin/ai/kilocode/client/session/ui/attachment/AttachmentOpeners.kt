package ai.kilocode.client.session.ui.attachment

import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.FileTypeManager
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import javax.swing.Icon

fun decodeDataImage(url: String): ByteArray? {
    val data = parseDataUrl(url) ?: return null
    if (!data.mime.startsWith("image/")) return null
    return data.bytes
}

internal data class DataUrl(val mime: String, val bytes: ByteArray)

internal fun parseDataUrl(url: String): DataUrl? {
    if (!url.startsWith("data:")) return null
    val comma = url.indexOf(',')
    if (comma < 0) return null
    val meta = url.substring(5, comma)
    val body = url.substring(comma + 1)
    val parts = meta.split(';').filter { it.isNotBlank() }
    val mime = parts.firstOrNull()?.takeIf { it.contains('/') } ?: "text/plain"
    val bytes = if (parts.any { it.equals("base64", ignoreCase = true) }) {
        runCatching { Base64.getDecoder().decode(body) }.getOrNull() ?: return null
    } else {
        URLDecoder.decode(body, StandardCharsets.UTF_8).toByteArray(StandardCharsets.UTF_8)
    }
    return DataUrl(mime, bytes)
}

internal fun textual(mime: String) = mime.startsWith("text/") || mime in setOf(
    "application/json",
    "application/javascript",
    "application/xml",
    "application/x-yaml",
)

internal fun attachmentIcon(mime: String, name: String = "attachment"): Icon = when {
    mime.startsWith("image/") -> AllIcons.FileTypes.Image
    mime == "application/x-directory" -> AllIcons.Nodes.Folder
    else -> FileTypeManager.getInstance().getFileTypeByFileName(name).icon ?: AllIcons.FileTypes.Text
}

fun isEmbeddedAttachment(url: String) = url.startsWith("data:")

fun isLocalAttachment(url: String) = runCatching { java.net.URI.create(url).scheme == "file" }.getOrDefault(false)
