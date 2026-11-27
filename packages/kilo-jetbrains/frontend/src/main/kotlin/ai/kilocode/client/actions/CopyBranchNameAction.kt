package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import ai.kilocode.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.DumbAware
import java.awt.datatransfer.StringSelection

/** Copies the git branch checked out in the selected worktree. */
class CopyBranchNameAction : AnAction(), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = branch(e) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val name = branch(e) ?: return
        Telemetry.send("Worktree Action", mapOf("action" to "copy_branch_name"))
        CopyPasteManager.getInstance().setContents(StringSelection(name))
    }

    /** Null on a detached HEAD, where the branch label is a placeholder rather than a real ref. */
    private fun branch(e: AnActionEvent): String? {
        val item = e.getData(WorktreeDataKeys.WORKTREE) ?: return null
        return item.branch.takeIf { it.isNotBlank() && it != "(detached)" }
    }
}
