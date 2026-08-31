package ai.kilocode.client.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
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
internal fun checksTooltip(checks: GhChecksDto): String {
    val head = when (checks.state) {
        GhChecks.PASSED -> KiloBundle.message("worktree.pr.checks.passed", checks.total)
        GhChecks.FAILED -> KiloBundle.message("worktree.pr.checks.failed", checks.failed, checks.total)
        GhChecks.PENDING -> KiloBundle.message("worktree.pr.checks.running", checks.pending, checks.total)
        GhChecks.NONE -> return ""
    }
    val lines = listOf(head, KiloBundle.message("worktree.pr.checks.tooltip.open")).map(XmlStringUtil::escapeString)
    return XmlStringUtil.wrapInHtml(lines.joinToString("<br>"))
}

/** GitHub's checks tab for a pull request, which is what a CI glyph should open. */
internal fun checksUrl(pull: WorktreePrDto): String = "${pull.url.trimEnd('/')}/checks"

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
internal fun openTooltip(): String =
    XmlStringUtil.wrapInHtml(XmlStringUtil.escapeString(KiloBundle.message("worktree.pr.tooltip.open")))

/**
 * Tooltip for a PR title that can be truncated — the header, where the pill and the title are laid out
 * in a row that a narrow editor tab clips. Carries the state, number, full title, and worktree name.
 */
internal fun prTooltip(pull: WorktreePrDto, name: String? = null): String {
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
        KiloBundle.message("worktree.pr.tooltip.open"),
    ).map(XmlStringUtil::escapeString)
    return XmlStringUtil.wrapInHtml(lines.joinToString("<br>"))
}
