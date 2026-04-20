@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.Disposer
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

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
        private val LOG = Logger.getInstance(KiloWorkspaceService::class.java)
        private val INIT = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING)
    }

    private val workspaces = ConcurrentHashMap<String, Entry>()

    private class Entry(
        val scope: CoroutineScope,
        val workspace: Workspace,
    ) {
        private val refs = AtomicInteger(0)

        fun retain() {
            refs.incrementAndGet()
        }

        fun release(): Int = refs.decrementAndGet()
    }

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
     * Get or create a [Workspace] for [directory] whose lifetime is tied to [parent].
     *
     * Synchronous — returns immediately. The workspace's [Workspace.state]
     * flow starts streaming lazily when first collected. Multiple callers
     * for the same directory share the same instance.
     */
    fun workspace(directory: String, parent: Disposable): Workspace {
        val entry = workspaces.compute(directory) { _, current ->
            val next = current ?: create(directory)
            next.retain()
            next
        }!!
        Disposer.register(parent) { release(directory, entry) }
        return entry.workspace
    }

    private fun create(directory: String): Entry {
        LOG.info("Creating workspace for $directory")
        val job = SupervisorJob(cs.coroutineContext[Job])
        val scope = CoroutineScope(cs.coroutineContext + job)
        val state = stream { state(directory) }
            .stateIn(scope, SharingStarted.WhileSubscribed(5_000), INIT)
        return Entry(scope, Workspace(directory, state))
    }

    private fun release(directory: String, entry: Entry) {
        workspaces.computeIfPresent(directory) { _, current ->
            if (current !== entry) return@computeIfPresent current
            if (current.release() > 0) return@computeIfPresent current
            LOG.info("Disposing workspace for $directory")
            current.scope.cancel()
            null
        }
    }

    internal fun cachedWorkspaces(): Int = workspaces.size

    /**
     * Resolve the real project directory from a hint path.
     *
     * In split-mode the frontend sees a synthetic path (e.g.
     * `/home/.cache/JetBrains/RemoteDev/...`). The backend resolves
     * it to the actual project root on the host.
     */
    suspend fun resolveProjectDirectory(hint: String): String {
        return try {
            val resolved = call { resolveProjectDirectory(hint) }
            LOG.info("Resolved project directory: hint=$hint → $resolved")
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
}
