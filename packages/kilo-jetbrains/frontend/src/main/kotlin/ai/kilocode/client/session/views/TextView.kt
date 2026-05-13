package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.md.MdView
import java.awt.BorderLayout

/**
 * Renders a [Text] part as markdown using [MdView].
 *
 * Supports both full-replacement ([update]) and streaming append ([appendDelta]).
 */
class TextView(text: Text) : PartView() {

    override val contentId: String = text.id

    val md: MdView = MdView.html()

    init {
        layout = BorderLayout()
        isOpaque = false
        applyStyle(SessionEditorStyle.current())
        add(md.component, BorderLayout.CENTER)
        if (text.content.isNotEmpty()) md.set(text.content.toString())
    }

    override fun update(content: Content) {
        if (content !is Text) return
        md.set(content.content.toString())
        refresh()
    }

    override fun appendDelta(delta: String) {
        if (delta.isEmpty()) return
        md.append(delta)
        refresh()
    }

    /** Current markdown source — used by tests to assert rendered content. */
    fun markdown(): String = md.markdown()

    override fun applyStyle(style: SessionEditorStyle) {
        val changed = md.font != style.transcriptFont || md.codeFont != style.editorFamily
        if (md.font != style.transcriptFont) md.font = style.transcriptFont
        if (md.codeFont != style.editorFamily) md.codeFont = style.editorFamily
        if (!changed) return
        refresh()
    }

    private fun refresh() {
        revalidate()
        repaint()
    }

    override fun dumpLabel() = "TextView#$contentId"
}
