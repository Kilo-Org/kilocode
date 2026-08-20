package ai.kilocode.backend.run

import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals

class WorktreeRunAdapterTest {
    private val repo = "/repo"
    private val worktree = "/repo/.kilo/worktrees/wt"

    @Test
    fun `blank and repo root resolve to the worktree root`() {
        assertEquals(worktree, rebase(null))
        assertEquals(worktree, rebase(""))
        assertEquals(worktree, rebase("   "))
        assertEquals(worktree, rebase(repo))
        assertEquals(worktree, rebase("/repo/"))
    }

    @Test
    fun `nested project path keeps its subdirectory under the worktree`() {
        assertEquals(path("$worktree/packages/kilo-jetbrains"), rebase("/repo/packages/kilo-jetbrains"))
        assertEquals(path("$worktree/packages/opencode"), rebase("/repo/packages/opencode/"))
    }

    @Test
    fun `bare project macro resolves to the worktree root`() {
        assertEquals(worktree, rebase("\$PROJECT_DIR\$"))
    }

    @Test
    fun `project macro prefix is swapped for the worktree`() {
        assertEquals(path("$worktree/packages/kilo-jetbrains"), rebase("\$PROJECT_DIR\$/packages/kilo-jetbrains"))
    }

    @Test
    fun `relative path resolves against the worktree`() {
        assertEquals(path("$worktree/packages/kilo-jetbrains"), rebase("packages/kilo-jetbrains"))
    }

    @Test
    fun `absolute path outside the repository is kept as configured`() {
        assertEquals("/opt/tools/data", rebase("/opt/tools/data"))
        assertEquals("/repository-sibling", rebase("/repository-sibling"))
    }

    @Test
    fun `paths already inside the worktree are not nested again`() {
        // Managed worktrees live under <repo>/.kilo/worktrees/<name>, so they also match the repo prefix.
        assertEquals(path(worktree), rebase(worktree))
        assertEquals(path("$worktree/packages/kilo-jetbrains"), rebase("$worktree/packages/kilo-jetbrains"))
    }

    @Test
    fun `sibling worktree path is rebased onto the target worktree`() {
        assertEquals(
            path("$worktree/.kilo/worktrees/other/packages/x"),
            rebase("/repo/.kilo/worktrees/other/packages/x"),
        )
    }

    private fun rebase(value: String?): String = WorktreeRunAdapter.rebase(value, repo, worktree)

    private fun path(value: String): String = Path.of(value).normalize().toString()
}
