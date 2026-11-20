package ai.kilocode.client.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.active.ActiveBadge
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import com.intellij.ide.BrowserUtil
import com.intellij.util.ui.UIUtil
import com.intellij.xml.util.XmlStringUtil

/**
 * Shared PR badge helpers used by both the Agent Manager worktree views and the chat session header.
 * Lives in the neutral `ui` package so `session/ui/header/` does not depend on the Agent Manager
 * package.
 */

internal fun style(state: GhState): UiStyle.Badge.Style = when (state) {
    GhState.OPEN -> UiStyle.Badge.PullRequestOpen
    GhState.DRAFT -> UiStyle.Badge.PullRequestDraft
    GhState.MERGED -> UiStyle.Badge.PullRequestMerged
    GhState.CLOSED -> UiStyle.Badge.PullRequestClosed
}

internal fun stateLabel(state: GhState): String = when (state) {
    GhState.OPEN -> KiloBundle.message("worktree.pr.state.open")
    GhState.DRAFT -> KiloBundle.message("worktree.pr.state.draft")
    GhState.MERGED -> KiloBundle.message("worktree.pr.state.merged")
    GhState.CLOSED -> KiloBundle.message("worktree.pr.state.closed")
}

internal fun reviewLabel(review: GhReview): String = when (review) {
    GhReview.APPROVED -> KiloBundle.message("worktree.pr.review.approved")
    GhReview.CHANGES_REQUESTED -> KiloBundle.message("worktree.pr.review.changes")
    GhReview.PENDING -> KiloBundle.message("worktree.pr.review.pending")
    GhReview.NONE -> ""
}

/** Plain-text CI summary for a popup row, where a tooltip is not available to carry the counts. */
internal fun checksLabel(checks: GhChecksDto): String = when (checks.state) {
    GhChecks.PASSED -> KiloBundle.message("worktree.pr.checks.passed", checks.total)
    GhChecks.FAILED -> KiloBundle.message("worktree.pr.checks.failed", checks.failed, checks.total)
    GhChecks.PENDING -> KiloBundle.message("worktree.pr.checks.running", checks.pending, checks.total)
    GhChecks.NONE -> ""
}

/** Tooltip for a review verdict glyph. Blank for states that get no glyph, which never reach a tooltip. */
internal fun reviewTooltip(review: GhReview): String {
    val label = reviewLabel(review).takeIf { it.isNotBlank() } ?: return ""
    return XmlStringUtil.wrapInHtml(XmlStringUtil.escapeString(label))
}

/**
 * Tooltip for a CI verdict glyph. Carries the counts the glyph itself cannot, so a red icon can say
 * whether one job of twenty failed or all of them did.
 */
internal fun checksTooltip(checks: GhChecksDto, interactive: Boolean = true): String {
    val head = when (checks.state) {
        GhChecks.PASSED -> KiloBundle.message("worktree.pr.checks.passed", checks.total)
        GhChecks.FAILED -> KiloBundle.message("worktree.pr.checks.failed", checks.failed, checks.total)
        GhChecks.PENDING -> KiloBundle.message("worktree.pr.checks.running", checks.pending, checks.total)
        GhChecks.NONE -> return ""
    }
    val lines = listOfNotNull(head, KiloBundle.message("worktree.pr.checks.tooltip.open").takeIf { interactive })
        .map(XmlStringUtil::escapeString)
    return XmlStringUtil.wrapInHtml(lines.joinToString("<br>"))
}

/** Plain-text review-conversation summary, for a popup row and as the head of the badge tooltip. */
internal fun commentsLabel(value: GhCommentsDto): String {
    if (value.unresolved <= 0) return ""
    return KiloBundle.message("worktree.pr.comments.unresolved", value.unresolved, value.total)
}

/** The count a comment glyph is shown with. Blank when nothing is unresolved, which gets no glyph either. */
internal fun commentsCount(value: GhCommentsDto): String =
    if (value.unresolved > 0) value.unresolved.toString() else ""

/**
 * Tooltip for the review-conversation badge. The glyph already shows the unresolved count, so the tooltip's
 * job is to name what is being counted and how many conversations there are in total.
 */
internal fun commentsTooltip(value: GhCommentsDto, interactive: Boolean = true): String {
    val head = commentsLabel(value).takeIf { it.isNotBlank() } ?: return ""
    val lines = listOfNotNull(head, KiloBundle.message("worktree.pr.comments.tooltip.open").takeIf { interactive })
        .map(XmlStringUtil::escapeString)
    return XmlStringUtil.wrapInHtml(lines.joinToString("<br>"))
}

/** GitHub's checks tab for a pull request, which is what a CI glyph should open. */
internal fun checksUrl(pull: WorktreePrDto): String = "${pull.url.trimEnd('/')}/checks"

/**
 * Whether [pull] no longer merges into its base branch.
 *
 * Only while it is still open. GitHub keeps answering `mergeable` for a merged or closed pull request, and
 * on a closed one the answer is usually stale anyway — a conflict nobody can act on any more is not worth
 * marking a row for. [GhMerge.UNKNOWN] is not a conflict either; see the enum for why.
 */
internal fun conflicted(pull: WorktreePrDto?): Boolean =
    pull?.merge == GhMerge.CONFLICTING && (pull.state == GhState.OPEN || pull.state == GhState.DRAFT)

/**
 * Plain-text merge verdict, for a popup line and as the head of a changes tooltip. Names the branch when the
 * base ref is known: "the base branch" is not what someone holding four worktrees needs to read.
 */
internal fun mergeLabel(base: String): String = when {
    base.isBlank() -> KiloBundle.message("worktree.pr.merge.conflict")
    else -> KiloBundle.message("worktree.pr.merge.conflict.base", base)
}

