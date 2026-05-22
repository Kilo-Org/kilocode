package ai.kilocode.client.ui

import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.UIManager

open class PickerButton : JBLabel() {
    private var over = false

    init {
        border = pickerBorder()
        background = picker()
        // The custom rounded fill needs parent background around the corners.
        isOpaque = false
        addMouseListener(object : MouseAdapter() {
            override fun mouseEntered(e: MouseEvent) {
                sync(true)
            }

            override fun mouseExited(e: MouseEvent) {
                sync(false)
            }
        })
    }

    override fun updateUI() {
        super.updateUI()
        border = pickerBorder()
        background = picker()
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = if (isEnabled && over) JBUI.CurrentTheme.ActionButton.hoverBackground() else picker()
            val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
            g2.fillRoundRect(0, 0, width, height, arc, arc)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    private fun sync(value: Boolean) {
        if (over == value) return
        over = value
        repaint()
    }

    private fun picker() = JBColor.lazy {
        UIManager.getColor("ComboBoxButton.background")
            ?: UIManager.getColor("ComboBox.nonEditableBackground")
            ?: UIUtil.getPanelBackground()
    }

    private fun pickerBorder() = JBUI.Borders.empty(UiStyle.Gap.xs(), UiStyle.Gap.lg())
}
