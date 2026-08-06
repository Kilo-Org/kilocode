package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionFileLinks
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.openSessionLink
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionCopyTarget
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.BorderLayout
import javax.swing.JButton
import javax.swing.JComponent

/**
 * Renders a [Text] part as markdown using [MdView].
 *
 * Supports both full-replacement ([update]) and streaming append ([appendDelta]).
 */
open class TextView(
    text: Text,
    transparent: Boolean = true,
    private val openFile: SessionFileOpener = { _, _ -> },
    private val openUrl: (String) -> Unit = {},
    selection: SessionSelection? = null,
) : PartView(), SessionCopyTarget {

    override val contentId: String = text.id

    val md: MdView = MdViewFactory.create(SessionEditorStyle.current(), selection)
    private var mode: CopyMode? = null
    private val toolbar = MessageToolbar(
        text = { copyText() },
        tooltip = KiloBundle.message("session.copy.response"),
    )
    private val placeholder = toolbar.placeholder()

    override val copyEligible: Boolean get() = hasCopyToolbar()

    override val copyAnchor: JComponent get() = placeholder

    override val copyToolbar: JComponent? get() = toolbar.takeIf { hasCopyToolbar() }

    init {
        layout = BorderLayout()
        isOpaque = false
        Disposer.register(this, md)
        md.opaque = !transparent
        md.addLinkListener { onLink(it) }
        applyStyle(SessionEditorStyle.current())
        add(md.component, BorderLayout.CENTER)
        add(placeholder, BorderLayout.SOUTH)
        if (text.content.isNotEmpty()) md.set(text.content.toString())
        syncContent()
        syncToolbar()
    }

    override fun update(content: Content) {
        if (content !is Text) return
        md.set(content.content.toString())
        syncContent()
        syncToolbar()
        refresh()
    }

    override fun appendDelta(delta: String) {
        if (delta.isEmpty()) return
        md.append(delta)
        syncContent()
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

    protected open fun onLink(event: MdView.LinkEvent) {
        openSessionLink(event, openFile, openUrl)
    }

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
    private fun syncContent() {
        md.component.isVisible = md.markdown().isNotBlank()
    }

    @RequiresEdt
    private fun syncToolbar() {
        val on = copyText()?.isNotEmpty() == true
        toolbar.sync(on)
        if (placeholder.isVisible == on) return
        placeholder.isVisible = on
        refresh()
    }

    @RequiresEdt
    override fun copyText(): String? {
        val item = mode ?: return null
        return copyMarkdown(item.trim)
    }

    override fun dumpLabel() = "TextView#$contentId"

    private data class CopyMode(val trim: Boolean)
}
