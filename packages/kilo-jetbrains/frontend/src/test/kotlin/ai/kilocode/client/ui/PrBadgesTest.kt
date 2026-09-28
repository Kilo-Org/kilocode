package ai.kilocode.client.ui

import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.GhCommentsDto
import ai.kilocode.rpc.dto.GhMerge
import ai.kilocode.rpc.dto.GhState
import ai.kilocode.rpc.dto.WorktreePrDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * What a branch status keeps when GitHub refuses to refresh it. A refusal for a spent token budget is
 * temporary and carries no pull request, so the question is whether the dock drops the pill it already
 * showed — for up to an hour, over a change that never happened.
 */
class PrBadgesTest {
    private val pr = WorktreePrDto("/repo", 7, GhState.OPEN, "https://pr/7")

    @Test
    fun `a refused refresh keeps the pull request already on the same branch`() {
        val previous = BranchStatusDto(branch = "feature/x", availability = GhAvailability.OK, pr = pr)
        val next = BranchStatusDto(branch = "feature/x", availability = GhAvailability.RATE_LIMITED)

        val result = held(next, previous)

        assertEquals(pr, result.pr)
        // Only the pull request is carried over: the branch and its git-derived flags come from the new
        // answer, which is still accurate because git needs no GitHub budget.
        assertEquals(GhAvailability.RATE_LIMITED, result.availability)
        assertEquals("feature/x", result.branch)
    }

    @Test
    fun `a refused refresh keeps the unresolved conversation count already shown`() {
        // The count rides the pull request, so a refresh that answers without one must not leave the
        // header reading "every conversation settled" — the resolver never got to ask.
        val counted = pr.copy(comments = GhCommentsDto(total = 5, unresolved = 3))
        val previous = BranchStatusDto(branch = "feature/x", availability = GhAvailability.OK, pr = counted)
        val next = BranchStatusDto(branch = "feature/x", availability = GhAvailability.RATE_LIMITED)

        assertEquals(3, held(next, previous).pr?.comments?.unresolved)
    }

    @Test
    fun `a refused refresh on another branch keeps nothing`() {
        val previous = BranchStatusDto(branch = "feature/x", availability = GhAvailability.OK, pr = pr)
        val next = BranchStatusDto(branch = "main", availability = GhAvailability.RATE_LIMITED)

        // The held pull request belongs to the branch that was checked out when it was resolved, so on a
        // different branch it would be wrong rather than merely out of date.
        assertNull(held(next, previous).pr)
    }

    @Test
    fun `every other refusal is reported as it stands`() {
        val previous = BranchStatusDto(branch = "feature/x", availability = GhAvailability.OK, pr = pr)

        // A revoked token or an uninstalled gh says the data cannot be trusted, not that it is a moment
        // stale, and both persist until the user acts — so the pill goes.
        for (value in listOf(GhAvailability.UNAUTH, GhAvailability.MISSING, GhAvailability.GIT_MISSING)) {
            val next = BranchStatusDto(branch = "feature/x", availability = value)
            assertNull(held(next, previous).pr, "for: $value")
        }
    }

    @Test
    fun `a refusal that answered with a pull request is left untouched`() {
        val previous = BranchStatusDto(branch = "feature/x", availability = GhAvailability.OK, pr = pr)
        val fresh = WorktreePrDto("/repo", 9, GhState.MERGED, "https://pr/9")
        val next = BranchStatusDto(branch = "feature/x", availability = GhAvailability.RATE_LIMITED, pr = fresh)

        assertSame(next, held(next, previous))
    }

    @Test
    fun `nothing held means nothing to keep`() {
        val next = BranchStatusDto(branch = "feature/x", availability = GhAvailability.RATE_LIMITED)

        assertSame(next, held(next, null))
        assertNull(held(next, BranchStatusDto(branch = "feature/x", availability = GhAvailability.OK)).pr)
    }

    @Test
    fun `a conflict is reported while the pull request is still open`() {
        for (state in listOf(GhState.OPEN, GhState.DRAFT)) {
            assertTrue(conflicted(pr.copy(state = state, merge = GhMerge.CONFLICTING)), "for: $state")
        }
    }

    @Test
    fun `a conflict on a finished pull request is not reported`() {
        // GitHub keeps answering mergeable after a merge or a close, where the answer is both stale and
        // unactionable — nobody is going to rebase a closed branch.
        for (state in listOf(GhState.MERGED, GhState.CLOSED)) {
            assertFalse(conflicted(pr.copy(state = state, merge = GhMerge.CONFLICTING)), "for: $state")
        }
    }

    @Test
    fun `only a stated conflict is reported`() {
        assertFalse(conflicted(null))
        assertFalse(conflicted(pr.copy(merge = GhMerge.CLEAN)))
        // The verdict GitHub has not finished computing, which every PR reports for a moment after a push.
        assertFalse(conflicted(pr.copy(merge = GhMerge.UNKNOWN)))
    }
}
