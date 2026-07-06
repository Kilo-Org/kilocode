package ai.kilocode.client.session.views

import ai.kilocode.client.session.ui.selection.SessionCopyButton
import ai.kilocode.client.session.ui.selection.SessionRevertButton
import ai.kilocode.client.ui.layout.Stack
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.BorderLayout
import java.awt.Graphics
import javax.swing.JComponent
import javax.swing.JPanel

internal class MessageToolbar(
    private val align: String = BorderLayout.LINE_START,
    revert: (() -> Unit)? = null,
    private val text: () -> String?,
) : JPanel(BorderLayout()) {
    private val copy = SessionCopyButton(text = text)
    private val rev = revert?.let { SessionRevertButton(it) }
    private val row: JComponent = rev?.let { item ->
        Stack.horizontal()
            .next(copy.button)
            .next(item.button)
    } ?: copy.button

    init {
        isOpaque = false
        add(row, align)
    }

    @RequiresEdt
    fun sync(value: Boolean) {
        if (isVisible == value && row.isEnabled == value) return
        isVisible = value
        row.isEnabled = value
        copy.button.isEnabled = value
        rev?.enabled(value)
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun paint(value: Boolean) {
        // Prompt toolbars stay visible to reserve layout space while their button is visually hidden.
        if (!isVisible) isVisible = true
        if (row.isEnabled == value) return
        row.isEnabled = value
        copy.button.isEnabled = value
        rev?.enabled(value)
        repaint()
    }

    @RequiresEdt
    fun setRevertEnabled(value: Boolean) {
        rev?.enabled(value)
    }

    @RequiresEdt
    fun setRevertVisible(value: Boolean) {
        val button = rev?.button ?: return
        if (button.isVisible == value) return
        button.isVisible = value
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun paints() = row.isEnabled

    @RequiresEdt
    fun alignment() = align

    @RequiresEdt
    fun copyButton() = copy.button

    override fun removeNotify() {
        copy.dismiss()
        super.removeNotify()
    }

    override fun paintComponent(g: Graphics) {
        if (!row.isEnabled) return
        super.paintComponent(g)
    }

    override fun paintChildren(g: Graphics) {
        if (!row.isEnabled) return
        super.paintChildren(g)
    }
}
