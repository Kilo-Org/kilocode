@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.dto.ConfigTargetDto
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.ide.ActivityTracker
import com.intellij.openapi.components.Service
import ai.kilocode.log.KiloLog
import com.intellij.platform.project.ProjectId
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * App-level service that manages [Workspace] instances keyed by directory.
 *
 * Multiple projects sharing the same directory share the same [Workspace]
 * and its state flow. Directory resolution handles split-mode where the
 * frontend sees a synthetic path that must be resolved to the real path
 * on the backend host.
 */
@Service(Service.Level.APP)
class KiloWorkspaceService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloWorkspaceRpcApi?,
) {
    /** Platform constructor — resolves RPC from the service container. */
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloWorkspaceService::class.java)
        private val INIT = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING)
    }

    private val workspaces = ConcurrentHashMap<String, Workspace>()
    internal val localConfig = ConcurrentHashMap<String, ConfigTargetDto>()
    private val pendingLocal = ConcurrentHashMap.newKeySet<String>()
    private val pendingGlobal = AtomicBoolean(false)

    @Volatile
    internal var globalConfig: ConfigTargetDto? = null
        private set

    // ------ RPC helpers ------

    private suspend fun <T> call(block: suspend KiloWorkspaceRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloWorkspaceRpcApi.getInstance()) }
    }

    private fun <T> stream(block: suspend KiloWorkspaceRpcApi.() -> Flow<T>): Flow<T> = flow {
        val api = rpc
        if (api != null) block(api).collect { emit(it) }
        else durable { block(KiloWorkspaceRpcApi.getInstance()).collect { emit(it) } }
    }

    // ------ Public API ------

    /**
     * Get or create a [Workspace] for [directory].
     *
     * Synchronous — returns immediately. The workspace's [Workspace.state]
     * flow starts streaming lazily when first collected. Multiple callers
     * for the same directory share the same instance.
     */
    fun workspace(directory: String): Workspace {
        val workspace = workspaces.getOrPut(directory) {
            LOG.info("Creating workspace for $directory")
            val state = stream { state(directory) }
                .stateIn(cs, SharingStarted.Eagerly, INIT)
            Workspace(directory, state, { reload(directory) }) { refreshConfigFiles(directory) }
        }
        // Refresh on every workspace access so config actions reflect file system changes.
        refreshLocalConfigTarget(directory)
        refreshGlobalConfigTarget()
        return workspace
    }

    /**
     * Resolve the real project directory from a hint path.
     *
     * In split-mode the frontend sees a synthetic path (e.g.
     * `/home/.cache/JetBrains/RemoteDev/...`). The backend resolves
     * it to the actual project root on the host.
     */
    suspend fun resolveProjectDirectory(projectId: ProjectId?, hint: String): String {
        return try {
            val resolved = call { resolveProjectDirectory(projectId, hint) }
            LOG.info("Resolved project directory: projectId=$projectId hint=$hint -> $resolved")
            resolved
        } catch (e: Exception) {
            LOG.warn("Failed to resolve directory, falling back to hint=$hint", e)
            hint
        }
    }

    /** Trigger a full reload of workspace data for [directory]. */
    fun reload(directory: String) {
        cs.launch {
            try {
                call { reload(directory) }
            } catch (e: Exception) {
                LOG.warn("workspace reload failed for $directory", e)
            }
        }
    }

    suspend fun models(directory: String): ModelsWorkspaceDto {
        return try {
            call { this.models(directory) }
        } catch (e: Exception) {
            LOG.warn("models settings lookup failed for directory=$directory", e)
            ModelsWorkspaceDto(errors = listOf(LoadErrorDto(resource = "models", detail = e.message)))
        }
    }

    suspend fun files(directory: String, path: String): List<WorkspaceFileDto> {
        return try {
            call { files(directory, path) }
        } catch (e: Exception) {
            LOG.warn("workspace file lookup failed for directory=$directory path=$path", e)
            emptyList()
        }
    }

    suspend fun searchFiles(directory: String, query: String, limit: Int = 50): FileSearchResultDto {
        return try {
            call { searchFiles(directory, query, limit) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            LOG.warn("workspace file search failed for directory=$directory query=$query", e)
            FileSearchResultDto()
        }
    }

    suspend fun gitChanges(directory: String): String? {
        return try {
            call { gitChanges(directory) }
        } catch (e: Exception) {
            LOG.warn("git changes lookup failed for directory=$directory", e)
            null
        }
    }

    suspend fun openPath(directory: String, path: String, line: Int? = null, column: Int? = null): Boolean {
        val match = files(directory, path).firstOrNull() ?: return false
        return try {
            call { openFile(match.path, line, column) }
        } catch (e: Exception) {
            LOG.warn("workspace file open failed for path=${match.path}", e)
            false
        }
    }

    suspend fun localConfigTarget(directory: String): ConfigTargetDto? {
        return try {
            val target = call { this.localConfigTarget(directory) }
            localConfig[directory] = target
            target
        } catch (e: Exception) {
            LOG.warn("local config lookup failed for directory=$directory", e)
            localConfig[directory]
        }
    }

    suspend fun globalConfigTarget(): ConfigTargetDto? {
        return try {
            val target = call { this.globalConfigTarget() }
            globalConfig = target
            target
        } catch (e: Exception) {
            LOG.warn("global config lookup failed", e)
            globalConfig
        }
    }

    fun refreshLocalConfigTarget(directory: String): Job? {
        if (!pendingLocal.add(directory)) return null

        return cs.launch {
            try {
                localConfigTarget(directory)
            } finally {
                pendingLocal.remove(directory)
                ActivityTracker.getInstance().inc()
            }
        }
    }

    fun refreshGlobalConfigTarget(): Job? {
        if (!pendingGlobal.compareAndSet(false, true)) return null

        return cs.launch {
            try {
                globalConfigTarget()
            } finally {
                pendingGlobal.set(false)
                ActivityTracker.getInstance().inc()
            }
        }
    }

    fun refreshConfigFiles(directory: String): Job {
        return cs.launch {
            try {
                call { refreshConfigFiles(directory) }
                localConfigTarget(directory)
                globalConfigTarget()
            } catch (e: Exception) {
                LOG.warn("config file refresh failed for directory=$directory", e)
            } finally {
                ActivityTracker.getInstance().inc()
            }
        }
    }

    fun openLocalConfig(directory: String, done: (Boolean) -> Unit) {
        cs.launch {
            val ok = try {
                call { this.openLocalConfig(directory) }
            } catch (e: Exception) {
                LOG.warn("local config open failed for directory=$directory", e)
                false
            }
            done(ok)
        }
    }

    fun openGlobalConfig(done: (Boolean) -> Unit) {
        cs.launch {
            val ok = try {
                call { this.openGlobalConfig() }
            } catch (e: Exception) {
                LOG.warn("global config open failed", e)
                false
            }
            done(ok)
        }
    }

}
