package ai.kilocode.client.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import javax.swing.ScrollPaneConstants

internal class CodeViewField(
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

internal fun codeViewScroll(field: CodeViewField) = JBScrollPane(field).apply {
    viewportBorder = JBUI.Borders.empty(
        JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
        JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
        JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
        JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
    )
    horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
}
