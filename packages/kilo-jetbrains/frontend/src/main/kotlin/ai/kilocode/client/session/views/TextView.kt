package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.openapi.util.Disposer
import java.awt.BorderLayout

/**
 * Renders a [Text] part as markdown using [MdView].
 *
 * Supports both full-replacement ([update]) and streaming append ([appendDelta]).
 */
open class TextView(
    text: Text,
    transparent: Boolean = false,
    openUrl: (String) -> Unit = {},
    selection: SessionSelection? = null,
) : PartView() {

    override val contentId: String = text.id

    val md: MdView = MdViewFactory.create(SessionEditorStyle.current(), selection)

    init {
        layout = BorderLayout()
        isOpaque = false
        Disposer.register(this, md)
        md.opaque = !transparent
        md.addLinkListener { openUrl(it.href) }
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

    internal fun contentOpaque() = md.opaque

    override fun applyStyle(style: SessionEditorStyle) {
        val font = styleFont(style)
        val bg = styleBackground(style)
        val changed = md.font != font ||
            md.codeFont != style.editorFamily ||
            md.foreground != style.editorForeground ||
            md.background != bg
        md.applyStyle(style)
        if (md.font != font) md.font = font
        if (md.codeFont != style.editorFamily) md.codeFont = style.editorFamily
        if (md.foreground != style.editorForeground) md.foreground = style.editorForeground
        if (md.background != bg) md.background = bg
        if (!changed) return
        refresh()
    }

    protected open fun styleFont(style: SessionEditorStyle) = style.transcriptFont

    protected open fun styleBackground(style: SessionEditorStyle) = SessionUiStyle.View.transcript()

    private fun refresh() {
        revalidate()
        repaint()
    }

    override fun dumpLabel() = "TextView#$contentId"
}
