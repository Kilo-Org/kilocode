package ai.kilocode.client.ui

import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhReview
import com.intellij.openapi.util.IconLoader
import javax.swing.Icon

/**
 * Review and CI verdict glyphs for a pull request, shown on worktree rows and in the PR header. Lives
 * beside [PrBadges][style] in the neutral `ui` package so the chat session header does not depend on the
 * Agent Manager package.
 *
 * Review verdicts are bare stroke glyphs and CI verdicts are filled circle badges, so the two sit side
 * by side without reading as the same indicator twice — an approved review and a green build would
 * otherwise both be a green check. The failed and running fills use the muted palette tones: these two
 * appear on rows the user is not acting on yet, and the saturated variants turned the list into a
 * traffic light.
 *
 * The comment glyph is a bare stroke in the neutral tone rather than a third colored badge: it is always
 * shown with its count, so the number carries the weight and a hue would only claim a verdict it has not
 * got.
 */
internal object PrIcons {
    val reviewApproved: Icon = IconLoader.getIcon("/icons/pr-review-approved.svg", PrIcons::class.java)
    val reviewChanges: Icon = IconLoader.getIcon("/icons/pr-review-changes.svg", PrIcons::class.java)
    val checksPassed: Icon = IconLoader.getIcon("/icons/pr-checks-passed.svg", PrIcons::class.java)
    val checksFailed: Icon = IconLoader.getIcon("/icons/pr-checks-failed.svg", PrIcons::class.java)
    val checksRunning: Icon = IconLoader.getIcon("/icons/pr-checks-running.svg", PrIcons::class.java)
    val comments: Icon = IconLoader.getIcon("/icons/pr-comments.svg", PrIcons::class.java)

    /**
     * Icon for a pull request's review verdict, or null when there is nothing worth a slot. A review
     * that has been requested but not yet given says only "not reviewed yet", which is the state most
     * open PRs sit in, so showing it would put an icon on nearly every row and mean nothing.
     */
    fun review(review: GhReview): Icon? = when (review) {
        GhReview.APPROVED -> reviewApproved
        GhReview.CHANGES_REQUESTED -> reviewChanges
        GhReview.NONE, GhReview.PENDING -> null
    }

    /** Icon for a pull request's CI verdict, or null when the head reports no checks at all. */
    fun checks(checks: GhChecksDto): Icon? = when (checks.state) {
        GhChecks.PASSED -> checksPassed
        GhChecks.FAILED -> checksFailed
        GhChecks.PENDING -> checksRunning
        GhChecks.NONE -> null
    }

    /**
     * Icon for a pull request's review conversations, or null when none is unresolved. A pull request whose
     * every thread is settled has nothing outstanding to report, and a reviewed PR is the common case — a
     * glyph there would sit on most rows saying only "someone commented once".
     */
    fun comments(value: GhCommentsDto): Icon? = comments.takeIf { value.unresolved > 0 }
}
