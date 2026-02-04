package ai.kilo.plugin.toolwindow.components.header

import ai.kilo.plugin.model.Session
import ai.kilo.plugin.model.SessionStatus
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.services.KiloEventService
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.JBLabel
import com.intellij.util.IconUtil
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.awt.Color
import java.awt.FlowLayout
import java.awt.Font
import javax.swing.JPanel

class ChatHeaderPanel(
    private val scope: CoroutineScope,
    private val appState: KiloAppState
) : BorderLayoutPanel() {

    private val titleLabel = JBLabel()
    private val statusLabel = JBLabel()
    private val connectionIndicator = JBLabel()

    init {
        border = JBUI.Borders.compound(
            JBUI.Borders.customLine(KiloTheme.borderWeak, 0, 0, 1, 0),
            JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
        )
        background = KiloTheme.backgroundStronger
        isOpaque = true

        val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, 0)).apply {
            isOpaque = false
        }

        connectionIndicator.text = "●"
        connectionIndicator.font = connectionIndicator.font.deriveFont(KiloTypography.fontSizeXSmall)
        connectionIndicator.toolTipText = "Connection status"
        leftPanel.add(connectionIndicator)

        titleLabel.font = titleLabel.font.deriveFont(Font.BOLD, KiloTypography.fontSizeMedium)
        titleLabel.foreground = KiloTheme.textStrong
        leftPanel.add(titleLabel)

        addToCenter(leftPanel)

        statusLabel.foreground = KiloTheme.textWeak
        statusLabel.font = statusLabel.font.deriveFont(KiloTypography.fontSizeBase)
        addToRight(statusLabel)

        subscribeToConnectionStatus()
    }

    private fun subscribeToConnectionStatus() {
        scope.launch {
            appState.connectionStatus.collectLatest { status ->
                updateConnectionIndicator(status)
            }
        }
    }

    private fun updateConnectionIndicator(status: KiloEventService.ConnectionStatus) {
        when (status) {
            KiloEventService.ConnectionStatus.CONNECTED -> {
                connectionIndicator.foreground = KiloTheme.iconSuccessActive
                connectionIndicator.toolTipText = "Connected"
            }
            KiloEventService.ConnectionStatus.DISCONNECTED -> {
                connectionIndicator.foreground = KiloTheme.iconCritical
                connectionIndicator.toolTipText = "Disconnected"
            }
            KiloEventService.ConnectionStatus.RECONNECTING -> {
                connectionIndicator.foreground = KiloTheme.iconWarningActive
                connectionIndicator.toolTipText = "Reconnecting..."
            }
            KiloEventService.ConnectionStatus.ERROR -> {
                connectionIndicator.foreground = KiloTheme.iconCritical
                connectionIndicator.toolTipText = "Connection error"
            }
        }
    }

    fun updateSession(session: Session?) {
        titleLabel.text = session?.title?.ifBlank { "Untitled" } ?: ""
        titleLabel.icon = if (session != null) AllIcons.General.Balloon else null
    }

    private val lightBlue = Color(100, 181, 246)
    private val spinnerIcon = AnimatedIcon(
        125,
        IconUtil.colorize(AllIcons.Process.Step_1, lightBlue),
        IconUtil.colorize(AllIcons.Process.Step_2, lightBlue),
        IconUtil.colorize(AllIcons.Process.Step_3, lightBlue),
        IconUtil.colorize(AllIcons.Process.Step_4, lightBlue),
        IconUtil.colorize(AllIcons.Process.Step_5, lightBlue),
        IconUtil.colorize(AllIcons.Process.Step_6, lightBlue),
        IconUtil.colorize(AllIcons.Process.Step_7, lightBlue),
        IconUtil.colorize(AllIcons.Process.Step_8, lightBlue)
    )

    fun updateStatus(status: SessionStatus?) {
        when (status?.type) {
            "busy" -> {
                statusLabel.icon = spinnerIcon
                statusLabel.text = ""
            }
            "retry" -> {
                statusLabel.icon = spinnerIcon
                statusLabel.foreground = lightBlue
                statusLabel.text = "Retrying (${status.attempt ?: 0})..."
            }
            else -> {
                statusLabel.icon = null
                statusLabel.foreground = KiloTheme.textWeak
                statusLabel.text = ""
            }
        }
    }
}
