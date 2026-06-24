package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.BorderLayout
import javax.swing.JButton

/**
 * Renders a [Text] part as markdown using [MdView].
 *
 * Supports both full-replacement ([update]) and streaming append ([appendDelta]).
 */
open class TextView(
    text: Text,
    transparent: Boolean = true,
    private val openUrl: (String) -> Unit = {},
    selection: SessionSelection? = null,
) : PartView() {

    override val contentId: String = text.id

    val md: MdView = MdViewFactory.create(SessionEditorStyle.current(), selection)
    private var mode: CopyMode? = null
    private val toolbar = MessageToolbar { copyText() }

    init {
        layout = BorderLayout()
        isOpaque = false
        Disposer.register(this, md)
        md.opaque = !transparent
        md.addLinkListener { onLink(it.href) }
        applyStyle(SessionEditorStyle.current())
        add(md.component, BorderLayout.CENTER)
        add(toolbar, BorderLayout.SOUTH)
        if (text.content.isNotEmpty()) md.set(text.content.toString())
        syncToolbar()
    }

    override fun update(content: Content) {
        if (content !is Text) return
        md.set(content.content.toString())
        syncToolbar()
        refresh()
    }

    override fun appendDelta(delta: String) {
        if (delta.isEmpty()) return
        md.append(delta)
        syncToolbar()
        refresh()
    }

    @RequiresEdt
    fun setCopyToolbar(enabled: Boolean, trim: Boolean = true) {
        mode = if (enabled) CopyMode(trim) else null
        syncToolbar()
    }

    @RequiresEdt
    fun hasCopyToolbar() = toolbar.isVisible

    @RequiresEdt
    fun copyButton(): JButton = toolbar.copyButton()

    @RequiresEdt
    fun copyMarkdown(trim: Boolean = true): String {
        val text = md.markdown()
        return if (trim) text.trim() else text
    }

    /** Current markdown source — used by tests to assert rendered content. */
    fun markdown(): String = md.markdown()

    internal fun simulateLink(href: String) = md.simulateLink(href)

    internal fun contentOpaque() = md.opaque

    protected open fun onLink(href: String) = openUrl(href)

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

    protected open fun styleBackground(style: SessionEditorStyle) = style.editorBackground

    protected fun refresh() {
        revalidate()
        repaint()
    }

    @RequiresEdt
    private fun syncToolbar() {
        toolbar.sync(copyText()?.isNotEmpty() == true)
    }

    @RequiresEdt
    private fun copyText(): String? {
        val item = mode ?: return null
        return copyMarkdown(item.trim)
    }

    override fun dumpLabel() = "TextView#$contentId"

    private data class CopyMode(val trim: Boolean)
}
