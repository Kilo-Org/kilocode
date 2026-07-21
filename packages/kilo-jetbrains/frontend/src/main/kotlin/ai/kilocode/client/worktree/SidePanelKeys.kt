package ai.kilocode.client.worktree

import com.intellij.openapi.actionSystem.DataKey

enum class SidePanelMode { BRANCH, WORKTREES }

object SidePanelKeys {
    val MODE: DataKey<SidePanelMode> = DataKey.create("kilo.sidePanel.mode")
    val WORKTREE_PANEL: DataKey<WorktreePanel> = DataKey.create("kilo.sidePanel.worktreePanel")
}
