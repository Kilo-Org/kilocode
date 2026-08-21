package ai.kilocode.client.ui

import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupListener
import com.intellij.openapi.ui.popup.LightweightWindowEvent
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent

open class PickerButton : JBLabel() {
    private var over = false

    var onPickClose: () -> Unit = {}

    /**
     * Idle (unhovered) fill. Defaults to the standard picker surface; set to `null` to paint
     * nothing so the picker blends into its container (e.g. the prompt background). The hover
     * fill is unaffected.
     */
    var idleFill: Color? = UiStyle.Colors.picker()

    init {
        border = pickerBorder()
        background = UiStyle.Colors.picker()
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
        background = UiStyle.Colors.picker()
    }

    override fun paintComponent(g: Graphics) {
        val fill = if (isEnabled && over) JBUI.CurrentTheme.ActionButton.hoverBackground() else idleFill
        if (fill != null) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.color = fill
                val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
                g2.fillRoundRect(0, 0, width, height, arc, arc)
            } finally {
                g2.dispose()
            }
        }
        super.paintComponent(g)
    }

    private fun sync(value: Boolean) {
        if (over == value) return
        over = value
        repaint()
    }

    protected fun restoreFocusOnPick(popup: JBPopup) {
        popup.addListener(object : JBPopupListener {
            override fun onClosed(event: LightweightWindowEvent) = pickClosed(event.isOk)
        })
    }

    /** Popup close handler: [ok] is true only when a value was chosen (not on cancel/escape). */
    internal fun pickClosed(ok: Boolean) {
        if (ok) onPickClose()
    }

    private fun pickerBorder() = JBUI.Borders.empty(UiStyle.Gap.xs(), UiStyle.Gap.lg())
}
