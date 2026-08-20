package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SpinnerIcon
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import javax.swing.Icon

internal object WorktreeIcons {
    val branch: Icon = IconLoader.getIcon("/icons/worktreeBranch.svg", WorktreeIcons::class.java)
    val locked: Icon = IconLoader.getIcon("/icons/worktreeLock.svg", WorktreeIcons::class.java)
    val spinner: Icon = AnimatedIcon.Default.INSTANCE

    // Single swap point for the running-session icon. Change this to retarget the animation
    // (e.g. AnimatedIcon.Default.INSTANCE or SessionActivityKind.RUNNING.icon()).
    val running: Icon = SpinnerIcon.icon

    fun forRow(locked: Boolean, pending: Boolean, kind: SessionActivityKind? = null): Icon = when {
        pending -> spinner
        kind == SessionActivityKind.RUNNING -> running
        kind != null -> kind.icon()
        locked -> this.locked
        else -> branch
    }
}
