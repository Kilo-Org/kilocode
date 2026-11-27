package ai.kilocode.backend.rpc

import ai.kilocode.backend.cli.KiloBackendCliManager
import ai.kilocode.backend.diff.GitComparison
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.backend.workspace.KiloWorkspaceData
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.isManagedWorktreeStorage
import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.SetupScriptKind
import ai.kilocode.rpc.dto.SetupScriptTargetDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.SystemInfo
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.platform.project.ProjectId
import com.intellij.platform.project.findProjectOrNull
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

class KiloWorkspaceRpcApiImpl : KiloWorkspaceRpcApi {
    companion object {
        private val LOG = KiloLog.create(KiloWorkspaceRpcApiImpl::class.java)
        private const val CONFIG = "{}\n"
        private const val DIFF_CAP = 200_000
    }

    private val gitCache = ConcurrentHashMap<String, Boolean>()

    private suspend fun data(directory: String? = null) = KiloWorkspaceData(service<KiloBackendCliManager>().client(), directory)

    override suspend fun resolveProjectDirectory(projectId: ProjectId?, hint: String): String {
        // Experimental IntelliJ ProjectId API: maps the calling frontend project
        // to the matching backend project across monolith windows and split mode.
        val base = projectId?.findProjectOrNull()?.takeIf { !it.isDefault }?.basePath
        if (base != null) return base
        val bases = ProjectManager.getInstance().openProjects
            .filter { !it.isDefault }
            .mapNotNull { it.basePath }
        return resolveProjectDirectoryHint(hint, bases)
    }

    override suspend fun state(directory: String): Flow<KiloWorkspaceStateDto> =
        service<KiloBackendWorkspaceManager>().get(directory).state

    override suspend fun reload(directory: String) = service<KiloBackendWorkspaceManager>().get(directory).reload()

    override suspend fun reloadCoreSettings(directory: String): Boolean {
        service<KiloBackendCliManager>().client().call("location.reload")
        reload(directory)
        return true
    }

    override suspend fun models(directory: String): ModelsWorkspaceDto = data(directory).models()

    override suspend fun config(directory: String): ConfigDto = data(directory).config()

    override suspend fun updateConfig(directory: String, patch: ConfigPatchDto): ConfigDto = data(directory).updateConfig(patch)

    override suspend fun files(directory: String, path: String): List<WorkspaceFileDto> {
        val item = clean(path) ?: return emptyList()
        val file = file(item) ?: return emptyList()
        val base = file(clean(directory) ?: directory) ?: return emptyList()
        val paths = if (file.isAbsolute) listOf(file) else listOf(base.resolve(file).normalize())
        val found = linkedMapOf<String, WorkspaceFileDto>()
        for (target in paths) {
            relativeWithinWorkspace(base, target) ?: continue
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(target.toString()) ?: continue
            found[vf.path] = WorkspaceFileDto(vf.path, vf.name, vf.isDirectory)
        }
        return found.values.toList()
    }

    override suspend fun searchFiles(directory: String, query: String, limit: Int): FileSearchResultDto {
        val base = file(clean(directory) ?: directory) ?: return FileSearchResultDto()
        val git = withContext(Dispatchers.IO) { gitAvailable(base) }
        LOG.debug { "workspace file search directory=$directory query=$query limit=$limit" }
        return try {
            FileSearchResultDto(files = data(directory).files(query, limit.coerceIn(1, 200)), git = git)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            LOG.warn("File search failed for $directory", e)
            FileSearchResultDto(git = git)
        }
    }

    override suspend fun gitChanges(directory: String): String? = withContext(Dispatchers.IO) {
        val base = file(clean(directory) ?: directory) ?: return@withContext null
        if (!gitAvailable(base)) return@withContext null
        val unstaged = git(base, "diff")
        val staged = git(base, "diff", "--staged")
        val text = listOf(unstaged, staged).filter { it.isNotBlank() }.joinToString("\n")
        text.takeIf { it.isNotBlank() }?.take(DIFF_CAP)
    }

    override suspend fun branchDiff(directory: String, patches: Boolean): List<DiffFileDto> = withContext(Dispatchers.IO) {
        val dir = file(clean(directory) ?: directory) ?: return@withContext emptyList()
        GitComparison.open(dir, GitComparison.Mode.Base)?.files(patches).orEmpty()
    }

    override suspend fun localDiff(directory: String, patches: Boolean): List<DiffFileDto> = withContext(Dispatchers.IO) {
        val dir = file(clean(directory) ?: directory) ?: return@withContext emptyList()
        GitComparison.open(dir, GitComparison.Mode.Local)?.files(patches).orEmpty()
    }

    override suspend fun branchName(directory: String): String? = withContext(Dispatchers.IO) {
        val base = file(clean(directory) ?: directory) ?: return@withContext null
        if (!gitAvailable(base)) return@withContext null
        git(base, "branch", "--show-current").trim().ifBlank {
            git(base, "rev-parse", "--short", "HEAD").trim()
        }.ifBlank { null }
    }

