package ai.kilocode.backend.workspace

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.app.SseEvent
import ai.kilocode.log.KiloLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.OkHttpClient
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap

/**
 * Manages [KiloBackendWorkspace] instances by directory path.
 *
 * **Not an IntelliJ service** — owned by [KiloBackendAppService] which
 * calls [start] after [KiloAppState.Ready] and [stop] on disconnect.
 *
 * Workspaces are created on demand via [get] — the first call for a
 * directory creates the workspace and triggers data loading. Subsequent
 * calls return the cached instance. Worktree directories are just
 * another path — no special handling needed.
 */
class KiloBackendWorkspaceManager(
    private val cs: CoroutineScope,
    private val sessions: KiloBackendSessionManager,
    private val log: KiloLog,
) {
    private val workspaces = ConcurrentHashMap<String, KiloBackendWorkspace>()

    private var api: DefaultApi? = null
    private var http: OkHttpClient? = null
    private var port = 0
    private var events: SharedFlow<SseEvent>? = null

    /**
     * Activate with a connected API client and SSE stream.
     * Called by [KiloBackendAppService] after [KiloAppState.Ready].
     * Clears any stale workspaces from a previous connection.
     */
    fun start(api: DefaultApi, http: OkHttpClient, port: Int, events: SharedFlow<SseEvent>) {
        stop()
        this.api = api
        this.http = http
        this.port = port
        this.events = events
        log.info("Workspace manager started")
    }

    /**
     * Deactivate all workspaces. Called by [KiloBackendAppService] on disconnect.
     */
    fun stop() {
        workspaces.values.forEach { it.stop() }
        workspaces.clear()
        api = null
        http = null
        port = 0
        events = null
        log.info("Workspace manager stopped")
    }

    /**
     * Get or create a workspace for a directory.
     * The workspace loads data immediately upon creation.
     */
    fun get(dir: String): KiloBackendWorkspace {
        val client = api ?: throw IllegalStateException("Workspace manager not started")
        val http = http ?: throw IllegalStateException("Workspace manager not started")
        val ev = events!!
        return workspaces.computeIfAbsent(dir) { d ->
            log.info("Creating workspace for $d")
            KiloBackendWorkspace(d, cs, client, http, port, ev, sessions, log).also { it.load() }
        }
    }

    /**
     * Remove any cached workspace whose directory resolves to the same real path as [dir].
     * Callers pass git porcelain paths, while workspaces are often keyed by the resolved
     * (`toRealPath`) path or the IDE base path, so an exact-string match would miss the entry
     * and leave a deleted worktree cached as Ready — still producing backend errors.
     */
    fun remove(dir: String) {
        val target = canonical(dir)
        workspaces.keys.filter { canonical(it) == target }.forEach { key ->
            log.info("Removing cached workspace for $key")
            workspaces.remove(key)?.stop()
        }
    }

    /** Resolve symlinks on the parent so `/var/...` and `/private/var/...` compare equal even after the leaf is deleted. */
    private fun canonical(dir: String): String {
        val path = Path.of(dir).normalize()
        val parent = path.parent ?: return path.toString()
        val name = path.fileName ?: return path.toString()
        val root = runCatching { if (Files.exists(parent)) parent.toRealPath() else parent }.getOrDefault(parent)
        return root.resolve(name).toString()
    }
}
