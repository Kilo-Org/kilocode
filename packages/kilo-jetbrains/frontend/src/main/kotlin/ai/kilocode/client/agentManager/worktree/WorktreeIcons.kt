package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhReview
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.AnimatedIcon
import javax.swing.Icon

internal object WorktreeIcons {
    val branch: Icon = IconLoader.getIcon("/icons/worktreeBranch.svg", WorktreeIcons::class.java)
    val locked: Icon = IconLoader.getIcon("/icons/worktreeLock.svg", WorktreeIcons::class.java)

    // Review verdicts are bare stroke glyphs and CI verdicts are filled circle badges, so the two sit
    // side by side without reading as the same indicator twice — an approved review and a green build
    // would otherwise both be a green check.
    val reviewApproved: Icon = IconLoader.getIcon("/icons/pr-review-approved.svg", WorktreeIcons::class.java)
    val reviewChanges: Icon = IconLoader.getIcon("/icons/pr-review-changes.svg", WorktreeIcons::class.java)
    val checksPassed: Icon = IconLoader.getIcon("/icons/pr-checks-passed.svg", WorktreeIcons::class.java)
    val checksFailed: Icon = IconLoader.getIcon("/icons/pr-checks-failed.svg", WorktreeIcons::class.java)
    val checksRunning: Icon = IconLoader.getIcon("/icons/pr-checks-running.svg", WorktreeIcons::class.java)

    // The current checkout is the machine you work on rather than a branch checkout, so it gets the
    // monitor glyph the VS Code agent manager uses for the same row.
    val local: Icon = IconLoader.getIcon("/icons/worktree-local.svg", WorktreeIcons::class.java)
    val spinner: Icon = AnimatedIcon.Default.INSTANCE

    // Single swap point for the running-session icon. Change this to retarget the animation
    // (e.g. AnimatedIcon.Default.INSTANCE or SessionActivityKind.RUNNING.icon()).
    val running: Icon = SpinnerIcon.icon

    /**
     * Leading icon for a worktree row. At rest the row shows what it is — the local machine, a locked
     * checkout, or a branch checkout — while a running, waiting or failed session takes the slot over
     * so the list still surfaces activity at a glance. An operation on the row ([busy]) outranks all
     * of it.
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
            SessionActivityKind.LOGIN_REQUIRED,
            SessionActivityKind.ERROR -> kind.icon()
            null -> when {
                current -> local
                locked -> this.locked
                else -> branch
            }
        }
    }

    /**
     * Icon for a pull request's review verdict, or null when there is nothing worth a slot. A review
     * that has been requested but not yet given says only "not reviewed yet", which is the state most
     * open PRs sit in, so showing it would put an icon on nearly every row and mean nothing.
     */
    fun forReview(review: GhReview): Icon? = when (review) {
        GhReview.APPROVED -> reviewApproved
        GhReview.CHANGES_REQUESTED -> reviewChanges
        GhReview.NONE, GhReview.PENDING -> null
    }

    /** Icon for a pull request's CI verdict, or null when the head reports no checks at all. */
    fun forChecks(checks: GhChecksDto): Icon? = when (checks.state) {
        GhChecks.PASSED -> checksPassed
        GhChecks.FAILED -> checksFailed
        GhChecks.PENDING -> checksRunning
        GhChecks.NONE -> null
    }

    /**
     * The monochrome at-rest glyphs that follow the row text color; status icons are excluded so their
     * palette survives.
     */
    fun neutral(icon: Icon?): Boolean = icon === local || icon === locked || icon === branch
}
