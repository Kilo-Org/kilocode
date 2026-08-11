package ai.kilocode.client.session.ui

import com.intellij.xml.util.XmlStringUtil

internal fun fileLinkText(value: String): String = value.lineSequence()
    .map { it.trim() }
    .filter { it.isNotEmpty() }
    .joinToString(" ")

internal fun fileLinkHtml(value: String): String {
    val text = fileLinkText(value)
    if (text.isBlank()) return ""
    return XmlStringUtil.wrapInHtml("<nobr><u>${XmlStringUtil.escapeString(text)}</u></nobr>")
}