    override suspend fun openFile(path: String, line: Int?, column: Int?, endLine: Int?): Boolean {
        val item = clean(path) ?: return false
        val target = file(item)?.takeIf { it.isAbsolute } ?: return false
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(target.toString()) ?: return false
        val project = project(target) ?: run {
            LOG.warn("No project available to open file: $path")
            return false
        }
        navigate(project, vf, line, column, endLine)
        return true
    }

    override suspend fun localConfigTarget(directory: String): ConfigTargetDto = data(directory).target("project")

    override suspend fun globalConfigTarget(): ConfigTargetDto = data().target("global")

    override suspend fun refreshConfigFiles(directory: String) {
        val paths = listOf(localConfigTarget(directory).path, globalConfigTarget().path)
        LocalFileSystem.getInstance().refreshIoFiles(paths.map { Path.of(it).toFile() }, true, true, null)
    }

    override suspend fun openLocalConfig(directory: String): Boolean = openConfig(Path.of(localConfigTarget(directory).path))

    override suspend fun openGlobalConfig(): Boolean = openConfig(Path.of(globalConfigTarget().path))

    override suspend fun setupScriptTarget(directory: String): SetupScriptTargetDto = withContext(Dispatchers.IO) {
        resolveSetupScript(repoRoot(directory), SystemInfo.isWindows)
    }

    override suspend fun openSetupScript(directory: String): Boolean {
        val resolved = withContext(Dispatchers.IO) { resolveSetupScript(repoRoot(directory), SystemInfo.isWindows) }
        val content = if (resolved.kind == SetupScriptKind.POWERSHELL) SetupScriptTemplate.POWERSHELL else SetupScriptTemplate.POSIX
        return openConfig(Path.of(resolved.path), content)
    }

    private suspend fun openConfig(path: Path, content: String = CONFIG): Boolean {
        val target = withContext(Dispatchers.IO) {
            Files.createDirectories(path.parent)
            if (!Files.exists(path)) Files.writeString(path, content, StandardCharsets.UTF_8)
            path
        }
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(target.toString()) ?: return false
        val project = project(target) ?: run {
            LOG.warn("No project available to open config file: $target")
            return false
        }
        navigate(project, vf)
        return true
    }

    private fun repoRoot(directory: String): Path =
        file(clean(directory) ?: directory)?.takeIf { it.isAbsolute } ?: Path.of(directory).normalize()

    private fun clean(path: String): String? {
        val result = normalizeWorkspacePath(path)
        if (result == null && path.isNotBlank()) LOG.debug { "Failed to normalize workspace file path: $path" }
        return result
    }

    private fun file(path: String): Path? = try {
        Path.of(path).normalize()
    } catch (e: InvalidPathException) {
        LOG.debug { "Invalid workspace file path: $path (${e.message})" }
        null
    }

    private suspend fun navigate(project: Project, file: VirtualFile, line: Int? = null, column: Int? = null, endLine: Int? = null) = suspendCancellableCoroutine { cont ->
        ApplicationManager.getApplication().invokeLater({
            if (line != null && endLine != null) {
                val editor = FileEditorManager.getInstance(project).openTextEditor(
                    OpenFileDescriptor(project, file, (line - 1).coerceAtLeast(0), 0),
                    true,
                )
                val doc = editor?.document
                if (editor != null && doc != null && doc.lineCount > 0) {
                    val start = (line - 1).coerceIn(0, doc.lineCount - 1)
                    val end = (endLine - 1).coerceIn(start, doc.lineCount - 1)
                    val from = doc.getLineStartOffset(start)
                    val to = doc.getLineEndOffset(end)
                    editor.selectionModel.setSelection(from, to)
                    editor.caretModel.moveToOffset(from)
                    editor.scrollingModel.scrollToCaret(ScrollType.CENTER)
                }
                if (cont.isActive) cont.resume(Unit)
                return@invokeLater
            }
            val descriptor = if (line == null) {
                OpenFileDescriptor(project, file)
            } else {
                OpenFileDescriptor(
                    project,
                    file,
                    (line - 1).coerceAtLeast(0),
                    (column?.minus(1))?.coerceAtLeast(0) ?: 0,
                )
            }
            descriptor.navigate(true)
            if (cont.isActive) cont.resume(Unit)
        }, ModalityState.nonModal())
    }

    private fun project(path: Path): Project? {
        if (ApplicationManager.getApplication() == null) return null
        val projects = ProjectManager.getInstance().openProjects.filter { !it.isDefault }
        val index = deepest(projects.map { it.basePath?.let(::file) }, path)
        return index?.let { projects[it] } ?: projects.firstOrNull()
    }

    private fun gitAvailable(base: Path): Boolean {
        return workspaceGitAvailable(base, gitCache)
    }

