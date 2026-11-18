package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhReview
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.HostedPullRequestChecksDto
import ai.kilocode.rpc.dto.HostedPullRequestConversationsDto
import ai.kilocode.rpc.dto.HostedPullRequestMergeabilityDto
import ai.kilocode.rpc.dto.HostedPullRequestReviewDto
import ai.kilocode.rpc.dto.HostedPullRequestSummaryDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HostedPullRequestTest {
    private val ref = HostedWorkspaceRefDto("cloud", "wrk_1")

    @Test
    fun `maps a complete open pull request with approval and passing checks`() {
        val pull = checkNotNull(hostedPullRequest(summary(), ref))

        assertEquals(ref.key, pull.path)
        assertEquals(42, pull.number)
        assertEquals(GhState.OPEN, pull.state)
        assertEquals("https://github.com/owner/repo/pull/42", pull.url)
        assertEquals("Fix Cloud PR", pull.title)
        assertEquals(GhReview.APPROVED, pull.review)
        assertEquals(GhChecks.PASSED, pull.checks.state)
        assertEquals(3, pull.checks.total)
        assertEquals(3, pull.checks.passed)
        assertEquals(2, pull.comments.total)
        assertEquals(2, pull.comments.unresolved)
        assertEquals(GhMerge.CLEAN, pull.merge)
    }

    @Test
    fun `maps every canonical pull request state`() {
        mapOf("open" to GhState.OPEN, "draft" to GhState.DRAFT, "merged" to GhState.MERGED, "closed" to GhState.CLOSED)
            .forEach { (state, expected) ->
                assertEquals(expected, hostedPullRequest(summary(state = state), ref)?.state)
            }
        assertNull(hostedPullRequest(summary(state = "unknown"), ref))
    }

    @Test
    fun `excludes skipped checks from the total`() {
        val checks = checks(total = 5, passed = 2, skipped = 3)
        val pull = checkNotNull(hostedPullRequest(summary(checks = checks), ref))
        assertEquals(2, pull.checks.total)
        assertEquals(GhChecks.PASSED, pull.checks.state)
    }

    @Test
    fun `partial incomplete or unknown checks never render a green pass`() {
        val partial = listOf(
            summary(checks = checks(complete = false)),
            summary(checks = checks(unknown = 1)),
            summary(checks = checks(total = 3, passed = 3), partial = true),
            summary(checks = checks(total = 3, passed = 3), unavailable = listOf("checks")),
            summary(checks = checks(total = 3, passed = 3), unavailable = listOf("statuses")),
        )
        partial.forEach { pull ->
            val value = checkNotNull(hostedPullRequest(pull, ref))
            assertEquals(GhChecks.PENDING, value.checks.state, "expected pending for ${pull.checks}")
        }
        assertEquals(GhChecks.NONE, checkNotNull(hostedPullRequest(summary(checks = checks(available = false)), ref)).checks.state)
    }

    @Test
    fun `failed checks stay failed even when the observation is partial`() {
        val pull = checkNotNull(hostedPullRequest(
            summary(checks = checks(total = 4, passed = 1, failed = 1, complete = false), partial = true),
            ref,
        ))
        assertEquals(GhChecks.FAILED, pull.checks.state)
        assertEquals(1, pull.checks.failed)
    }

    @Test
    fun `unavailable review never invents an approval`() {
        val pull = checkNotNull(hostedPullRequest(
            summary(review = HostedPullRequestReviewDto("approved", available = false, pending = false)),
            ref,
        ))
        assertEquals(GhReview.NONE, pull.review)
    }

    @Test
    fun `requested review reads pending and settles when decided`() {
        assertEquals(GhReview.PENDING, hostedPullRequest(
            summary(review = HostedPullRequestReviewDto("review_required", available = true, pending = true)),
            ref,
        )?.review)
        assertEquals(GhReview.CHANGES_REQUESTED, hostedPullRequest(
            summary(review = HostedPullRequestReviewDto("changes_requested", available = true, pending = false)),
            ref,
        )?.review)
    }

    @Test
    fun `mergeability only reports when complete`() {
        assertEquals(GhMerge.CONFLICTING, hostedPullRequest(
            summary(merge = HostedPullRequestMergeabilityDto(mergeable = false, state = "dirty", complete = true)),
            ref,
        )?.merge)
        assertEquals(GhMerge.UNKNOWN, hostedPullRequest(
            summary(merge = HostedPullRequestMergeabilityDto(mergeable = false, state = "dirty", complete = false)),
            ref,
        )?.merge)
        assertEquals(GhMerge.UNKNOWN, hostedPullRequest(
            summary(merge = HostedPullRequestMergeabilityDto(mergeable = null, state = null, complete = true)),
            ref,
        )?.merge)
    }

    @Test
    fun `no_pr clears while a summary-less failure is not evidence of no PR`() {
        assertNull(hostedPullRequest(HostedWorkspacePullRequestDto(ref, "no_pr", null)))
        assertNull(hostedPullRequest(HostedWorkspacePullRequestDto(ref, "rate_limited", null)))
    }

    @Test
    fun `a missing pull request title falls back to the workspace name`() {
        val pull = checkNotNull(hostedPullRequest(summary(title = null), ref))
        assertEquals("", pull.title)
        assertEquals("Cloud workspace", pull.titled("Cloud workspace").title)
        assertEquals("Fix Cloud PR", checkNotNull(hostedPullRequest(summary(), ref)).titled("Cloud workspace").title)
        assertEquals("", pull.titled("  ").title)
    }

    @Test
    fun `only an https pull request URL is accepted`() {
        assertNull(hostedPullRequest(summary(url = "http://github.com/owner/repo/pull/42"), ref))
        assertNull(hostedPullRequest(summary(url = "javascript:alert(1)"), ref))
    }

    @Test
    fun `pending is limited to review or checks that are still running`() {
        assertTrue(hostedPullRequestPending(checkNotNull(hostedPullRequest(
            summary(review = HostedPullRequestReviewDto("review_required", available = true, pending = true)), ref,
        ))))
        assertTrue(hostedPullRequestPending(checkNotNull(hostedPullRequest(
            summary(checks = checks(total = 2, passed = 1, pending = 1, complete = false)), ref,
        ))))
        assertFalse(hostedPullRequestPending(checkNotNull(hostedPullRequest(summary(), ref))))
        assertFalse(hostedPullRequestPending(null))
    }

    @Test
    fun `large numbers clamp instead of overflowing`() {
        val pull = checkNotNull(hostedPullRequest(summary(number = 9_007_199_254_740_991L), ref))
        assertEquals(Int.MAX_VALUE, pull.number)
    }

    private fun summary(
        state: String = "open",
        url: String = "https://github.com/owner/repo/pull/42",
        number: Long = 42,
        title: String? = "Fix Cloud PR",
        review: HostedPullRequestReviewDto = HostedPullRequestReviewDto("approved", available = true, pending = false),
        checks: HostedPullRequestChecksDto = checks(),
        conversations: HostedPullRequestConversationsDto = HostedPullRequestConversationsDto(2, complete = true),
        merge: HostedPullRequestMergeabilityDto = HostedPullRequestMergeabilityDto(true, "clean", complete = true),
        partial: Boolean = false,
        unavailable: List<String> = emptyList(),
    ) = HostedPullRequestSummaryDto(
        url = url,
        number = number,
        state = state,
        title = title,
        headSha = "a".repeat(40),
        lastSyncedAt = "2026-11-17T00:00:00Z",
        review = review,
        checks = checks,
        conversations = conversations,
        mergeability = merge,
        partial = partial,
        unavailable = unavailable,
    )

    private fun checks(
        total: Long = 3,
        passed: Long = 3,
        failed: Long = 0,
        pending: Long = 0,
        skipped: Long = 0,
        unknown: Long = 0,
        complete: Boolean = true,
        available: Boolean = true,
    ) = HostedPullRequestChecksDto(total, passed, failed, pending, skipped, unknown, complete, available)
}
