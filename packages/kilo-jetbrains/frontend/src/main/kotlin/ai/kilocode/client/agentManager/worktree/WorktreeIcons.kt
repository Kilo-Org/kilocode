package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import com.intellij.util.IconUtil
import javax.swing.Icon

internal object WorktreeIcons {
    val branch: Icon = IconLoader.getIcon("/icons/worktreeBranch.svg", WorktreeIcons::class.java)
    val locked: Icon = IconLoader.getIcon("/icons/worktreeLock.svg", WorktreeIcons::class.java)
    val running: Icon = IconLoader.getIcon("/icons/worktreeRunning.svg", WorktreeIcons::class.java)
    private val prompt: Icon = IconLoader.getIcon("/icons/scroll-question.svg", WorktreeIcons::class.java)
    val question: Icon = IconUtil.scale(prompt, null, branch.iconWidth.toFloat() / prompt.iconWidth.toFloat())
    val spinner: Icon = AnimatedIcon.Default.INSTANCE

    fun forRow(locked: Boolean, pending: Boolean, kind: SessionActivityKind? = null): Icon = when {
        pending -> spinner
        kind == SessionActivityKind.RUNNING -> running
        kind == SessionActivityKind.QUESTION ||
            kind == SessionActivityKind.PLAN ||
            kind == SessionActivityKind.PERMISSION -> question
        locked -> this.locked
        else -> branch
    }
}
