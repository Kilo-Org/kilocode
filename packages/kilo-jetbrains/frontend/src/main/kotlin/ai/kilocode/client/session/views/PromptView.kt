package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.util.ui.JBUI

class PromptView(
    text: Text,
    openUrl: (String) -> Unit = {},
    selection: SessionSelection? = null,
) : TextView(text, transparent = true, openUrl = openUrl, selection = selection) {

    init {
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
        )
    }

    override fun styleFont(style: SessionEditorStyle) = style.editorFont

    override fun styleBackground(style: SessionEditorStyle) = style.editorBackground

    override fun dumpLabel() = "PromptView#$contentId"
}
