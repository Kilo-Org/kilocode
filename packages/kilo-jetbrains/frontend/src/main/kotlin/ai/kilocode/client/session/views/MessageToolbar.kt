package ai.kilocode.client.session.views

import ai.kilocode.client.session.ui.selection.SessionCopyButton
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.BorderLayout
import java.awt.Graphics
import javax.swing.JPanel

internal class MessageToolbar(
    private val align: String = BorderLayout.LINE_START,
    private val text: () -> String?,
) : JPanel(BorderLayout()) {
    private val copy = SessionCopyButton(text = text)
    private val button = copy.button

    init {
        isOpaque = false
        add(button, align)
    }

    @RequiresEdt
    fun sync(value: Boolean) {
        if (isVisible == value && button.isEnabled == value) return
        isVisible = value
        button.isEnabled = value
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun paint(value: Boolean) {
        // Prompt toolbars stay visible to reserve layout space while their button is visually hidden.
        if (!isVisible) isVisible = true
        if (button.isEnabled == value) return
        button.isEnabled = value
        repaint()
    }

    @RequiresEdt
    fun paints() = button.isEnabled

    @RequiresEdt
    fun alignment() = align

    @RequiresEdt
    fun copyButton() = button

    override fun removeNotify() {
        copy.dismiss()
        super.removeNotify()
    }

    override fun paintComponent(g: Graphics) {
        if (!button.isEnabled) return
        super.paintComponent(g)
    }

    override fun paintChildren(g: Graphics) {
        if (!button.isEnabled) return
        super.paintChildren(g)
    }
}
