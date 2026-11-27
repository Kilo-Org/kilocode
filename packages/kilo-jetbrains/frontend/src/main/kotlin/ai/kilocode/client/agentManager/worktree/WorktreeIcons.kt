package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.ui.LiveBadgeIcon
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import com.intellij.util.ui.JBUI
import java.util.concurrent.ConcurrentHashMap
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

    // Cached per base so a row keeps a stable icon identity across list rebuilds, and so the badge
    // is built once rather than on every sync().
    private val live = ConcurrentHashMap<Icon, Icon>()

    /**
     * [base] wearing the New UI live-run badge: a success dot in the top-right corner, punched
     * through the glyph so it reads over it. See [LiveBadgeIcon] for why it is a Kilo-owned icon
     * rather than the platform's own `BadgeIcon`/`BadgeDotProvider`.
     */
    fun live(base: Icon): Icon = live.computeIfAbsent(base) {
        LiveBadgeIcon(it, JBUI.CurrentTheme.IconBadge.SUCCESS)
    }

    /** The row glyph for a worktree running a process with nothing else to say about it. */
    val runIndicator: Icon get() = live(AllIcons.Toolwindows.ToolWindowRun)

    /**
     * Leading icon for a worktree row. At rest the row shows what it is — the local machine, a locked
     * checkout, or a branch checkout — while a running, waiting or failed session takes the slot over
     * so the list still surfaces activity at a glance. An operation on the row ([busy]) outranks all
     * of it.
     *
     * A live run-configuration process ([running]) is orthogonal to all of that, so it never takes the
     * slot from session activity: a settled row swaps its resting glyph for the run indicator, and a
     * row with something to say keeps its own glyph and wears the run badge on top. Either way the row
     * falls back to the plain activity glyph the moment the process exits, and back to the resting
     * glyph once the session settles.
     */
    fun forRow(
        busy: Boolean,
        kind: SessionActivityKind? = null,
        locked: Boolean = false,
        current: Boolean = false,
        running: Boolean = false,
    ): Icon {
        if (busy) return spinner
        if (kind == null) {
            if (running) return runIndicator
            return when {
                current -> local
                locked -> this.locked
                else -> branch
            }
        }
        val glyph = when (kind) {
            SessionActivityKind.RUNNING -> this.running
            SessionActivityKind.QUESTION,
            SessionActivityKind.PERMISSION,
            SessionActivityKind.PLAN,
            SessionActivityKind.LOGIN_REQUIRED,
            SessionActivityKind.ERROR -> kind.icon()
        }
        return if (running) live(glyph) else glyph
    }

    /**
     * The monochrome at-rest glyphs that follow the row text color. The pull request verdict glyphs in
     * [ai.kilocode.client.ui.PrIcons] are excluded so their palette survives.
     */
    fun neutral(icon: Icon?): Boolean = icon === local || icon === locked || icon === branch
}
