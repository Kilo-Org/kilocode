package ai.kilocode.backend.run

import com.intellij.openapi.externalSystem.model.ProjectSystemId
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

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

    @Test
    fun `build tasks compile main and test sources without running tests`() {
        assertEquals(listOf("classes", "testClasses"), WorktreeRunAdapter.buildTasks(GRADLE, clean = false))
        assertEquals(listOf("clean", "classes", "testClasses"), WorktreeRunAdapter.buildTasks(GRADLE, clean = true))
    }

    @Test
    fun `unknown external system has no build tasks`() {
        val other = ProjectSystemId("SBT")
        assertFalse(WorktreeRunAdapter.buildable(other))
        assertEquals(emptyList(), WorktreeRunAdapter.buildTasks(other, clean = false))
        assertTrue(WorktreeRunAdapter.buildable(GRADLE))
    }

    @Test
    fun `build settings target the worktree copy of a nested linked root`() {
        val settings = buildSettings("/repo/packages/kilo-jetbrains", clean = false)

        assertEquals(path("$worktree/packages/kilo-jetbrains"), settings.externalProjectPath)
        assertEquals(listOf("classes", "testClasses"), settings.taskNames)
        assertEquals(GRADLE.id, settings.externalSystemIdString)
        assertEquals(
            mapOf(
                WorktreeRunAdapter.WORKTREE_ENV to worktree,
                WorktreeRunAdapter.REPO_ENV to repo,
                WorktreeRunAdapter.DEBUGGER_ENV to "false",
            ),
            settings.env,
        )
    }

    @Test
    fun `build settings for a repository root linked project target the worktree root`() {
        // Spring Boot style layout: the linked Gradle root is the repository itself.
        val settings = buildSettings(repo, clean = true)

        assertEquals(worktree, settings.externalProjectPath)
        assertEquals(listOf("clean", "classes", "testClasses"), settings.taskNames)
    }

    private fun buildSettings(root: String, clean: Boolean) =
        WorktreeRunAdapter.buildSettings(GRADLE, root, worktree, repo, clean)

    private fun rebase(value: String?): String = WorktreeRunAdapter.rebase(value, repo, worktree)

    private fun path(value: String): String = Path.of(value).normalize().toString()

    private companion object {
        private val GRADLE = ProjectSystemId("GRADLE")
    }
}
