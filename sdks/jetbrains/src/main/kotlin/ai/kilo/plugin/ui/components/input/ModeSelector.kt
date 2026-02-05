package ai.kilo.plugin.ui.components.input

import ai.kilo.plugin.model.Agent
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.ui.KiloTheme
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JLabel
import javax.swing.JMenuItem
import javax.swing.JPanel
import javax.swing.JPopupMenu

class ModeSelector(
    private val scope: CoroutineScope,
    private val appState: KiloAppState
) : JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)) {

    private var agents: List<Agent> = emptyList()
    private var selectedAgent: Agent? = null
    private val modeLabel = JBLabel("Agent ▾").apply {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(13f)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    init {
        isOpaque = false
        add(modeLabel)

        modeLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                showModePopup()
            }
            override fun mouseEntered(e: MouseEvent) {
                modeLabel.foreground = KiloTheme.textInteractive
            }
            override fun mouseExited(e: MouseEvent) {
                modeLabel.foreground = KiloTheme.textWeak
            }
        })

        subscribeToAgents()
    }

    private fun subscribeToAgents() {
        scope.launch {
            appState.agents.collectLatest { agentList ->
                // Filter out hidden agents and subagents (subagents are only for internal use)
                agents = agentList.filter { it.hidden != true && it.mode != "subagent" }

                // Set default if not selected (server returns agents sorted with default first)
                if (selectedAgent == null && agents.isNotEmpty()) {
                    selectedAgent = agents.first()
                    appState.setSelectedAgent(selectedAgent?.name)
                    updateLabel()
                }
            }
        }
    }

    private fun updateLabel() {
        val displayName = selectedAgent?.name?.replaceFirstChar { it.uppercase() } ?: "Agent"
        modeLabel.text = "$displayName ▾"
    }

    private fun showModePopup() {
        if (agents.isEmpty()) return

        val popup = JPopupMenu().apply {
            add(JLabel("  Agent").apply {
                font = font.deriveFont(Font.BOLD)
                border = JBUI.Borders.empty(8, 8, 4, 8)
            })
            addSeparator()

            for (agent in agents) {
                val displayName = agent.name.replaceFirstChar { it.uppercase() }
                add(JMenuItem(displayName).apply {
                    if (agent.name == selectedAgent?.name) {
                        icon = AllIcons.Actions.Checked
                    }
                    addActionListener {
                        selectedAgent = agent
                        appState.setSelectedAgent(agent.name)
                        updateLabel()
                    }
                })
            }
        }
        popup.show(modeLabel, 0, -popup.preferredSize.height)
    }

    fun getSelectedMode(): String = selectedAgent?.name ?: "code"
}
