package ai.kilocode.client.session.ui

import ai.kilocode.rpc.dto.MessageDto
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.FlowLayout
import javax.swing.BoxLayout
import javax.swing.JPanel
import javax.swing.JTextArea
import javax.swing.border.MatteBorder

/**
 * Scrollable panel displaying chat messages aligned to the top,
 * with an optional animated status indicator at the bottom.
 *
 * Inner panel uses [BoxLayout.Y_AXIS] for stacking, wrapped in a
 * [BorderLayout.NORTH] so messages stay top-aligned when the scroll
 * viewport is taller than the content.
 */
class MessageListPanel : JPanel(BorderLayout()) {

    private val panels = LinkedHashMap<String, MessageBlock>()

    private val inner = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        border = JBUI.Borders.empty(4, 8)
    }

    private val statusLabel = JBLabel().apply {
        foreground = UIUtil.getContextHelpForeground()
    }

    private val status = JPanel(FlowLayout(FlowLayout.LEFT, JBUI.scale(4), 0)).apply {
        isOpaque = false
        isVisible = false
        border = JBUI.Borders.empty(6, 0)
        alignmentX = LEFT_ALIGNMENT
        add(JBLabel(AnimatedIcon.Default()))
        add(statusLabel)
    }

    init {
        isOpaque = true
        background = UIUtil.getPanelBackground()
        inner.add(status)
        add(inner, BorderLayout.NORTH)
    }

    fun addMessage(info: MessageDto) {
        if (panels.containsKey(info.id)) return
        val block = MessageBlock(info)
        panels[info.id] = block
        // Insert before the status row (which is always last)
        inner.add(block, inner.componentCount - 1)
        revalidate()
        repaint()
    }

    fun updatePartText(messageID: String, partID: String, text: String) {
        panels[messageID]?.setText(partID, text)
        revalidate()
        repaint()
    }

    fun appendDelta(messageID: String, partID: String, delta: String) {
        panels[messageID]?.appendDelta(partID, delta)
        revalidate()
        repaint()
    }

    fun removeMessage(messageID: String) {
        val block = panels.remove(messageID) ?: return
        inner.remove(block)
        revalidate()
        repaint()
    }

    fun addError(msg: String) {
        val label = JBLabel(msg).apply {
            foreground = JBColor.RED
            font = JBUI.Fonts.label()
            border = JBUI.Borders.empty(4, 0)
            alignmentX = LEFT_ALIGNMENT
        }
        inner.add(label, inner.componentCount - 1)
        revalidate()
        repaint()
    }

    /**
     * Show or hide the working status indicator at the bottom of the list.
     * Pass null to hide, a string to show with animated spinner.
     */
    fun setStatus(text: String?) {
        if (text != null) {
            statusLabel.text = text
            status.isVisible = true
        } else {
            status.isVisible = false
        }
        revalidate()
        repaint()
    }

    fun clear() {
        panels.clear()
        inner.removeAll()
        // Re-add status row (always last)
        inner.add(status)
        status.isVisible = false
        revalidate()
        repaint()
    }
}

/**
 * A single message block — text content only, no role header.
 * User messages get a thin top border as separator.
 */
private class MessageBlock(info: MessageDto) : JPanel() {
    private val parts = LinkedHashMap<String, JTextArea>()

    init {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        alignmentX = LEFT_ALIGNMENT

        border = if (info.role == "user") {
            JBUI.Borders.compound(
                MatteBorder(1, 0, 0, 0, JBColor.border()),
                JBUI.Borders.empty(8, 0, 4, 0),
            )
        } else {
            JBUI.Borders.empty(4, 0)
        }
    }

    fun setText(partID: String, text: String) {
        val area = parts.getOrPut(partID) { createArea().also { add(it) } }
        area.text = text
        revalidate()
    }

    fun appendDelta(partID: String, delta: String) {
        val area = parts.getOrPut(partID) { createArea().also { add(it) } }
        area.append(delta)
        revalidate()
    }

    private fun createArea() = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        isOpaque = false
        font = JBUI.Fonts.label()
        foreground = UIUtil.getLabelForeground()
        border = JBUI.Borders.empty()
        alignmentX = LEFT_ALIGNMENT
    }
}
