package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import javax.swing.ScrollPaneConstants

object MdViewFactory {
    fun create(style: SessionEditorStyle = SessionEditorStyle.current(), selection: SessionSelection? = null): MdView =
        hybrid(style, selection)

    fun create(style: SessionEditorStyle, selection: SessionSelection?, code: MdCodeBlockFactory): MdView =
        hybrid(style, selection, code)

    fun hybrid(style: SessionEditorStyle = SessionEditorStyle.current(), selection: SessionSelection? = null): MdView =
        MdViewHybrid(style, selection)

    fun hybrid(
        style: SessionEditorStyle,
        selection: SessionSelection?,
        code: MdCodeBlockFactory,
    ): MdView = MdViewHybrid(style, selection, code)

    fun hybrid(code: MdCodeBlockFactory): MdView = hybrid(SessionEditorStyle.current(), null, code)

    fun html(style: SessionEditorStyle = SessionEditorStyle.current(), selection: SessionSelection? = null): MdView =
        hybrid(style, selection)
}

data class MdCodeBlockOptions(
    val border: MdCodeBlockBorder = MdCodeBlockBorder.All,
    val maxLines: Int? = null,
    val verticalPolicy: Int = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER,
    val editorOnly: Boolean = false,
)

enum class MdCodeBlockBorder { All, Horizontal, Bottom }

data class MdCodeBlockFactory(val opts: MdCodeBlockOptions = MdCodeBlockOptions()) {
    companion object {
        fun default(opts: MdCodeBlockOptions = MdCodeBlockOptions()) = MdCodeBlockFactory(opts)
    }
}
