package ai.kilo.plugin.ui.components.header

import ai.kilo.plugin.model.Session
import ai.kilo.plugin.model.SessionStatus
import ai.kilo.plugin.model.TokenUsage
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.services.KiloCliDiscovery
import ai.kilo.plugin.services.KiloServerService
import ai.kilo.plugin.api.KiloEventService
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.JBLabel
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.IconUtil
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.*
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JPanel

class ChatHeaderPanel(
    private val project: Project,
    private val scope: CoroutineScope,
    private val appState: KiloAppState
) : JPanel() {

    private val titleLabel = JBLabel()
    private val statusLabel = JBLabel()
    private val expandIcon = JBLabel(AllIcons.General.ArrowRight)

    private var isExpanded = false
    private var currentSession: Session? = null
    private var currentStatus: SessionStatus? = null
    private var currentConnectionStatus: KiloEventService.ConnectionStatus = KiloEventService.ConnectionStatus.DISCONNECTED
    private var currentTokenUsage: TokenUsage? = null
    private var currentContextLimit: Int? = null
    private val headerRow: JPanel
    private val detailsPanel: JPanel

    init {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        background = KiloTheme.surfaceInsetBase
        isOpaque = true

        // Header row (always visible, clickable)
        headerRow = createHeaderRow()
        add(headerRow)

        // Details panel (collapsible)
        detailsPanel = createDetailsPanel()
        detailsPanel.isVisible = false
        add(detailsPanel)

        subscribeToConnectionStatus()
    }

    private fun createHeaderRow(): JPanel {
        val panel = BorderLayoutPanel().apply {
            border = JBUI.Borders.compound(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 1, 0, 1, 0),
                JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
            )
            background = KiloTheme.surfaceInsetBase
            isOpaque = true
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }

        val leftPanel = JPanel(FlowLayout(FlowLayout.LEFT, KiloSpacing.xs, 0)).apply {
            isOpaque = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }

        // Expand icon
        expandIcon.toolTipText = "Click to expand session details"
        expandIcon.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        leftPanel.add(expandIcon)

        titleLabel.font = titleLabel.font.deriveFont(Font.BOLD, KiloTypography.fontSizeMedium)
        titleLabel.foreground = KiloTheme.textStrong
        titleLabel.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        leftPanel.add(titleLabel)

        panel.addToCenter(leftPanel)

        statusLabel.foreground = KiloTheme.textWeak
        statusLabel.font = statusLabel.font.deriveFont(KiloTypography.fontSizeBase)
        statusLabel.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        panel.addToRight(statusLabel)

        // Shared mouse listener for click handling (expands header details)
        val clickListener = object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (currentSession != null) {
                    toggleExpanded()
                }
            }
        }

        // Status indicator click listener (shows server info)
        val statusClickListener = object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                e.consume()
                showServerInfo()
            }
        }

        // Add click listeners to components
        panel.addMouseListener(clickListener)
        leftPanel.addMouseListener(clickListener)
        expandIcon.addMouseListener(clickListener)
        titleLabel.addMouseListener(clickListener)
        statusLabel.addMouseListener(statusClickListener)

        return panel
    }

    private fun createDetailsPanel(): JPanel {
        return JPanel(GridBagLayout()).apply {
            background = KiloTheme.surfaceInsetBase
            isOpaque = true
            border = JBUI.Borders.compound(
                JBUI.Borders.customLine(KiloTheme.borderWeak, 0, 0, 1, 0),
                JBUI.Borders.empty(KiloSpacing.sm, KiloSpacing.lg, KiloSpacing.md, KiloSpacing.lg)
            )
        }
    }

    private var detailsRowIndex = 0

    private fun toggleExpanded() {
        isExpanded = !isExpanded
        expandIcon.icon = if (isExpanded) AllIcons.General.ArrowDown else AllIcons.General.ArrowRight
        detailsPanel.isVisible = isExpanded

        // Update header border - no bottom border when expanded (details panel provides it)
        headerRow.border = JBUI.Borders.compound(
            JBUI.Borders.customLine(KiloTheme.borderWeak, 1, 0, if (isExpanded) 0 else 1, 0),
            JBUI.Borders.empty(KiloSpacing.md, KiloSpacing.lg)
        )

        revalidate()
        repaint()
    }

    private fun subscribeToConnectionStatus() {
        scope.launch {
            appState.connectionStatus.collectLatest { status ->
                updateConnectionIndicator(status)
            }
        }
    }

    private fun showServerInfo() {
        val serverService = KiloServerService.getInstance(project)

        scope.launch {
            val health = serverService.checkHealth()
            val cliBinary = KiloCliDiscovery.findBinary(project.basePath)

            withContext(Dispatchers.Main) {
                ServerInfoDialog(
                    baseUrl = serverService.baseUrl,
                    isRunning = serverService.isServerRunning,
                    version = health?.version,
                    healthy = health?.healthy,
                    cliBinary = cliBinary,
                    projectPath = project.basePath
                ).show()
            }
        }
    }

    private fun updateConnectionIndicator(status: KiloEventService.ConnectionStatus) {
        currentConnectionStatus = status
        updateRightIndicator()
    }

    fun updateSession(session: Session?) {
        currentSession = session
        titleLabel.text = session?.title?.ifBlank { "Untitled" } ?: "New task"
        titleLabel.icon = AllIcons.General.Balloon

        // Update expand icon visibility
        expandIcon.isVisible = session != null

        // Collapse if no session
        if (session == null && isExpanded) {
            toggleExpanded()
        }

        // Clear token usage when session changes
        if (session == null) {
            currentTokenUsage = null
            currentContextLimit = null
        }

        // Update details panel content
        updateDetailsContent(session)
    }

    fun updateTokenUsage(tokenUsage: TokenUsage?, contextLimit: Int?) {
        currentTokenUsage = tokenUsage
        currentContextLimit = contextLimit
        // Refresh details panel if expanded
        if (isExpanded) {
            updateDetailsContent(currentSession)
        }
    }

    private fun formatNumber(number: Int): String {
        return when {
            number >= 1_000_000 -> String.format("%.1fM", number / 1_000_000.0)
            number >= 1_000 -> String.format("%.1fK", number / 1_000.0)
            else -> number.toString()
        }
    }

    private fun updateDetailsContent(session: Session?) {
        detailsPanel.removeAll()
        detailsRowIndex = 0

        if (session == null) return

        // Summary (code changes) - only show if there are actual changes
        session.summary?.let { summary ->
            if (summary.additions > 0 || summary.deletions > 0 || summary.files > 0) {
                val changesText = buildString {
                    append("+${summary.additions} -${summary.deletions}")
                    if (summary.files > 0) {
                        append(" (${summary.files} file${if (summary.files > 1) "s" else ""})")
                    }
                }
                addDetailRow("Changes", changesText)
            }
        }

        // Share URL
        session.share?.let { share ->
            addDetailRow("Shared", share.url)
        }

        // Token usage (only show if there's actual data)
        currentTokenUsage?.let { tokens ->
            val totalTokens = tokens.input + tokens.output + tokens.reasoning
            if (totalTokens > 0) {
                addDetailRow("Tokens", formatNumber(totalTokens))

                // Context progress if limit is known
                currentContextLimit?.let { limit ->
                    if (limit > 0) {
                        val percentage = (totalTokens.toDouble() / limit * 100).toInt()
                        addDetailRow("Context", "$percentage% of ${formatNumber(limit)}")
                    }
                }
            }
        }

        // Add filler to push content to top-left
        val filler = GridBagConstraints().apply {
            gridx = 2
            gridy = detailsRowIndex
            weightx = 1.0
            weighty = 1.0
            fill = GridBagConstraints.BOTH
        }
        detailsPanel.add(JPanel().apply { isOpaque = false }, filler)

        detailsPanel.revalidate()
        detailsPanel.repaint()
    }

    private fun addDetailRow(label: String, value: String) {
        val labelConstraints = GridBagConstraints().apply {
            gridx = 0
            gridy = detailsRowIndex
            anchor = GridBagConstraints.WEST
            insets = Insets(2, 0, 2, KiloSpacing.sm)
        }

        val labelComponent = JBLabel("$label:").apply {
            foreground = KiloTheme.textWeak
            font = font.deriveFont(KiloTypography.fontSizeSmall)
        }
        detailsPanel.add(labelComponent, labelConstraints)

        val valueConstraints = GridBagConstraints().apply {
            gridx = 1
            gridy = detailsRowIndex
            anchor = GridBagConstraints.WEST
            insets = Insets(2, 0, 2, 0)
        }

        val valueComponent = JBLabel(value).apply {
            foreground = KiloTheme.textBase
            font = font.deriveFont(KiloTypography.fontSizeSmall)
        }
        detailsPanel.add(valueComponent, valueConstraints)

        detailsRowIndex++
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
        currentStatus = status
        updateRightIndicator()
    }

    private fun updateRightIndicator() {
        when (currentStatus?.type) {
            "busy" -> {
                statusLabel.icon = spinnerIcon
                statusLabel.text = ""
                statusLabel.foreground = KiloTheme.textWeak
            }
            "retry" -> {
                statusLabel.icon = spinnerIcon
                statusLabel.foreground = lightBlue
                statusLabel.text = "Retrying (${currentStatus?.attempt ?: 0})..."
            }
            else -> {
                // Show connection indicator when not busy
                statusLabel.icon = null
                statusLabel.text = "●"
                statusLabel.font = statusLabel.font.deriveFont(KiloTypography.fontSizeSmall)
                when (currentConnectionStatus) {
                    KiloEventService.ConnectionStatus.CONNECTED -> {
                        statusLabel.foreground = KiloTheme.iconSuccessActive
                        statusLabel.toolTipText = "Connected"
                    }
                    KiloEventService.ConnectionStatus.DISCONNECTED -> {
                        statusLabel.foreground = KiloTheme.iconCritical
                        statusLabel.toolTipText = "Disconnected"
                    }
                    KiloEventService.ConnectionStatus.RECONNECTING -> {
                        statusLabel.foreground = KiloTheme.iconWarningActive
                        statusLabel.toolTipText = "Reconnecting..."
                    }
                    KiloEventService.ConnectionStatus.ERROR -> {
                        statusLabel.foreground = KiloTheme.iconCritical
                        statusLabel.toolTipText = "Connection error"
                    }
                }
            }
        }
    }
}

