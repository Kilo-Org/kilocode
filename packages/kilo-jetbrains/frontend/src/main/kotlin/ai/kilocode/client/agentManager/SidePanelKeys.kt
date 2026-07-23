package ai.kilocode.client.agentManager

import com.intellij.openapi.actionSystem.DataKey

enum class SidePanelMode { CHAT, AGENT_MANAGER }

object SidePanelKeys {
    val MODE: DataKey<SidePanelMode> = DataKey.create("kilo.sidePanel.mode")
    val WORKTREE_PANEL: DataKey<AgentManagerPanel> = DataKey.create("kilo.sidePanel.worktreePanel")
}
