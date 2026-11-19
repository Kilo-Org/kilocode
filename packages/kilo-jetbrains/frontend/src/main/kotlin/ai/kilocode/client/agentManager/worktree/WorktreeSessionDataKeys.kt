package ai.kilocode.client.agentManager.worktree

import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.actionSystem.DataKey

object WorktreeSessionDataKeys {
    val SESSION: DataKey<SessionDto> = DataKey.create("ai.kilocode.client.agentManager.worktree.Session")
    val PANEL: DataKey<WorktreeSessionEditorPanel> = DataKey.create("ai.kilocode.client.agentManager.worktree.SessionPanel")
}
