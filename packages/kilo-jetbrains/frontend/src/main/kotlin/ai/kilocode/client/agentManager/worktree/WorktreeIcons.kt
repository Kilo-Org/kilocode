package ai.kilocode.client.agentManager.worktree

import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import javax.swing.Icon

internal object WorktreeIcons {
    val branch: Icon = IconLoader.getIcon("/icons/worktreeBranch.svg", WorktreeIcons::class.java)
    val locked: Icon = IconLoader.getIcon("/icons/worktreeLock.svg", WorktreeIcons::class.java)
    val spinner: Icon = AnimatedIcon.Default.INSTANCE

    fun forRow(locked: Boolean, pending: Boolean): Icon = when {
        pending -> spinner
        locked -> this.locked
        else -> branch
    }
}
