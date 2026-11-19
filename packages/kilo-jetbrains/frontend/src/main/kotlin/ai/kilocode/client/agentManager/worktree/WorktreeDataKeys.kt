package ai.kilocode.client.agentManager.worktree

import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.actionSystem.DataKey

object WorktreeDataKeys {
    val WORKTREE: DataKey<WorktreeDto> = DataKey.create("ai.kilocode.client.agentManager.worktree.Worktree")
}
