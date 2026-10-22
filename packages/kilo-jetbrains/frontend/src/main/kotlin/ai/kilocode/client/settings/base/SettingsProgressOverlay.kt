package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.JButton
import javax.swing.JPanel

internal class SettingsProgressOverlay : JPanel(BorderLayout(UiStyle.Gap.md(), 0)) {
    private enum class Kind { INFO, ERROR }

    private var label: JBLabel? = null
    private var cancel: JButton? = null
    private var kind: Kind? = null

    init {
        val view = JBLabel()
        val button = JButton()
        label = view
        cancel = button
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.lg(), UiStyle.Gap.pad(), UiStyle.Gap.lg(), UiStyle.Gap.pad())
        add(view, BorderLayout.CENTER)
        add(button, BorderLayout.EAST)
        button.isVisible = false
        isVisible = false
        syncColors()
        UiStyle.Components.actionButton(button)
    }

    fun showProgress(text: String) {
        show(text, Kind.INFO, null, null)
    }

    fun showProgress(text: String, cancelText: String, cancel: () -> Unit) {
        show(text, Kind.INFO, cancelText, cancel)
    }

    fun showError(text: String) {
        show(text, Kind.ERROR, null, null)
    }

    fun updateProgress(text: String) {
        val view = requireNotNull(label)
        if (view.text != text) view.text = text
        revalidate()
        repaint()
    }

    private fun show(text: String, next: Kind, cancelText: String?, action: (() -> Unit)?) {
        if (kind != next) {
            kind = next
            syncColors()
        }
        updateProgress(text)
        syncCancel(cancelText, action)
        if (!isVisible) isVisible = true
        revalidate()
        repaint()
    }

    private fun syncCancel(text: String?, action: (() -> Unit)?) {
        val button = requireNotNull(cancel)
        button.actionListeners.toList().forEach { button.removeActionListener(it) }
        if (text == null || action == null) {
            button.text = ""
            button.isVisible = false
            return
        }
        button.text = text
        button.addActionListener { action() }
        UiStyle.Components.actionButton(button)
        button.isVisible = true
    }

    fun clearProgress() {
        val view = requireNotNull(label)
        if (!isVisible && view.text.isNullOrBlank()) return
        view.text = ""
        syncCancel(null, null)
        isVisible = false
        revalidate()
        repaint()
    }

    override fun updateUI() {
        super.updateUI()
        syncColors()
        cancel?.let { UiStyle.Components.actionButton(it) }
    }

    private fun syncColors() {
        val current = kind ?: Kind.INFO
        background = when (current) {
            Kind.INFO -> UiStyle.Colors.infoOverlayBackground()
            Kind.ERROR -> UiStyle.Colors.errorOverlayBackground()
        }
        foreground = when (current) {
            Kind.INFO -> UiStyle.Colors.infoOverlayForeground()
            Kind.ERROR -> UiStyle.Colors.errorOverlayForeground()
        }
        label?.foreground = foreground
    }

    private fun borderColor() = when (kind ?: Kind.INFO) {
        Kind.INFO -> UiStyle.Colors.infoOverlayBorder()
        Kind.ERROR -> UiStyle.Colors.errorOverlayBorder()
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val arc = UiStyle.Arc.component()
            g2.color = background
            g2.fillRoundRect(0, 0, width, height, arc, arc)
            g2.color = borderColor()
            g2.drawRoundRect(0, 0, width - 1, height - 1, arc, arc)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }
}
