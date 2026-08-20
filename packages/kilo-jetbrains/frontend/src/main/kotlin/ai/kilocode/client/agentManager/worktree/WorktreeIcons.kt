package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.IdleIcon
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

    // Small muted dot the size of the status icons. An idle row keeps the same leading slot so the
    // title never shifts, but the dot reads as quieter and smaller than the running/question glyphs.
    val idle: Icon = IdleIcon

    // A worktree row shows the running spinner or the "?" attention glyph while a session there is
    // active; idle, locked, and errored rows fall back to the small [idle] dot. [pending] (creation
    // in progress) still shows the platform spinner.
    fun forRow(pending: Boolean, kind: SessionActivityKind? = null): Icon =
        if (pending) spinner else forKind(kind)

    // Status icon for a single session: the spinner while running, the "?" attention glyph while
    // waiting for input, and the small [idle] dot otherwise.
    fun forKind(kind: SessionActivityKind?): Icon = when (kind) {
        SessionActivityKind.RUNNING -> running
        SessionActivityKind.QUESTION,
        SessionActivityKind.PERMISSION,
        SessionActivityKind.PLAN,
        SessionActivityKind.LOGIN_REQUIRED -> kind.icon()
        SessionActivityKind.ERROR, null -> idle
    }
}
