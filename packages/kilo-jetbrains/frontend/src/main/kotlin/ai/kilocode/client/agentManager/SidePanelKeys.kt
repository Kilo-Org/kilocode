package ai.kilocode.client.agentManager

import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.util.Key
import com.intellij.ui.content.Content

enum class SidePanelMode { CHAT, AGENT_MANAGER }

object SidePanelKeys {
    val MODE: DataKey<SidePanelMode> = DataKey.create("kilo.sidePanel.mode")
    val WORKTREE_PANEL: DataKey<AgentManagerPanel> = DataKey.create("kilo.sidePanel.worktreePanel")
    val CONTENT_MODE: Key<SidePanelMode> = Key.create("kilo.sidePanel.content.mode")
}

internal fun Content.applySidePanelMode(mode: SidePanelMode) {
    putUserData(SidePanelKeys.CONTENT_MODE, mode)
}
