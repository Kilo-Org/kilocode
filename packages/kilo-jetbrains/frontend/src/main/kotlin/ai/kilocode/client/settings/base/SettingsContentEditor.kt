package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.CodeViewField
import ai.kilocode.client.ui.codeViewScroll
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.util.ui.JBUI

internal fun settingsContentScroll(field: CodeViewField) = codeViewScroll(field).apply {
    preferredSize = JBUI.size(720, 520)
}

/**
 * Resolve a [FileType] for editor highlighting. Content syntax wins over the file name so
 * extension-less locations still highlight correctly; unknown types fall back to plain text.
 */
internal fun settingsEditorFileType(name: String, content: String? = null): FileType {
    val syntax = content?.syntaxName()
    val fileName = syntax ?: name.substringAfterLast('/').substringAfterLast('\\').ifBlank { "file.txt" }
    val type = FileTypeManager.getInstance().getFileTypeByFileName(fileName)
    if (type == UnknownFileType.INSTANCE) return PlainTextFileType.INSTANCE
    return type
}

private fun String.syntaxName(): String? {
    val text = trimStart()
    if (text.isBlank()) return null
    if (text.looksHtml()) return "index.html"
    if (text.looksMarkdown()) return "content.md"
    return null
}

private fun String.looksHtml() = contains(Regex("^\\s*(<!doctype\\s+html|<html\\b|<body\\b|</?(h[1-6]|p|pre|code|ul|ol|li|blockquote|br)\\b)", RegexOption.IGNORE_CASE))

private fun String.looksMarkdown() = lineSequence().any { line ->
    line.matches(Regex("\\s{0,3}(#{1,6}\\s+.+|[-*+]\\s+.+|\\d+\\.\\s+.+|```.*|>\\s+.+)")) ||
        line.contains(Regex("(`[^`]+`|\\[[^]]+][(][^)]+[)])"))
}
