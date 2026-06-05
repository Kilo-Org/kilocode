package ai.kilocode.client.ui.md

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection

object MdViewFactory {
    fun create(style: SessionEditorStyle = SessionEditorStyle.current(), selection: SessionSelection? = null): MdView =
        hybrid(style, selection)

    fun hybrid(style: SessionEditorStyle = SessionEditorStyle.current(), selection: SessionSelection? = null): MdView =
        MdViewHybrid(style, selection)

    fun html(style: SessionEditorStyle = SessionEditorStyle.current(), selection: SessionSelection? = null): MdView =
        MdViewHtmlPane(style, selection)
}
