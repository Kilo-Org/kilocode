@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.agents.McpAuthUrlDialog
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.McpAuthEventDto
import ai.kilocode.rpc.dto.McpAuthResultDto
import com.intellij.openapi.application.EDT
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.util.concurrency.annotations.RequiresEdt
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * App-level service that centralizes remote MCP OAuth sign-in for Settings, Marketplace, and the
 * session prompt toolbar.
 */
@Service(Service.Level.APP)
class KiloMcpAuthService internal constructor(
    private val cs: CoroutineScope,
    private val behavior: KiloAgentBehaviorService?,
    private val authTimeoutMs: Long = DEFAULT_AUTH_TIMEOUT_MS,
    private val dedupeWindowMs: Long = DEFAULT_DEDUPE_WINDOW_MS,
    private val showAuthUrl: (String, String) -> Unit = { name, url -> McpAuthUrlDialog(name, url).show() },
) {
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloMcpAuthService::class.java)

        // Above the CLI's 5-minute OAuth callback timeout (packages/opencode/src/mcp/oauth-callback.ts),
        // so the CLI names the failure first.
        private const val DEFAULT_AUTH_TIMEOUT_MS = 6 * 60 * 1000L
        private const val DEFAULT_DEDUPE_WINDOW_MS = 4000L
        private const val MAX_DIRECTORIES = 64
    }

    private fun svc(): KiloAgentBehaviorService = behavior ?: service()

    private val _needsAuth = MutableStateFlow<Map<String, Set<String>>>(emptyMap())
    val needsAuth: StateFlow<Map<String, Set<String>>> = _needsAuth.asStateFlow()

    private val _busy = MutableStateFlow<Set<String>>(emptySet())
    val busy: StateFlow<Set<String>> = _busy.asStateFlow()
    private val active = ConcurrentHashMap.newKeySet<String>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    private val started = AtomicBoolean(false)
    private val lastEventUrl = AtomicReference<String?>(null)
    private val lastEventAt = AtomicLong(0)

    /** Refreshes the needs-auth set for [dir] and returns it. Returns an empty set for a blank directory. */
    suspend fun refresh(dir: String): Set<String> {
        start()
        if (dir.isBlank()) return emptySet()
        val names = attempt("mcp auth refresh failed dir=$dir", emptyList()) { svc().mcpStatus(dir) }
            .filter { it.status == "needs_auth" }
            .map { it.name }
            .toSet()
        _needsAuth.update { current ->
            val next = current + (dir to names)
            if (next.size <= MAX_DIRECTORIES) return@update next
            next.entries.drop(next.size - MAX_DIRECTORIES).associate { it.toPair() }
        }
        return names
    }

    /** Starts (or resumes) sign-in for [name] in [dir]. Single-flight per directory/name pair. */
    suspend fun signIn(dir: String, name: String): McpAuthResultDto {
        val key = busyKey(dir, name)
        if (!active.add(key)) return McpAuthResultDto("failed", null)
        _busy.update { it + key }
        return try {
            val result = withTimeoutOrNull(authTimeoutMs) {
                attempt("mcp auth signIn failed dir=$dir name=$name", McpAuthResultDto("failed", null)) {
                    svc().mcpAuthenticate(dir, name)
                }
            }
            if (result != null) {
                if (cancelled.contains(key)) return McpAuthResultDto("cancelled", null)
                return result
            }
            attempt("mcp auth timeout cleanup failed dir=$dir name=$name", false) {
                svc().mcpAuthRemove(dir, name)
            }
            McpAuthResultDto("timeout", null)
        } finally {
            active.remove(key)
            cancelled.remove(key)
            _busy.update { it - key }
            refresh(dir)
        }
    }

    /** Cancels a pending sign-in and clears any stored credentials for [name]. */
    suspend fun cancel(dir: String, name: String): Boolean {
        val key = busyKey(dir, name)
        if (active.contains(key)) cancelled.add(key)
        val removed = attempt("mcp auth cancel failed dir=$dir name=$name", false) { svc().mcpAuthRemove(dir, name) }
        if (!removed) cancelled.remove(key)
        return removed
    }

    /** Reports a sign-in [result] for [name] via a Kilo notification. Must run on EDT. */
    @RequiresEdt
    fun report(name: String, result: McpAuthResultDto) {
        when (result.status) {
            "cancelled" -> Unit
            "connected" -> KiloNotifications.info(
                KiloBundle.message("settings.agentBehavior.mcp.signIn.success", name),
            )
            "timeout" -> KiloNotifications.error(
                null,
                KiloBundle.message("settings.agentBehavior.mcp.signIn.timeout", name),
            )
            "unsupported" -> KiloNotifications.error(
                null,
                KiloBundle.message("settings.agentBehavior.mcp.signIn.unsupported", name),
            )
            else -> KiloNotifications.error(
                null,
                KiloBundle.message("settings.agentBehavior.mcp.signIn.failed", name),
                result.error,
            )
        }
    }

    private fun busyKey(dir: String, name: String) = "$dir\u0000$name"

    private suspend fun <T> attempt(message: String, fallback: T, block: suspend () -> T): T = try {
        block()
    } catch (err: CancellationException) {
        throw err
    } catch (err: Exception) {
        LOG.warn(message, err)
        fallback
    }

    private fun start() {
        if (!started.compareAndSet(false, true)) return
        cs.launch {
            durable {
                svc().mcpAuthEvents().collect { event -> onBrowserOpenFailed(event) }
            }
        }
    }

    private suspend fun onBrowserOpenFailed(event: McpAuthEventDto) {
        val now = System.currentTimeMillis()
        val prevUrl = lastEventUrl.get()
        val prevAt = lastEventAt.get()
        if (event.url == prevUrl && now - prevAt < dedupeWindowMs) return
        lastEventUrl.set(event.url)
        lastEventAt.set(now)
        withContext(Dispatchers.EDT) {
            showAuthUrl(event.name, event.url)
        }
    }
}
