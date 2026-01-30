package ai.kilo.plugin.toolwindow.components

import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JPanel

/**
 * Error banner displayed below the header when there's an error.
 * Shows the error message with Retry and Dismiss buttons.
 */
class ErrorBanner(
    private val onRetry: () -> Unit,
    private val onDismiss: () -> Unit
) : JPanel(BorderLayout()) {

    private val messageLabel = JBLabel()
    private val retryButton: JButton
    private val dismissButton: JButton

    init {
        isOpaque = true
        background = KiloTheme.surfaceCriticalWeak
        border = JBUI.Borders.compound(
            JBUI.Borders.customLine(KiloTheme.borderCritical, 0, 0, 1, 0),
            JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
        )
        isVisible = false // Hidden by default

        // Icon and message
        val contentPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.md, 0)).apply {
            isOpaque = false
        }

        val icon = JBLabel(AllIcons.General.Error)
        contentPanel.add(icon)

        messageLabel.foreground = KiloTheme.textCritical
        messageLabel.font = messageLabel.font.deriveFont(KiloTypography.fontSizeSmall)
        contentPanel.add(messageLabel)

        add(contentPanel, BorderLayout.CENTER)

        // Buttons
        val buttonsPanel = JPanel(FlowLayout(FlowLayout.RIGHT, KiloSpacing.xs, 0)).apply {
            isOpaque = false
        }

        retryButton = JButton("Retry").apply {
            isFocusable = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            background = KiloTheme.buttonSecondaryBg
            foreground = KiloTheme.buttonSecondaryFg
            addActionListener { onRetry() }
        }
        buttonsPanel.add(retryButton)

        dismissButton = JButton(AllIcons.Actions.Close).apply {
            isFocusable = false
            isContentAreaFilled = false
            isBorderPainted = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            toolTipText = "Dismiss"
            addActionListener { onDismiss() }

            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    isContentAreaFilled = true
                    background = KiloTheme.buttonGhostHover
                }
                override fun mouseExited(e: MouseEvent) {
                    isContentAreaFilled = false
                }
            })
        }
        buttonsPanel.add(dismissButton)

        add(buttonsPanel, BorderLayout.EAST)
    }

    /**
     * Set the error message to display.
     * Pass null to hide the banner.
     */
    fun setError(error: String?) {
        if (error.isNullOrBlank()) {
            isVisible = false
        } else {
            messageLabel.text = truncateError(error)
            messageLabel.toolTipText = error // Full error on hover
            isVisible = true
        }
        revalidate()
        repaint()
    }

    private fun truncateError(error: String): String {
        val maxLength = 100
        return if (error.length > maxLength) {
            error.take(maxLength) + "..."
        } else {
            error
        }
    }
}
