package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SpinnerIcon
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import javax.swing.Icon

internal object WorktreeIcons {
    val branch: Icon = IconLoader.getIcon("/icons/worktreeBranch.svg", WorktreeIcons::class.java)
    val locked: Icon = IconLoader.getIcon("/icons/worktreeLock.svg", WorktreeIcons::class.java)

    // The current checkout is the machine you work on rather than a branch checkout, so it gets the
    // monitor glyph the VS Code agent manager uses for the same row.
    val local: Icon = IconLoader.getIcon("/icons/worktree-local.svg", WorktreeIcons::class.java)
    val spinner: Icon = AnimatedIcon.Default.INSTANCE

    // Single swap point for the running-session icon. Change this to retarget the animation
    // (e.g. AnimatedIcon.Default.INSTANCE or SessionActivityKind.RUNNING.icon()).
    val running: Icon = SpinnerIcon.icon

    /**
     * Leading icon for a worktree row. At rest the row shows what it is — the local machine, a locked
     * checkout, or a branch checkout — while a running or waiting session takes the slot over so the
     * list still surfaces activity at a glance. An operation on the row ([busy]) outranks all of it,
     * and an errored session falls back to the resting glyph instead of shouting in the leading slot.
     */
    fun forRow(
        busy: Boolean,
        kind: SessionActivityKind? = null,
        locked: Boolean = false,
        current: Boolean = false,
    ): Icon {
        if (busy) return spinner
        return when (kind) {
            SessionActivityKind.RUNNING -> running
            SessionActivityKind.QUESTION,
            SessionActivityKind.PERMISSION,
            SessionActivityKind.PLAN,
            SessionActivityKind.LOGIN_REQUIRED -> kind.icon()
            SessionActivityKind.ERROR, null -> when {
                current -> local
                locked -> this.locked
                else -> branch
            }
        }
    }
}
