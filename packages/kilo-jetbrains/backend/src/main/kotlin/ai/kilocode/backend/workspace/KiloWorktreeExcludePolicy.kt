package ai.kilocode.backend.workspace

import ai.kilocode.rpc.WORKTREE_STORAGE
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.impl.DirectoryIndexExcludePolicy
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.util.ArrayUtil

/**
 * Excludes `<project>/.kilo/worktrees` from this project's index when the worktree is stored inside
 * the project directory. Worktrees there are indexed like any other project file by default because
 * IntelliJ scanning follows the workspace model, not git — a `.git/info/exclude` entry is never
 * consulted by the indexer.
 *
 * This intentionally does not use [com.intellij.workspaceModel.core.fileIndex.WorkspaceFileIndexContributor],
 * the modern replacement suggested by this interface's KDoc: the project-scoped entity it would need
 * (`ProjectRootEntity`) is `@ApiStatus.Internal`, and the content-root-scoped variant registers one
 * excluded root per content root, which the platform's own contributor avoids for `JAVA_MODULE` roots
 * to limit cost. [DirectoryIndexExcludePolicy] is `@ApiStatus.OverrideOnly`, not deprecated, and returns
 * URLs for directories that may not exist yet, so a worktree created later is covered with no listener.
 *
 * Opening a worktree as its own project is unaffected: exclusions are per project, so that project
 * indexes its own checkout fully.
 */
internal class KiloWorktreeExcludePolicy(private val project: Project) : DirectoryIndexExcludePolicy {
    override fun getExcludeUrlsForProject(): Array<String> {
        if (KiloWorktreeIndexSettings.get()) return ArrayUtil.EMPTY_STRING_ARRAY
        val base = project.basePath ?: return ArrayUtil.EMPTY_STRING_ARRAY
        return arrayOf(VfsUtilCore.pathToUrl("$base/$WORKTREE_STORAGE"))
    }
}