    private fun git(base: Path, vararg args: String): String {
        return runWorkspaceGit(base, *args)
    }

}

internal fun normalizeWorkspacePath(path: String): String? {
    val raw = path.trim().takeIf { it.isNotBlank() } ?: return null
    return try {
        val cut = raw.substringBefore('#').substringBefore('?')
        val decoded = if (cut.startsWith("file:")) URI(cut).path else URLDecoder.decode(cut, StandardCharsets.UTF_8)
        Path.of(decoded.replace('\\', '/')).normalize().toString()
    } catch (_: Exception) {
        null
    }
}

// Candidate names in the .kilo2/ directory, in resolution order. Disjoint by design: a POSIX script is
// never resolved on Windows and vice versa, matching the VS Code extension.
private val SETUP_POSIX_CANDIDATES = listOf(
    "setup-script" to SetupScriptKind.POSIX,
    "setup-script.sh" to SetupScriptKind.POSIX,
)
private val SETUP_WINDOWS_CANDIDATES = listOf(
    "setup-script.ps1" to SetupScriptKind.POWERSHELL,
    "setup-script.cmd" to SetupScriptKind.CMD,
    "setup-script.bat" to SetupScriptKind.CMD,
)
private val SETUP_DEFAULT_POSIX = "setup-script" to SetupScriptKind.POSIX
private val SETUP_DEFAULT_WINDOWS = "setup-script.ps1" to SetupScriptKind.POWERSHELL

/**
 * Resolves the worktree setup script in `<root>/.kilo2/` for the given platform. POSIX and Windows
 * candidate lists are disjoint (a POSIX script is never resolved on Windows and vice versa); the
 * first existing candidate wins, otherwise the platform default path is returned with `exists = false`.
 * Pure and unit-testable without touching [SystemInfo].
 */
internal fun resolveSetupScript(root: Path, windows: Boolean): SetupScriptTargetDto {
    val dir = root.resolve(".kilo2")
    val candidates = if (windows) SETUP_WINDOWS_CANDIDATES else SETUP_POSIX_CANDIDATES
    val found = candidates.firstOrNull { (name, _) -> Files.exists(dir.resolve(name)) }
    val (name, kind) = found ?: (if (windows) SETUP_DEFAULT_WINDOWS else SETUP_DEFAULT_POSIX)
    val raw = dir.resolve(name).toString()
    return SetupScriptTargetDto(raw, FileUtil.getLocationRelativeToUserHome(raw, false), found != null, kind)
}

internal fun resolveProjectDirectoryHint(hint: String, bases: List<String>): String {
    val clean = normalizeWorkspacePath(hint)
    val match = bases.firstOrNull { base ->
        val path = normalizeWorkspacePath(base)
        path != null && clean != null && path == clean
    }
    if (match != null) return match
    if (hint.isNotBlank()) return hint
    return bases.firstOrNull() ?: hint
}

internal fun workspaceGitAvailable(base: Path, cache: ConcurrentHashMap<String, Boolean> = ConcurrentHashMap()): Boolean {
    if (Files.exists(base.resolve(".git"))) return true
    return cache.getOrPut(base.toString()) {
        runWorkspaceGit(base, "rev-parse", "--is-inside-work-tree").trim() == "true"
    }
}

internal fun runWorkspaceGit(base: Path, vararg args: String): String {
    return try {
        val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(base.toFile())
        val out = CapturingProcessHandler(cmd).runProcess(5_000)
        out.stdout.takeIf { !out.isTimeout && out.exitCode == 0 }.orEmpty()
    } catch (_: Exception) {
        ""
    }
}

/**
 * Relativizes [target] against [base], returning the forward-slash relative path, or null if
 * [target] is not strictly inside [base] (path-traversal guard) or equals the base itself.
 */
internal fun relativeWithinBase(base: Path, target: Path): String? {
    val path = target.normalize()
    if (!path.startsWith(base)) return null
    val rel = base.relativize(path).toString().replace('\\', '/')
    return rel.ifBlank { null }
}

internal fun relativeWithinWorkspace(base: Path, target: Path): String? {
    val rel = relativeWithinBase(base, target) ?: return null
    if (isManagedWorktreeStorage(rel)) return null
    return rel
}

/**
 * Returns the index of the [bases] entry that is an ancestor of [path] with the most path
 * segments, or null if none matches. A managed worktree's path is a prefix match for both the
 * main checkout's base path and, when open, the worktree's own project base path; preferring the
 * deepest match routes the file to the worktree's own frame instead of always defaulting to
 * whichever project happened to open first.
 */
internal fun deepest(bases: List<Path?>, path: Path): Int? {
    var best: Int? = null
    var depth = -1
    for ((index, base) in bases.withIndex()) {
        if (base == null || !path.startsWith(base)) continue
        val count = base.nameCount
        if (count > depth) {
            depth = count
            best = index
        }
    }
    return best
}
