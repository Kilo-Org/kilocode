package ai.kilocode.backend.repo

import ai.kilocode.rpc.WORKTREE_STORAGE
import ai.kilocode.rpc.dto.RepoDiscovery
import com.intellij.openapi.application.readAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ex.ProjectRootManagerEx
import com.intellij.openapi.vcs.ProjectLevelVcsManager
import com.intellij.openapi.vfs.VirtualFile
import kotlinx.coroutines.withTimeoutOrNull
import java.nio.file.Path

/**
 * Discovers git repositories in the open IDE project.
 *
 * Primary source is the IDE's own VCS roots ([ProjectLevelVcsManager]). Those reflect what the user
 * configured in the project rather than a filesystem guess, and they work identically in monolith and
 * split mode because the backend runs where the project lives. A content-root scan is the fallback for
 * when no VCS is active (the Git plugin disabled), which is also the only case where VCS roots cannot
 * answer at all.
 *
 * Every discovered root is resolved to its canonical **main-worktree root** ([RepoRoots.resolve]) before
 * being kept, which does three things at once: it dedupes a repo whose several content roots all map to
 * one repository, it collapses a linked worktree to its parent, and it drops non-git VCS roots (SVN,
 * Mercurial) without depending on git4idea's names, because a non-git root fails to resolve.
 */
internal object RepoInference {
    const val CAP = 50

    /** How long to wait for VCS mappings to activate before answering with what is available. */
    private const val MAPPINGS_TIMEOUT_MS = 2_000L

    private val MANAGED_SEGMENT = "/" + WORKTREE_STORAGE.replace('\\', '/') + "/"

    /**
     * Inferred repositories for one project.
     *
     * [active] are top-level repos. [nested] are repos inside another listed repo's working tree
     * (submodules, vendored checkouts) — withheld by a caller while nested support is off.
     */
    data class Result(
        val active: List<Path> = emptyList(),
        val nested: List<Path> = emptyList(),
        val discovery: RepoDiscovery = RepoDiscovery.NONE,
        val truncated: Boolean = false,
    )

    /**
     * Pure discovery over already-collected candidate roots, so the filtering/dedupe/nesting rules are
     * unit-testable without a VCS-configured IDE project.
     *
     * [resolve] maps an arbitrary candidate directory to its canonical main-worktree root, or null when
     * it is not a git repository. [pinned] is the open project's own root, excluded here because it is
     * reported separately, but still used as a nesting ancestor.
     *
     * The nested-vs-active split is reported as-is; the caller decides whether to show or withhold the
     * nested set, so this pure step has no opinion about the setting.
     */
    fun discover(
        pinned: Path?,
        vcsRoots: List<Path>,
        contentRoots: List<Path>,
        dismissed: Set<String>,
        resolve: (Path) -> Path?,
    ): Result {
        val source = if (vcsRoots.isNotEmpty()) vcsRoots else contentRoots
        val discovery = when {
            vcsRoots.isNotEmpty() -> RepoDiscovery.VCS_ROOTS
            contentRoots.isNotEmpty() -> RepoDiscovery.CONTENT_ROOTS
            else -> RepoDiscovery.NONE
        }

        val pinnedKey = pinned?.let { key(it) }
        val dismissedKeys = dismissed.mapTo(HashSet()) { repoPathKey(it) }
        val resolved = source.asSequence()
            .mapNotNull(resolve)
            .filterNot { isManagedWorktree(it) }
            .filterNot { key(it) == pinnedKey }
            .filterNot { key(it) in dismissedKeys }
            .distinct()
            .toList()

        val ancestors = if (pinned == null) resolved else listOf(pinned) + resolved
        val nested = resolved.filter { root -> ancestors.any { it != root && root.startsWith(it) } }
        val top = resolved.filterNot { it in nested }
        val active = top.take(CAP)
        return Result(active = active, nested = nested, discovery = discovery, truncated = top.size > active.size)
    }

    /**
     * Collect candidate roots from the IDE project and run [discover].
     *
     * Reads VCS mappings after a bounded wait for activation, then falls back to content roots when
     * there are none.
     */
    suspend fun fromProject(project: Project, dismissed: Set<String>): Result {
        val pinned = project.basePath?.let { runCatching { RepoRoots.resolve(Path.of(it)) }.getOrNull() }
        val manager = ProjectLevelVcsManager.getInstance(project)
        withTimeoutOrNull(MAPPINGS_TIMEOUT_MS) { manager.awaitInitialization() }

        val vcs = readAction { manager.getAllVcsRoots().mapNotNull { it.path.toPath() } }
        val content = if (vcs.isEmpty()) {
            readAction { ProjectRootManagerEx.getInstanceEx(project).contentRoots.mapNotNull { it.toPath() } }
        } else {
            emptyList()
        }
        return discover(pinned, vcs, content, dismissed, RepoRoots::resolve)
    }

    /** True when [path] is under Kilo's own managed worktree storage, which must never register as a repo. */
    internal fun isManagedWorktree(path: Path): Boolean {
        val norm = path.toString().replace('\\', '/')
        return norm.contains(MANAGED_SEGMENT) || norm.endsWith(MANAGED_SEGMENT.trimEnd('/'))
    }

    private fun key(path: Path): String = repoPathKey(path.toString())

    private fun VirtualFile.toPath(): Path? = runCatching { Path.of(path) }.getOrNull()
}