private class ServerInfoDialog(
    private val baseUrl: String,
    private val isRunning: Boolean,
    private val version: String?,
    private val healthy: Boolean?,
    private val cliBinary: String?,
    private val projectPath: String?
) : DialogWrapper(true) {

    init {
        title = "Kilo Server Info"
        setOKButtonText("Close")
        init()
    }

    override fun createCenterPanel(): JComponent {
        return panel {
            row("Status:") {
                cell(JBLabel(if (isRunning) "Running" else "Stopped").apply {
                    foreground = if (isRunning) JBUI.CurrentTheme.Focus.focusColor() else JBUI.CurrentTheme.Label.disabledForeground()
                })
            }
            row("Health:") {
                cell(JBLabel(when (healthy) {
                    true -> "Healthy"
                    false -> "Unhealthy"
                    null -> "Unknown"
                }))
            }
            row("Version:") {
                cell(JBLabel(version ?: "Unknown"))
            }
            separator()
            row("Server URL:") {
                cell(JBLabel(baseUrl))
            }
            row("CLI Binary:") {
                cell(JBLabel(cliBinary ?: "Not found"))
            }
            row("Project:") {
                cell(JBLabel(projectPath ?: "Unknown"))
            }
        }.apply {
            border = JBUI.Borders.empty(10)
        }
    }

    override fun createActions() = arrayOf(okAction)
}
