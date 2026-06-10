@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.LoadError
import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.backend.cli.buildKiloCliEnv
import ai.kilocode.backend.cli.KiloCliConfigPath
import ai.kilocode.backend.workspace.AgentData
import ai.kilocode.backend.workspace.AgentInfo
import ai.kilocode.backend.workspace.KiloBackendWorkspaceManager
import ai.kilocode.backend.workspace.KiloWorkspaceState
import ai.kilocode.log.KiloLog
import ai.kilocode.jetbrains.api.model.Agent
import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.LocalFileSystem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.InvalidPathException
import java.nio.file.Path
import kotlin.coroutines.resume

/**
 * Backend implementation of [KiloWorkspaceRpcApi].
 *
 * Routes through the [KiloBackendWorkspaceManager] to get a workspace
 * for the given directory. No [ProjectManager] dependency — any
 * directory (including worktrees) can get a workspace.
 */
class KiloWorkspaceRpcApiImpl : KiloWorkspaceRpcApi {
    companion object {
        private val LOG = KiloLog.create(KiloWorkspaceRpcApiImpl::class.java)
        private const val SCHEMA = "https://app.kilo.ai/config.json"
        private val MODERN = listOf("kilo.jsonc", "kilo.json")
        private val LEGACY = listOf("opencode.jsonc", "opencode.json")
        private val GLOBAL = MODERN + LEGACY + "config.json"
        private val LOCAL_DIRS = listOf(".kilo", ".kilocode", ".opencode")
        private val CONFIG = """{
  "${'$'}schema": "$SCHEMA"
}
"""
    }

    private val app: KiloBackendAppService get() = service()

    private val manager: KiloBackendWorkspaceManager
        get() = app.workspaces

    override suspend fun resolveProjectDirectory(hint: String): String {
        // In monolith mode, find the open project whose basePath matches the hint.
        // In split mode, the backend's project.basePath is the real directory.
        val projects = ProjectManager.getInstance().openProjects
        val match = projects.firstOrNull { !it.isDefault }
        return match?.basePath ?: hint
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
        val bases = listOf(directory) + ProjectManager.getInstance().openProjects
            .asSequence()
            .filter { !it.isDefault }
            .mapNotNull { it.basePath }
            .filter { it != directory }
            .toList()
        val paths = if (file.isAbsolute) listOf(file) else bases.mapNotNull { base ->
            file(base)?.resolve(file)?.normalize()
        }
        val found = linkedMapOf<String, WorkspaceFileDto>()
        for (target in paths) {
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(target.toString()) ?: continue
            found[vf.path] = WorkspaceFileDto(vf.path, vf.name, vf.isDirectory)
        }
        return found.values.toList()
    }

    override suspend fun openFile(path: String): Boolean {
        val item = clean(path) ?: return false
        val target = file(item)?.takeIf { it.isAbsolute } ?: return false
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(target.toString()) ?: return false
        val project = project(target) ?: run {
            LOG.warn("No project available to open file: $path")
            return false
        }
        navigate(project, vf)
        return true
    }

    override suspend fun localConfigTarget(directory: String): ConfigTargetDto = withContext(Dispatchers.IO) {
        target(localConfig(directory))
    }

    override suspend fun globalConfigTarget(): ConfigTargetDto = withContext(Dispatchers.IO) {
        target(globalConfig())
    }

    override suspend fun openLocalConfig(directory: String): Boolean = openConfig(withContext(Dispatchers.IO) {
        localConfig(directory)
    })

    override suspend fun openGlobalConfig(): Boolean = openConfig(withContext(Dispatchers.IO) {
        globalConfig()
    })

    private suspend fun openConfig(path: Path): Boolean {
        val target = withContext(Dispatchers.IO) {
            Files.createDirectories(path.parent)
            if (!Files.exists(path)) Files.writeString(path, CONFIG, StandardCharsets.UTF_8)
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

    private fun localConfig(directory: String): Path {
        val root = file(clean(directory) ?: directory)?.takeIf { it.isAbsolute } ?: Path.of(directory).normalize()
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
        val raw = path.trim().takeIf { it.isNotBlank() } ?: return null
        return try {
            val cut = raw.substringBefore('#').substringBefore('?')
            val decoded = if (cut.startsWith("file:")) URI(cut).path else URLDecoder.decode(cut, StandardCharsets.UTF_8)
            Path.of(decoded.replace('\\', '/')).normalize().toString()
        } catch (e: Exception) {
            LOG.debug { "Failed to normalize workspace file path: $path (${e.message})" }
            null
        }
    }

    private fun file(path: String): Path? = try {
        Path.of(path).normalize()
    } catch (e: InvalidPathException) {
        LOG.debug { "Invalid workspace file path: $path (${e.message})" }
        null
    }

    private suspend fun navigate(project: Project, file: VirtualFile) = suspendCancellableCoroutine { cont ->
        ApplicationManager.getApplication().invokeLater({
            OpenFileDescriptor(project, file).navigate(true)
            if (cont.isActive) cont.resume(Unit)
        }, ModalityState.any())
    }

    private fun project(path: Path): Project? {
        val projects = ProjectManager.getInstance().openProjects.filter { !it.isDefault }
        return projects.firstOrNull { item ->
            val base = item.basePath?.let(::file) ?: return@firstOrNull false
            path.startsWith(base)
        } ?: projects.firstOrNull()
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
            )
            is KiloWorkspaceState.Error -> KiloWorkspaceStateDto(
                status = KiloWorkspaceStatusDto.ERROR,
                error = state.message,
                errors = state.errors.map(KiloWorkspaceDtoMapper::error),
            )
        }
}

private fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8)
