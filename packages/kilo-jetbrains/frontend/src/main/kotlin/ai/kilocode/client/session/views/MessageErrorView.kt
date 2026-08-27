package ai.kilocode.client.session.views

import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.MessageErrorDto
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JPanel

/**
 * What a failure reads as in the transcript, or null when there is nothing to show.
 *
 * Null for a Stop: an aborted turn is a deliberate user action that the footer already reports as
 * "Stopped", and the TUI skips it the same way. Shared with the transcript panel so it can compare
 * against the text the outcome card is already showing.
 */
internal fun failureText(error: MessageErrorDto?): String? {
    if (error == null) return null
    if (error.aborted) return null
    return error.message?.trim()?.takeIf { it.isNotEmpty() } ?: error.type
}

/**
 * The failure a turn ended with, rendered on the message that carries it.
 *
 * The footer outcome card is bound to live session state, so it is gone as soon as the next turn
 * starts and it never comes back for an older turn. This card is the durable record: a turn that died
 * mid-session still explains itself in scrollback and after a reload, which is what the TUI and the
 * VS Code webview already do.
 *
 * An accented block rather than a full card: there is nothing to expand, and the text is the point.
 */
class MessageErrorView : JPanel(BorderLayout()), SessionEditorStyleTarget, SessionView {

    override val sessionViewKind = SessionView.Kind.Default

    private val body = ErrorText()

    init {
        // Containers stay transparent over the session backdrop; [ErrorText] is the raised surface.
        isOpaque = false
        add(body, BorderLayout.CENTER)
        applyStyle(SessionEditorStyle.current())
    }

    /** Returns true when the text changed, so callers only relayout on a real change. */
    @RequiresEdt
    fun setText(value: String): Boolean {
        if (body.text == value) return false
        body.text = value
        body.caretPosition = 0
        revalidate()
        repaint()
        return true
    }

    @RequiresEdt
    fun text(): String = body.text

    @RequiresEdt
    override fun applyStyle(style: SessionEditorStyle) {
        body.font = style.transcriptFont
        revalidate()
        repaint()
    }

    /** Re-resolved here so the accent survives a Look and Feel switch. */
    override fun updateUI() {
        super.updateUI()
        border = JBUI.Borders.customLineLeft(UiStyle.Colors.errorLabelForeground())
    }
}

/**
 * Selectable, wrapping error text over the raised editor surface.
 *
 * Owns its own theme values: assigning them from the parent's `init` would not survive a Look and Feel
 * switch, and re-applying them in the parent's `updateUI` would run before this field exists.
 */
private class ErrorText : JBTextArea() {
    init {
        isEditable = false
        isFocusable = false
        caret.isVisible = false
        caret.isSelectionVisible = true
        lineWrap = true
        wrapStyleWord = true
    }

    override fun updateUI() {
        super.updateUI()
        foreground = UiStyle.Colors.errorLabelForeground()
        background = SessionUiStyle.Colors.codeBlockBackground()
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
        )
    }
}