/**
 * [tip] with the merge verdict added as its own leading line, so a changes summary carrying the conflict
 * marker also says in words what the marker means.
 *
 * Leading, because it outranks what the tooltip was going to open with: a diff that no longer merges is the
 * fact to read before its counts or its click hint.
 */
internal fun conflictTooltip(tip: String, base: String): String {
    val head = XmlStringUtil.escapeString(mergeLabel(base))
    return XmlStringUtil.wrapInHtml("$head<br>${UIUtil.getHtmlBody(tip)}")
}

/**
 * [next], but carrying [previous]'s pull request when [next] could not carry one of its own.
 *
 * GitHub refusing a lookup because the token's budget is spent is not evidence that the branch lost its
 * pull request, and the refusal can stand for the best part of an hour — so dropping the pill would
 * report a change that never happened and leave it reported for a long time. Only for the same branch:
 * on a different one the held pull request would be wrong rather than merely stale.
 */
internal fun held(next: BranchStatusDto, previous: BranchStatusDto?): BranchStatusDto {
    if (next.availability != GhAvailability.RATE_LIMITED || next.pr != null) return next
    val pr = previous?.takeIf { it.branch == next.branch }?.pr ?: return next
    return next.copy(pr = pr)
}

/**
 * Tooltip for a PR pill that shows its own number and state, such as the one on a worktree row. Only
 * the click hint: repeating "Open #8" under a pill that reads "#8" tells the user nothing.
 */
internal fun openTooltip(): String = hint("worktree.pr.tooltip.open")

/** The checks click hint alone, for a surface that already states the verdict in words. */
internal fun checksOpenTooltip(): String = hint("worktree.pr.checks.tooltip.open")

/** The conversation click hint alone, for a surface that already states the count in words. */
internal fun commentsOpenTooltip(): String = hint("worktree.pr.comments.tooltip.open")

private fun hint(key: String): String =
    XmlStringUtil.wrapInHtml(XmlStringUtil.escapeString(KiloBundle.message(key)))

/** A null handler leaves known PR evidence visible but inert, without falling back to navigation. */
internal data class PrBadgeActions(
    val open: (() -> Unit)? = null,
    val review: (() -> Unit)? = null,
    val checks: (() -> Unit)? = null,
    val comments: (() -> Unit)? = null,
) {
    companion object {
        fun browser(pull: WorktreePrDto?): PrBadgeActions {
            val p = pull ?: return PrBadgeActions()
            val open = { BrowserUtil.browse(p.url) }
            return PrBadgeActions(open, open, { BrowserUtil.browse(checksUrl(p)) }, open)
        }
    }
}

/**
 * Title-line PR glyphs, in the one order both worktree and hosted rows read: unresolved
 * conversations, review verdict, CI verdict. Conversations lead because they are the entry that
 * needs a person; builds and reviews are outcomes to read.
 */
internal fun prGlyphBadges(
    pull: WorktreePrDto?,
    actions: PrBadgeActions = PrBadgeActions.browser(pull),
): List<ActiveBadge> {
    val p = pull ?: return emptyList()
    return listOfNotNull(commentsBadge(p, actions.comments), reviewBadge(p, actions.review), checksBadge(p, actions.checks))
}

/** The `#<number>` secondary-line pill for a PR, or null when there is no linked PR. */
internal fun prNumberBadge(
    pull: WorktreePrDto?,
    actions: PrBadgeActions = PrBadgeActions.browser(pull),
): ActiveBadge? {
    val p = pull ?: return null
    return ActiveBadge(
        "#${p.number}",
        style(p.state),
        id = "pull-request",
        tooltip = openTooltip().takeIf { actions.open != null },
        action = actions.open,
    )
}

private fun reviewBadge(p: WorktreePrDto, action: (() -> Unit)?): ActiveBadge? {
    val glyph = PrIcons.review(p.review) ?: return null
    return ActiveBadge(
        "",
        id = "pr-review",
        tooltip = reviewTooltip(p.review),
        action = action,
        icon = glyph,
    )
}

private fun checksBadge(p: WorktreePrDto, action: (() -> Unit)?): ActiveBadge? {
    val glyph = PrIcons.checks(p.checks) ?: return null
    return ActiveBadge(
        "",
        id = "pr-checks",
        tooltip = checksTooltip(p.checks, action != null),
        // The checks tab rather than the conversation: someone clicking a red build wants the log.
        action = action,
        icon = glyph,
    )
}

private fun commentsBadge(p: WorktreePrDto, action: (() -> Unit)?): ActiveBadge? {
    val glyph = PrIcons.comments(p.comments) ?: return null
    return ActiveBadge(
        commentsCount(p.comments),
        id = "pr-comments",
        tooltip = commentsTooltip(p.comments, action != null),
        // The conversation tab, which is where GitHub lists the threads themselves.
        action = action,
        icon = glyph,
    )
}

/**
 * Tooltip for a PR title that can be truncated — the header, where the pill and the title are laid out
 * in a row that a narrow editor tab clips. Carries the state, number, full title, and worktree name.
 */
internal fun prTooltip(pull: WorktreePrDto, name: String? = null, interactive: Boolean = true): String {
    val title = pull.title.trim()
    val head = buildString {
        append(stateLabel(pull.state))
        append(" #")
        append(pull.number)
        if (title.isNotBlank()) {
            append(' ')
            append(title)
        }
    }
    val lines = listOfNotNull(
        head,
        name?.takeIf { title.isNotBlank() }?.let { "($it)" },
        KiloBundle.message("worktree.pr.tooltip.open").takeIf { interactive },
    ).map(XmlStringUtil::escapeString)
    return XmlStringUtil.wrapInHtml(lines.joinToString("<br>"))
}
