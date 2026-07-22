package ai.kilocode.client.settings.base

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import javax.swing.ScrollPaneConstants

/**
 * Shared code-editor primitives for settings dialogs (skill content, instruction files).
 *
 * Keeps the tuned [EditorTextField] configuration, scroll chrome, and content-aware file-type
 * detection in one place so pages don't each hand-roll their own editor.
 */
internal class SettingsContentField(
    content: String,
    fileType: FileType,
    editable: Boolean,
) : EditorTextField(
    EditorFactory.getInstance().createDocument(content),
    ProjectManager.getInstance().defaultProject,
    fileType,
    !editable,
    false,
) {
    init {
        border = JBUI.Borders.empty()
        setOneLineMode(false)
        addSettingsProvider { ed ->
            ed.setBorder(JBUI.Borders.empty())
            ed.scrollPane.border = JBUI.Borders.empty()
            ed.scrollPane.viewportBorder = JBUI.Borders.empty()
            ed.settings.isUseSoftWraps = true
            ed.settings.isPaintSoftWraps = false
            ed.settings.isAdditionalPageAtBottom = false
            ed.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            ed.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        }
    }
}

internal fun settingsContentScroll(field: SettingsContentField) = JBScrollPane(field).apply {
    viewportBorder = JBUI.Borders.empty(
        JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
        JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
        JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
        JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
    )
    horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
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
