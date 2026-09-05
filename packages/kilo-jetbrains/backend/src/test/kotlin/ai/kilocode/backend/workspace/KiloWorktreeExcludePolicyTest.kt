package ai.kilocode.backend.workspace

import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class KiloWorktreeExcludePolicyTest : BasePlatformTestCase() {
    override fun tearDown() {
        try {
            KiloWorktreeIndexSettings.set(false)
        } finally {
            super.tearDown()
        }
    }

    fun `test excludes kilo worktrees under the project base path by default`() {
        val base = project.basePath!!
        val policy = KiloWorktreeExcludePolicy(project)

        assertOrderedEquals(
            policy.getExcludeUrlsForProject().toList(),
            listOf(VfsUtilCore.pathToUrl("$base/.kilo/worktrees")),
        )
    }

    fun `test returns nothing when indexing worktrees is enabled`() {
        KiloWorktreeIndexSettings.set(true)
        val policy = KiloWorktreeExcludePolicy(project)

        assertEmpty(policy.getExcludeUrlsForProject().toList())
    }

    fun `test returns nothing when the project has no base path`() {
        val default = ProjectManager.getInstance().defaultProject
        val policy = KiloWorktreeExcludePolicy(default)

        assertEmpty(policy.getExcludeUrlsForProject().toList())
    }
}
