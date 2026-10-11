@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.agents.McpAuthUrlDialog
import ai.kilocode.client.util.webUrl
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.McpAuthEventDto
import ai.kilocode.rpc.dto.McpAuthResultDto
import com.intellij.ide.BrowserUtil
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
    private val openUrl: (String) -> Unit = { url -> BrowserUtil.browse(url) },
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
    private val active = ConcurrentHashMap<String, Any>()
    private val cancelled = ConcurrentHashMap.newKeySet<Any>()

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
        updateNeedsAuth(dir, names)
        return names
    }

    /** Starts (or resumes) sign-in for [name] in [dir]. Single-flight per directory/name pair. */
    suspend fun signIn(dir: String, name: String): McpAuthResultDto {
        val key = busyKey(dir, name)
        val token = Any()
        if (active.putIfAbsent(key, token) != null) return McpAuthResultDto("failed", null)
        _busy.update { it + key }
        return try {
            val result = withTimeoutOrNull(authTimeoutMs) {
                attempt("mcp auth signIn failed dir=$dir name=$name", McpAuthResultDto("failed", null)) {
                    svc().mcpAuthenticate(dir, name)
                }
            }
            if (result != null) {
                if (cancelled.contains(token)) return McpAuthResultDto("cancelled", null)
                return result
            }
            // Cancel rather than remove: a timeout should abandon this attempt, not discard
            // credentials the user may already have from an earlier successful sign-in.
            attempt("mcp auth timeout cleanup failed dir=$dir name=$name", false) {
                svc().mcpAuthCancel(dir, name)
            }
            McpAuthResultDto("timeout", null)
        } finally {
            active.remove(key, token)
            cancelled.remove(token)
            _busy.update { it - key }
            refresh(dir)
        }
    }

    /** Cancels a pending sign-in for [name], keeping any stored credentials. */
    suspend fun cancel(dir: String, name: String): Boolean {
        val key = busyKey(dir, name)
        val token = active[key]
        if (token != null) cancelled.add(token)
        val stopped = attempt("mcp auth cancel failed dir=$dir name=$name", false) { svc().mcpAuthCancel(dir, name) }
        if (!stopped && token != null) cancelled.remove(token)
        return stopped
    }

    /** Clears stored credentials and reconnects so the runtime immediately reports [needsAuth]. */
    suspend fun reset(dir: String, name: String): Boolean {
        val key = busyKey(dir, name)
        val auth = active[key]
        if (auth != null) cancelled.add(auth)
        val removed = attempt("mcp auth reset failed dir=$dir name=$name", false) { svc().mcpAuthRemove(dir, name) }
        if (!removed) {
            if (auth != null) cancelled.remove(auth)
            return false
        }
        var reconnected = false
        try {
            val disconnected = attempt("mcp disconnect after auth reset failed dir=$dir name=$name", false) {
                svc().mcpDisconnect(dir, name)
            }
            val connected = attempt("mcp connect after auth reset failed dir=$dir name=$name", false) {
                svc().mcpConnect(dir, name)
            }
            reconnected = disconnected && connected
            return reconnected
        } finally {
            refresh(dir)
            if (!reconnected) markNeedsAuth(dir, name)
        }
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
            "not_found" -> KiloNotifications.error(
                null,
                KiloBundle.message("settings.agentBehavior.mcp.signIn.notFound", name),
            )
            else -> KiloNotifications.error(
                null,
                KiloBundle.message("settings.agentBehavior.mcp.signIn.failed", name),
                result.error,
            )
        }
    }

    private fun busyKey(dir: String, name: String) = "$dir\u0000$name"

    private fun markNeedsAuth(dir: String, name: String) {
        updateNeedsAuth(dir, _needsAuth.value[dir].orEmpty() + name)
    }

    private fun updateNeedsAuth(dir: String, names: Set<String>) {
        _needsAuth.update { current ->
            val next = current + (dir to names)
            if (next.size <= MAX_DIRECTORIES) return@update next
            next.entries.drop(next.size - MAX_DIRECTORIES).associate { it.toPair() }
        }
    }

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
                svc().mcpAuthEvents().collect { event -> onAuthUrl(event) }
            }
        }
    }

    /**
     * Puts an authorization URL in front of the user.
     *
     * For [McpAuthEventDto.external] the CLI deliberately did not open a browser, so the client
     * does it here and only falls back to the dialog when that fails. Otherwise the CLI already
     * tried and failed, and the dialog is the remaining option.
     *
     * The URL comes from the remote server's `authorization_endpoint`, so a non-web scheme is
     * dropped outright rather than opened or offered in the dialog.
     */
    private suspend fun onAuthUrl(event: McpAuthEventDto) {
        if (!webUrl(event.url)) {
            LOG.warn("mcp auth url rejected name=${event.name}: not an http(s) URL")
            return
        }
        val now = System.currentTimeMillis()
        val prevUrl = lastEventUrl.get()
        val prevAt = lastEventAt.get()
        if (event.url == prevUrl && now - prevAt < dedupeWindowMs) return
        lastEventUrl.set(event.url)
        lastEventAt.set(now)
        if (event.external && browse(event.url)) return
        withContext(Dispatchers.EDT) {
            showAuthUrl(event.name, event.url)
        }
    }

    // The authorization URL carries the OAuth `state` and other single-use parameters, so it is
    // never logged; the server name is enough to identify which sign-in failed to open.
    private fun browse(url: String): Boolean = try {
        openUrl(url)
        true
    } catch (err: CancellationException) {
        throw err
    } catch (err: Exception) {
        LOG.warn("mcp auth browser open failed", err)
        false
    }
}
