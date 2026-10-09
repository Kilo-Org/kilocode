package ai.kilocode.client.agentManager.worktree

import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.WorktreeDirtyDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeStatsDto
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse

/**
 * The report is what a user pastes into an issue, so its facts are asserted directly. Sections mirror
 * the VS Code diagnostics command so both clients can be read the same way.
 */
class WorktreeDiagnosticsTest {

    @Test
    fun `reports tool availability, per-worktree status, and leftovers`() {
        val healthy = "/repo/.kilo/worktrees/alive"
        val broken = "/repo/.kilo/worktrees/broken"

        val text = WorktreeDiagnostics.render(
            WorktreeDiagnostics.Input(
                root = "/repo",
                gh = GhAvailability.TIMEOUT,
                worktrees = listOf(
                    WorktreeDto(healthy, "alive", "feature/alive", healthy),
                    WorktreeDto(broken, "broken", "feature/broken", broken),
                ),
                orphans = listOf("/repo/.kilo/worktrees/leftover"),
                stats = mapOf(normalizeWorktreePath(healthy) to WorktreeStatsDto(healthy, additions = 3)),
                dirty = mapOf(
                    normalizeWorktreePath(broken) to
                        WorktreeDirtyDto(broken, unavailable = true, reason = "Git command timed out"),
                ),
            ),
        )

        assertContains(text, "repository: /repo")
        assertContains(text, "git: ok")
        assertContains(text, "gh:  did not answer within its budget")
        assertContains(text, "worktrees: 2")
        assertContains(text, "unavailable: 1")
        assertContains(text, "orphan directories: 1")
        assertContains(text, "[ok] alive — $healthy (branch=feature/alive)")
        assertContains(text, "[unavailable] broken — $broken (branch=feature/broken reason=Git command timed out)")
        assertContains(text, "  /repo/.kilo/worktrees/leftover")
    }

    @Test
    fun `names a missing git rather than blaming the worktrees`() {
        val text = WorktreeDiagnostics.render(
            WorktreeDiagnostics.Input(
                root = "/repo",
                gh = GhAvailability.GIT_MISSING,
                worktrees = emptyList(),
                orphans = emptyList(),
                stats = emptyMap(),
                dirty = emptyMap(),
            ),
        )

        assertContains(text, "git: NOT FOUND")
        assertContains(text, "gh:  not probed (git missing)")
        assertContains(text, "(none)")
        // Nothing to clean up, so the section must not appear at all.
        assertFalse(text.contains("orphan directories (nothing removes"))
    }
}
