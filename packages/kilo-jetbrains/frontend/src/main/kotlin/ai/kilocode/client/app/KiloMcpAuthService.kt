@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.agents.McpAuthUrlDialog
import ai.kilocode.client.util.webUrl
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.McpAuthEventDto
import ai.kilocode.rpc.dto.McpAuthResultDto
import ai.kilocode.rpc.dto.McpStatusDto
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.EDT
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.util.concurrency.annotations.RequiresEdt
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
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
    private val active = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private val cancelled = ConcurrentHashMap.newKeySet<CompletableDeferred<Unit>>()
    private val dropped = ConcurrentHashMap.newKeySet<CompletableDeferred<Unit>>()

    private val started = AtomicBoolean(false)
    private val lastEventUrl = AtomicReference<String?>(null)
    private val lastEventAt = AtomicLong(0)

    /** Refreshes the needs-auth set for [dir] and returns it. Returns an empty set for a blank directory. */
    suspend fun refresh(dir: String): Set<String> {
        start()
        if (dir.isBlank()) return emptySet()
        return sync(dir, attempt("mcp auth refresh failed dir=$dir", emptyList()) { svc().mcpStatus(dir) })
    }

    /** Records needs-auth state for [dir] from an already-fetched status list and returns the names. */
    fun sync(dir: String, statuses: List<McpStatusDto>): Set<String> {
        if (dir.isBlank()) return emptySet()
        val names = statuses.filter { it.status == "needs_auth" }.map { it.name }.toSet()
        updateNeedsAuth(dir, names)
        return names
    }

    /** Starts (or resumes) sign-in for [name] in [dir]. Single-flight per directory/name pair. */
    suspend fun signIn(dir: String, name: String): McpAuthResultDto {
        val key = busyKey(dir, name)
        val abort = CompletableDeferred<Unit>()
        if (active.putIfAbsent(key, abort) != null) return McpAuthResultDto("failed", null)
        _busy.update { it + key }
        return try {
            val result = withTimeoutOrNull(authTimeoutMs) { race(dir, name, abort) }
            if (result != null) {
                if (abort.isCompleted) return McpAuthResultDto("cancelled", null)
                return result
            }
            // Cancel rather than remove: a timeout should abandon this attempt, not discard
            // credentials the user may already have from an earlier successful sign-in.
            attempt("mcp auth timeout cleanup failed dir=$dir name=$name", false) {
                svc().mcpAuthCancel(dir, name)
            }
            McpAuthResultDto("timeout", null)
        } finally {
            val gone = dropped.remove(abort)
            cancelled.remove(abort)
            release(key, abort)
            // A forgotten server is mid-removal, so re-reading its runtime status here would race the
            // removal RPC and put the name straight back into needsAuth.
            if (!gone) refresh(dir)
        }
    }

    /**
     * Waits for the CLI's authenticate reply or for [abort], whichever lands first.
     *
     * `mcpAuthenticate` only resolves when the OAuth callback completes or the CLI's own 5-minute
     * window closes, so without this race a cancel leaves the caller - and the busy flag the prompt
     * indicator reads - stuck for minutes after the user already gave up.
     */
    private suspend fun race(
        dir: String,
        name: String,
        abort: CompletableDeferred<Unit>,
    ): McpAuthResultDto = coroutineScope {
        val rpc = async {
            attempt("mcp auth signIn failed dir=$dir name=$name", McpAuthResultDto("failed", null)) {
                svc().mcpAuthenticate(dir, name)
            }
        }
        try {
            select {
                abort.onAwait { McpAuthResultDto("cancelled", null) }
                rpc.onAwait { it }
            }
        } finally {
            rpc.cancel()
        }
    }

    private fun release(key: String, abort: CompletableDeferred<Unit>) {
        if (active.remove(key, abort)) _busy.update { it - key }
    }

    /** Cancels a pending sign-in for [name], keeping any stored credentials. */
    suspend fun cancel(dir: String, name: String): Boolean {
        val abort = active[busyKey(dir, name)]
        if (abort != null) cancelled.add(abort)
        val stopped = attempt("mcp auth cancel failed dir=$dir name=$name", false) { svc().mcpAuthCancel(dir, name) }
        // Abandon the attempt even when the CLI refuses the cancel. A rejected cancel means the flow
        // is already unreachable, and leaving it busy strands the Settings progress overlay and the
        // prompt indicator on "Signing in..." until the six-minute timeout. The trailing refresh in
        // signIn's finally still reports the truth if the flow somehow completes anyway.
        abort?.complete(Unit)
        return stopped
    }

    /**
     * Drops every sign-in trace of [name] in [dir], for a server that is being removed.
     *
     * Call this before the removal lands: while the CLI still knows the name it can release the
     * pending OAuth flow and its callback port, and afterwards `/mcp/{name}/auth/cancel` only
     * answers 404. The local state is cleared regardless of what the CLI reports, because a removed
     * server can never finish signing in.
     */
    suspend fun forget(dir: String, name: String) {
        val key = busyKey(dir, name)
        val abort = active[key]
        if (abort != null) {
            dropped.add(abort)
            attempt("mcp auth forget failed dir=$dir name=$name", false) { svc().mcpAuthCancel(dir, name) }
            abort.complete(Unit)
            release(key, abort)
        }
        val names = _needsAuth.value[dir].orEmpty()
        if (name in names) updateNeedsAuth(dir, names - name)
    }

    /** Clears stored credentials and reconnects so the runtime immediately reports [needsAuth]. */
    suspend fun reset(dir: String, name: String): Boolean {
        val removed = attempt("mcp auth reset failed dir=$dir name=$name", false) { svc().mcpAuthRemove(dir, name) }
        if (!removed) return false
        active[busyKey(dir, name)]?.let { abort ->
            cancelled.add(abort)
            abort.complete(Unit)
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
