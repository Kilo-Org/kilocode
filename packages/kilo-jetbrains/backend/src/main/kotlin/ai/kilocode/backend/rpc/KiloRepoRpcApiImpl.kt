package ai.kilocode.backend.rpc

import ai.kilocode.backend.repo.RepoInference
import ai.kilocode.backend.repo.RepoRegistry
import ai.kilocode.backend.repo.RepoRoots
import ai.kilocode.backend.repo.RepoSettings
import ai.kilocode.backend.repo.repoPathKey
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloRepoRpcApi
import ai.kilocode.rpc.dto.RepoAddResultDto
import ai.kilocode.rpc.dto.RepoDto
import ai.kilocode.rpc.dto.RepoListDto
import ai.kilocode.rpc.dto.RepoSource
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.platform.project.ProjectId
import com.intellij.platform.project.findProjectOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant

/**
 * Backend implementation of [KiloRepoRpcApi].
 *
 * Composes the three pieces — the persisted [RepoRegistry], pure [RepoInference], and the
 * [RepoRoots] identity helper — into one list per pinned workspace. Repository-bound work still goes
 * through the directory-scoped worktree/workspace RPCs; this API only catalogs.
 */
class KiloRepoRpcApiImpl internal constructor(
    private val registry: RepoRegistry? = null,
) : KiloRepoRpcApi {

    private companion object {
        val LOG = KiloLog.create(KiloRepoRpcApiImpl::class.java)
    }

    private val reg: RepoRegistry get() = registry ?: service()

    override suspend fun list(projectId: ProjectId?, directory: String): RepoListDto = build(projectId, directory)

    override suspend fun refresh(projectId: ProjectId?, directory: String): RepoListDto = withContext(Dispatchers.IO) {
        RepoRoots.invalidate()
        build(pinnedRoot(directory), projectId, directory)
    }

    override suspend fun add(directory: String, path: String, label: String?): RepoAddResultDto = withContext(Dispatchers.IO) {
        val candidate = runCatching { Path.of(path) }.getOrNull()
            ?: return@withContext RepoAddResultDto(error = "Not a valid path.")
        if (!Files.isDirectory(candidate)) return@withContext RepoAddResultDto(error = "Not a directory.")
        val root = RepoRoots.resolve(candidate) ?: return@withContext RepoAddResultDto(error = "Not a git repository.")
        if (RepoInference.isManagedWorktree(root)) {
            return@withContext RepoAddResultDto(error = "Managed worktrees cannot be added as projects.")
        }

        val pinned = pinnedRoot(directory)
        val key = pinned.toString()
        if (repoPathKey(root.toString()) == repoPathKey(key)) {
            return@withContext RepoAddResultDto(error = "That repository is already the current project.")
        }

        // A path already registered — including a linked worktree of an added repo, which resolves to
        // the same canonical root — is success with the existing entry, not an error.
        reg.added(key)
            .firstOrNull { repoPathKey(it.root) == repoPathKey(root.toString()) }
            ?.let { return@withContext RepoAddResultDto(repo = repoDto(root, RepoSource.ADDED, it.label, order = it.order)) }

        reg.add(key, root.toString(), label, Instant.now().toString())
        val entry = reg.added(key).firstOrNull { repoPathKey(it.root) == repoPathKey(root.toString()) }
        LOG.info("repo added root=$root key=$key")
        RepoAddResultDto(repo = repoDto(root, RepoSource.ADDED, entry?.label ?: label, order = entry?.order ?: 0))
    }

    override suspend fun remove(projectId: ProjectId?, directory: String, repoId: String): RepoListDto = build(projectId, directory) {
        val key = it.toString()
        if (repoId == RepoRoots.id(it)) return@build

        reg.added(key).firstOrNull { RepoRoots.id(Path.of(it.root)) == repoId }?.let { entry ->
            reg.remove(key, entry.root)
            LOG.info("repo removed root=${entry.root} key=$key")
            return@build
        }

        // Not an added repo: an inferred one. Its opaque id has to be matched against the current
        // inference result to recover the root a dismissal is stored by.
        val project = resolveProject(projectId, directory)
        val inferred = project?.let { RepoInference.fromProject(it, reg.dismissed(key)) }
        val match = inferred?.let { result -> (result.active + result.nested).firstOrNull { path -> RepoRoots.id(path) == repoId } }
        if (match != null) {
            reg.dismiss(key, match.toString())
            LOG.info("repo dismissed root=$match key=$key")
        }
    }

    override suspend fun resolve(directory: String): String? = withContext(Dispatchers.IO) {
        val path = runCatching { Path.of(directory) }.getOrNull() ?: return@withContext null
        RepoRoots.resolve(path)?.toString()
    }

    override suspend fun includeNested(): Boolean = RepoSettings.includeNested()

    override suspend fun setIncludeNested(value: Boolean) {
        RepoSettings.setIncludeNested(value)
    }

    /**
     * Resolve the pinned root and hand it to [mutate], which runs under [Dispatchers.IO], then build the
     * refreshed list. The pinned root resolution is shared with [build] so it shells out to `git` exactly
     * once per mutation rather than once here and again in the list it returns.
     */
    private suspend fun build(projectId: ProjectId?, directory: String, mutate: suspend (Path) -> Unit): RepoListDto =
        withContext(Dispatchers.IO) {
            mutate(pinnedRoot(directory))
            build(pinnedRoot(directory), projectId, directory)
        }

    private suspend fun build(projectId: ProjectId?, directory: String): RepoListDto =
        withContext(Dispatchers.IO) { build(pinnedRoot(directory), projectId, directory) }

    /**
     * The blocking half of [build]: `git` subprocesses ([RepoRoots], [RepoInference]) and filesystem
     * checks, so it always runs on [Dispatchers.IO]. [pinned] is resolved by the caller so this does not
     * repeat the same `git rev-parse` the caller may already have needed.
     */
    private suspend fun build(pinned: Path, projectId: ProjectId?, directory: String): RepoListDto {
        val key = pinned.toString()
        val includeNested = RepoSettings.includeNested()
        val dismissed = reg.dismissed(key)
        val project = resolveProject(projectId, directory)
        val inferred = project?.let { RepoInference.fromProject(it, dismissed) } ?: RepoInference.Result()

        val added = reg.added(key)
        val taken = (listOf(key) + added.map { it.root }).map { repoPathKey(it) }.toSet()
        val active = inferred.active.filterNot { repoPathKey(it.toString()) in taken }
        val nested = inferred.nested.filterNot { repoPathKey(it.toString()) in taken }

        val repos = buildList {
            add(repoDto(pinned, RepoSource.PINNED, label = null, order = 0))
            added.forEachIndexed { index, entry ->
                add(repoDto(Path.of(entry.root), RepoSource.ADDED, entry.label, order = index))
            }
            active.forEach { add(repoDto(it, RepoSource.INFERRED, label = null, order = 0)) }
            if (includeNested) nested.forEach { add(repoDto(it, RepoSource.INFERRED, label = null, nested = true, order = 0)) }
        }
        val withheld = if (includeNested) emptyList() else nested.map { repoDto(it, RepoSource.INFERRED, label = null, nested = true, order = 0) }
        return RepoListDto(repos, withheld, includeNested, inferred.discovery, inferred.truncated)
    }

    private fun repoDto(
        root: Path,
        source: RepoSource,
        label: String?,
        nested: Boolean = false,
        order: Int = 0,
    ): RepoDto {
        val text = root.toString()
        return RepoDto(
            id = RepoRoots.id(root),
            root = text,
            name = root.fileName?.toString() ?: text,
            source = source,
            label = label,
            nested = nested,
            missing = !Files.isDirectory(root),
            order = order,
        )
    }

    /** Canonical pinned root for [directory], falling back to its normalized absolute path. */
    private fun pinnedRoot(directory: String): Path {
        val path = runCatching { Path.of(directory).toAbsolutePath().normalize() }.getOrNull() ?: Path.of(directory)
        return RepoRoots.resolve(path) ?: path
    }

    private fun resolveProject(projectId: ProjectId?, hint: String): Project? {
        if (ApplicationManager.getApplication() == null) return null
        projectId?.findProjectOrNull()?.takeIf { !it.isDefault }?.let { return it }
        val open = ProjectManager.getInstance().openProjects.filter { !it.isDefault && !it.isDisposed }
        if (open.isEmpty()) return null
        val dir = resolveProjectDirectoryHint(hint, open.mapNotNull { it.basePath })
        return open.firstOrNull { samePath(it.basePath ?: "", dir) } ?: open.firstOrNull()
    }
}
