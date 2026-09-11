package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.LoadError
import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.backend.cli.buildKiloCliEnv
import ai.kilocode.backend.cli.KiloCliConfigPath
import ai.kilocode.backend.diff.GitComparison
import ai.kilocode.backend.workspace.AgentData
import ai.kilocode.backend.workspace.AgentInfo
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.backend.workspace.KiloWorkspaceState
import ai.kilocode.log.KiloLog
import ai.kilocode.jetbrains.api.model.Agent
import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.isManagedWorktreeStorage
import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
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
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.Request
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume

/**
 * Backend implementation of [KiloWorkspaceRpcApi].
 *
 * Routes through the [KiloBackendWorkspaceManager] to get a workspace
 * for the given directory. Project lookup is only used to resolve the
 * calling frontend project to the correct backend directory.
 */
class KiloWorkspaceRpcApiImpl internal constructor(
    private val svc: KiloBackendAppService? = null,
) : KiloWorkspaceRpcApi {
    companion object {
        private val LOG = KiloLog.create(KiloWorkspaceRpcApiImpl::class.java)
        private const val SCHEMA = "https://app.kilo.ai/config.json"
        private val MODERN = listOf("kilo.jsonc", "kilo.json")
        private val LEGACY = listOf("opencode.jsonc", "opencode.json")
        private val GLOBAL = MODERN + LEGACY + "config.json"
        private val LOCAL_DIRS = listOf(".kilo", ".kilocode", ".opencode")
        private const val DIFF_CAP = 200_000
        private val JSON = Json { ignoreUnknownKeys = true }
        private val CONFIG = """{
  "${'$'}schema": "$SCHEMA"
}
"""
    }

    private val app: KiloBackendAppService get() = svc ?: service()

    private val gitCache = ConcurrentHashMap<String, Boolean>()

    private val manager: KiloBackendWorkspaceManager
        get() = app.workspaces

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

    /**
     * Emits workspace state for [directory]. Waits for the app to
     * reach [KiloAppState.Ready] before creating the workspace —
     * until then, emits [KiloWorkspaceStatusDto.PENDING].
     *
     * When the app leaves Ready (e.g. during restart/reconnect),
     * the flow falls back to PENDING again and re-subscribes to
     * the new workspace once Ready returns.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    override suspend fun state(directory: String): Flow<KiloWorkspaceStateDto> =
        app.appState.flatMapLatest { state ->
            if (state is KiloAppState.Ready) {
                manager.get(directory).state.map(::dto)
            } else {
                flowOf(KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING))
            }
        }.distinctUntilChanged()

    override suspend fun reload(directory: String) {
        if (app.appState.value !is KiloAppState.Ready) return
        manager.get(directory).reload()
    }

    override suspend fun models(directory: String): ModelsWorkspaceDto {
        app.requireReady()
        val api = app.api ?: throw IllegalStateException("Kilo API is unavailable")
        val http = app.http ?: throw IllegalStateException("Kilo HTTP client is unavailable")
        val errors = mutableListOf<LoadError>()

        val prov = try {
            val raw = withContext(Dispatchers.IO) {
                val request = Request.Builder()
                    .url("http://127.0.0.1:${app.port}/provider?directory=${encode(directory)}")
                    .get()
                    .build()
                http.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) throw RuntimeException("HTTP ${response.code}: $body")
                    body
                }
            }
            KiloCliDataParser.parseProviders(raw)
        } catch (e: Exception) {
            LOG.warn("Models settings providers fetch failed for $directory: ${e.message}", e)
            errors.add(LoadError(resource = "providers", detail = e.message))
            null
        }

        val agents = try {
            val response = api.appAgents(directory = directory)
            val mapped = response.map(::agent)
            val visible = response.filter { it.mode != Agent.Mode.SUBAGENT && it.hidden != true }
            AgentData(
                agents = visible.map(::agent),
                all = mapped,
                default = visible.firstOrNull()?.name ?: "code",
            )
        } catch (e: Exception) {
            LOG.warn("Models settings agents fetch failed for $directory: ${e.message}", e)
            errors.add(LoadError(resource = "agents", detail = e.message))
            null
        }

        return ModelsWorkspaceDto(
            providers = prov?.let(KiloWorkspaceDtoMapper::providers),
            agents = agents?.let(KiloWorkspaceDtoMapper::agents),
            errors = errors.map(KiloWorkspaceDtoMapper::error),
        )
    }

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
        return searchKilo(directory, query, limit, git)
    }

    private suspend fun searchKilo(directory: String, query: String, limit: Int, git: Boolean): FileSearchResultDto {
        return try {
            val cap = limit.coerceIn(1, 200)
            val (files, dirs) = coroutineScope {
                val files = async { kiloResults(directory, query, "file", cap, false) }
                val dirs = async { kiloResults(directory, query, "directory", cap, true) }
                files.await() to dirs.await()
            }
            val found = linkedMapOf<String, WorkspaceFileDto>()
            (dirs + files).forEach { file -> found.putIfAbsent(file.path, file) }
            FileSearchResultDto(files = found.values.take(cap), git = git)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            LOG.warn("Kilo Core file search failed for directory=$directory query=$query", e)
            FileSearchResultDto(git = git)
        }
    }

    private suspend fun kiloResults(
        directory: String,
        query: String,
        type: String,
        limit: Int,
        dir: Boolean,
    ): List<WorkspaceFileDto> {
        val http = app.http ?: throw IllegalStateException("Kilo HTTP client is unavailable")
        val raw = withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("http://127.0.0.1:${app.port}/find/file?directory=${encode(directory)}&query=${encode(query)}&type=$type&limit=$limit")
                .get()
                .build()
            http.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) throw RuntimeException("HTTP ${response.code}: $body")
                body
            }
        }
        return JSON.decodeFromString<List<String>>(raw)
            .asSequence()
            .map { it.trimEnd('/') }
            .filter { it.isNotBlank() && !isManagedWorktreeStorage(it) }
            .map { WorkspaceFileDto(it, it.substringAfterLast('/'), dir) }
            .toList()
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

    override suspend fun localConfigTarget(directory: String): ConfigTargetDto = withContext(Dispatchers.IO) {
        target(localConfig(directory))
    }

    override suspend fun globalConfigTarget(): ConfigTargetDto = withContext(Dispatchers.IO) {
        target(globalConfig())
    }

    override suspend fun refreshConfigFiles(directory: String) {
        val files = withContext(Dispatchers.IO) {
            listOf(localConfig(directory), globalConfig()).map { it.toFile() }
        }
        LocalFileSystem.getInstance().refreshIoFiles(files, true, true, null)
    }

    override suspend fun openLocalConfig(directory: String): Boolean = openConfig(withContext(Dispatchers.IO) {
        localConfig(directory)
    })

    override suspend fun openGlobalConfig(): Boolean = openConfig(withContext(Dispatchers.IO) {
        globalConfig()
    })

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

    private fun localConfig(directory: String): Path {
        val root = repoRoot(directory)
        val dirs = LOCAL_DIRS.map { root.resolve(it) } + root
        val found = dirs.asSequence()
            .flatMap { dir -> (MODERN + LEGACY).asSequence().map { name -> dir.resolve(name) } }
            .firstOrNull { Files.exists(it) }
        return found ?: root.resolve(".kilo").resolve("kilo.jsonc")
    }

    private fun globalConfig(): Path {
        val env = buildKiloCliEnv("config")
        val root = KiloCliConfigPath.resolve(env).toPath().normalize()
        return GLOBAL.asSequence()
            .map { root.resolve(it) }
            .firstOrNull { Files.exists(it) }
            ?: root.resolve("kilo.jsonc")
    }

    private fun target(path: Path): ConfigTargetDto {
        val raw = path.toString()
        return ConfigTargetDto(raw, FileUtil.getLocationRelativeToUserHome(raw, false), Files.exists(path))
    }

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

    private fun agent(a: Agent) = AgentInfo(
        name = a.name,
        displayName = a.displayName,
        description = a.description,
        mode = a.mode.value,
        native = a.native,
        hidden = a.hidden,
        color = a.color,
        deprecated = a.deprecated,
    )

    // ------ mapping: domain model → DTO ------

    private fun dto(state: KiloWorkspaceState): KiloWorkspaceStateDto =
        when (state) {
            KiloWorkspaceState.Pending -> KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING)
            is KiloWorkspaceState.Loading -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.LOADING,
                progress = KiloWorkspaceDtoMapper.progress(state.progress),
            )
            is KiloWorkspaceState.Ready -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.READY,
                providers = KiloWorkspaceDtoMapper.providers(state.providers),
                agents = KiloWorkspaceDtoMapper.agents(state.agents),
                commands = state.commands.map(KiloWorkspaceDtoMapper::command),
                skills = state.skills.map(KiloWorkspaceDtoMapper::skill),
                warnings = state.warnings.map(KiloWorkspaceDtoMapper::warning),
            )
            is KiloWorkspaceState.Unsupported -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.UNSUPPORTED,
                error = state.reason,
            )
            is KiloWorkspaceState.Missing -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.MISSING,
                error = state.path,
            )
            is KiloWorkspaceState.Error -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.ERROR,
                error = state.message,
                errors = state.errors.map(KiloWorkspaceDtoMapper::error),
            )
        }
}

private fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8)

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

// Candidate names in the .kilo/ directory, in resolution order. Disjoint by design: a POSIX script is
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
 * Resolves the worktree setup script in `<root>/.kilo/` for the given platform. POSIX and Windows
 * candidate lists are disjoint (a POSIX script is never resolved on Windows and vice versa); the
 * first existing candidate wins, otherwise the platform default path is returned with `exists = false`.
 * Pure and unit-testable without touching [SystemInfo].
 */
internal fun resolveSetupScript(root: Path, windows: Boolean): SetupScriptTargetDto {
    val dir = root.resolve(".kilo")
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
