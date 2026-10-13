package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Notice
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.JPanel

/**
 * Renders a [Notice] as a small informational row in the transcript.
 *
 * Used for things the user should know about that are not an error on the turn, such as an
 * attachment the server could not read. The copy is a bundled, user-facing sentence keyed by the
 * notice kind; the raw server text (which is addressed to the model) is intentionally not shown.
 *
 * An accented block rather than a full card, matching [MessageErrorView].
 */
class NoticeView(private val notice: Notice) : PartView() {

    override val contentId: String = notice.id

    private val body = NoticeText()

    init {
        isOpaque = false
        layout = BorderLayout()
        add(body, BorderLayout.CENTER)
        applyStyle(SessionEditorStyle.current())
        setText(text(notice))
    }

    override fun update(content: Content) {
        if (content is Notice) setText(text(content))
    }

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        body.textFont = style.transcriptFont
        revalidate()
        repaint()
    }

    /** Re-resolved here so the accent survives a Look and Feel switch. */
    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.customLineLeft(UiStyle.Colors.warningLabelForeground())
    }

    override fun dumpLabel() = "NoticeView#$contentId"

    /** Exposed for tests. */
    internal fun text(): String = body.text

    private fun setText(value: String) {
        if (body.text == value) return
        body.text = value
        revalidate()
        repaint()
    }

    private fun text(notice: Notice) = when (notice.kind) {
        ATTACHMENT_READ_FAILED -> notice.name
            ?.let { KiloBundle.message("session.notice.attachment.read.failed", it) }
            ?: KiloBundle.message("session.notice.attachment.read.failed.unknown")
        else -> notice.kind
    }

    private companion object {
        const val ATTACHMENT_READ_FAILED = "attachment_read_failed"
    }
}

/**
 * Selectable, wrapping notice text over the raised editor surface, led by a warning glyph.
 *
 * Owns its own theme values: assigning them from the parent's `init` would not survive a Look and
 * Feel switch, and re-applying them in the parent's `updateUI` would run before these fields exist.
 */
private class NoticeText : JPanel(BorderLayout()) {

    private val icon = NoticeIcon()
    private val label = WrapArea()

    var text: String
        get() = label.text
        set(value) {
            label.text = value
        }

    var textFont: java.awt.Font
        get() = label.font
        set(value) {
            label.font = value
            icon.font = value
        }

    init {
        isOpaque = true
        add(icon, BorderLayout.WEST)
        add(label, BorderLayout.CENTER)
    }

    override fun updateUI() {
        super.updateUI()
        background = SessionUiStyle.Colors.codeBlockBackground()
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
        )
    }
}

/** Warning glyph with the trailing gap owned here so it survives a Look and Feel switch. */
private class NoticeIcon : JBLabel(AllIcons.General.Warning) {
    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.emptyRight(UiStyle.Gap.sm())
    }
}

/** Non-editable, wrapping text area sized to the width it will be painted at. */
private class WrapArea : JBTextArea() {
    init {
        isEditable = false
        isFocusable = false
        isOpaque = false
        caret.isVisible = false
        caret.isSelectionVisible = true
        lineWrap = true
        wrapStyleWord = true
        border = null
    }

    override fun updateUI() {
        super.updateUI()
        foreground = SessionUiStyle.Text.Secondary.foreground()
    }

    override fun getPreferredSize(): Dimension {
        val width = space()
        if (width <= 0) return super.getPreferredSize()
        val old = size
        setSize(width, Int.MAX_VALUE)
        val height = super.getPreferredSize().height
        setSize(old)
        return Dimension(width, height)
    }

    private fun space(): Int {
        var node = parent
        while (node != null) {
            if (node.width > 0) {
                val ins = node.insets
                return (node.width - ins.left - ins.right).coerceAtLeast(0)
            }
            node = node.parent
        }
        return width
    }
}
