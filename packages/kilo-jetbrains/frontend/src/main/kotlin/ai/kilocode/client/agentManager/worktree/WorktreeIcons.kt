package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SpinnerIcon
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.BadgeDotProvider
import com.intellij.ui.BadgeIcon
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
     * [base] wearing the New UI live-run badge: the platform success dot in the top-right corner,
     * punched through the glyph so it reads over it. This is what `ExecutionUtil.withLiveIndicator`
     * resolves to on New UI, and the same pairing the Run tool window stripe shows for a live process.
     *
     * The dot geometry is spelled out instead of taking [BadgeDotProvider]'s defaults. Those are
     * fractions of a 20px stripe icon (dot 3.5/20, hole ring 1.5/20) that put the ring past the canvas
     * edge, and `HoledIcon` sizes itself to the union of glyph and badge — so a 16px base reports ~18px
     * and the row's icon column would widen for running rows alone. Keeping the platform's dot and ring
     * size while pulling the center in by the ring width (x/y = 0.75/0.25 against a 0.25 hole radius)
     * lands the ring flush with the top-right corner and the union back at the base's own 16px.
     */
    fun live(base: Icon): Icon = live.computeIfAbsent(base) {
        BadgeIcon(it, JBUI.CurrentTheme.IconBadge.SUCCESS, BadgeDotProvider(x = 0.75, y = 0.25, radius = 0.175, border = 0.075))
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
