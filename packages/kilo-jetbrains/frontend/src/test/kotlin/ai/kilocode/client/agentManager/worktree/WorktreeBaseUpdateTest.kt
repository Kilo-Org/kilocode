package ai.kilocode.client.agentManager.worktree

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorktreeBaseUpdateTest {
    @Test
    fun `prompt uses the saved base and recorded remote`() {
        val text = worktreeBaseUpdatePrompt("/repo/.kilo/worktrees/feature", "release", "upstream", recorded = true)

        assertContains(text, "saved base branch \"release\"")
        assertContains(text, "recorded remote \"upstream\"")
        assertContains(text, "\"refs/heads/release\"")
        assertContains(text, "Do not use today's project default or the worktree's own upstream.")
    }

    @Test
    fun `prompt asks to resolve the base upstream when no remote was recorded`() {
        val text = worktreeBaseUpdatePrompt("/repo/.kilo/worktrees/feature", "release", null, recorded = true)

        assertContains(text, "Resolve the upstream of the base branch \"release\"")
        assertContains(text, "local-only or cannot be resolved, stop and ask")
    }

    @Test
    fun `prompt keeps the merge safeguards and never pushes`() {
        val text = worktreeBaseUpdatePrompt("/repo/.kilo/worktrees/feature", "main", "origin", recorded = true)

        for (safeguard in listOf(
            "FETCH_HEAD^{commit}",
            "Do not use the shared stash stack or --autostash",
            "merge.autoStash",
            "Preserve all staged, unstaged, and untracked changes",
            "Keep the recovery copy until restoration is verified",
            "Do not switch branches",
            "Do not push, merge a PR, or apply this worktree into the base",
        )) {
            assertContains(text, safeguard)
        }
        assertFalse(text.contains("push this branch"))
    }

    @Test
    fun `prompt asks to confirm a candidate when no base was recorded`() {
        val text = worktreeBaseUpdatePrompt("/repo/.kilo/worktrees/feature", "main", null, recorded = false)

        assertContains(text, "No saved base branch was recorded")
        assertContains(text, "candidate \"main\"")
        assertContains(text, "confirm with me that this candidate is the intended base")
        assertContains(text, "Never merge an unconfirmed base")
    }

    @Test
    fun `quotes embedded path and branch characters`() {
        val text = worktreeBaseUpdatePrompt("/repo/a\"b", "rel\"ease", null, recorded = true)

        assertTrue(text.contains("/repo/a\\\"b"))
        assertTrue(text.contains("rel\\\"ease"))
    }
}
