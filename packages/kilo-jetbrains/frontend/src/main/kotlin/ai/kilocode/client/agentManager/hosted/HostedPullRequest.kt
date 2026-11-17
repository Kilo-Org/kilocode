package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.HostedPullRequestSummaryDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.WorktreePrDto

/**
 * Presentation mapping for the K7 workspace PR summary.
 *
 * The local worktree badges are the target: same states, glyphs, and tooltips. Anything less than
 * complete evidence must not invent an approval or a pass, so unavailable review reads as no
 * verdict, partial checks stay pending, and an unknown PR state renders no chrome at all.
 */
internal fun hostedPullRequest(result: HostedWorkspacePullRequestDto): WorktreePrDto? {
    if (result.state == "no_pr") return null
    return hostedPullRequest(result.pullRequest, result.ref)
}

internal fun hostedPullRequest(pull: HostedPullRequestSummaryDto?, ref: HostedWorkspaceRefDto): WorktreePrDto? {
    if (pull == null) return null
    val state = when (pull.state) {
        "open" -> GhState.OPEN
        "draft" -> GhState.DRAFT
        "merged" -> GhState.MERGED
        "closed" -> GhState.CLOSED
        else -> return null
    }
    val url = pull.url.trim()
    if (!url.startsWith("https://")) return null
    return WorktreePrDto(
        path = ref.key,
        number = pull.number.coerceIn(1L, Int.MAX_VALUE.toLong()).toInt(),
        state = state,
        url = url,
        title = pull.title.orEmpty(),
        review = review(pull),
        checks = checks(pull),
        comments = GhCommentsDto(
            total = pull.conversations.unresolved.count(),
            unresolved = pull.conversations.unresolved.count(),
        ),
        merge = merge(pull),
    )
}

/**
 * Keeps a header readable when Cloud could not read the PR title. A partial observation may carry a
 * null title; falling back to the workspace name keeps the same text the header showed before the PR
 * was linked instead of dropping to a bare number.
 */
internal fun WorktreePrDto.titled(fallback: String): WorktreePrDto {
    if (title.isNotBlank()) return this
    val name = fallback.trim()
    return if (name.isEmpty()) this else copy(title = name)
}

/** Only pending review or pending/partial checks justify a bounded background poll. */
internal fun hostedPullRequestPending(pull: WorktreePrDto?): Boolean =
    pull != null && (pull.review == GhReview.PENDING || pull.checks.state == GhChecks.PENDING)

private fun review(pull: HostedPullRequestSummaryDto): GhReview {
    if (!pull.review.available) return GhReview.NONE
    return when (pull.review.decision) {
        "approved" -> GhReview.APPROVED
        "changes_requested" -> GhReview.CHANGES_REQUESTED
        "review_required" -> GhReview.PENDING
        else -> if (pull.review.pending) GhReview.PENDING else GhReview.NONE
    }
}

private fun checks(pull: HostedPullRequestSummaryDto): GhChecksDto {
    val raw = pull.checks
    val total = (raw.total - raw.skipped).count()
    val passed = raw.passed.count()
    val failed = raw.failed.count()
    val pending = raw.pending.count()
    val unknown = raw.unknown.count()
    // A status provider that timed out, an incomplete rollup, or an explicit partial observation
    // means the counts are a lower bound. It must never be published as a green pass.
    val partial = pull.partial || !raw.complete || unknown > 0 || !raw.available ||
        pull.unavailable.any { it == "checks" || it == "statuses" }
    val state = when {
        !raw.available -> GhChecks.NONE
        failed > 0 -> GhChecks.FAILED
        pending > 0 -> GhChecks.PENDING
        partial -> if (total > 0) GhChecks.PENDING else GhChecks.NONE
        total > 0 && passed >= total -> GhChecks.PASSED
        else -> GhChecks.NONE
    }
    return GhChecksDto(state = state, total = total, passed = passed, failed = failed, pending = pending)
}

private fun merge(pull: HostedPullRequestSummaryDto): GhMerge {
    if (!pull.mergeability.complete) return GhMerge.UNKNOWN
    return when (pull.mergeability.mergeable) {
        true -> GhMerge.CLEAN
        false -> GhMerge.CONFLICTING
        null -> GhMerge.UNKNOWN
    }
}

private fun Long?.count(): Int = this?.coerceIn(0L, Int.MAX_VALUE.toLong())?.toInt() ?: 0
