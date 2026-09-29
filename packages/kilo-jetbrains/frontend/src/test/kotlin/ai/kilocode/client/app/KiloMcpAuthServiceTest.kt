package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.rpc.dto.McpAuthEventDto
import ai.kilocode.rpc.dto.McpAuthResultDto
import ai.kilocode.rpc.dto.McpStatusDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/**
 * Covers [KiloMcpAuthService].
 *
 * The service takes test-only constructor seams for the auth timeout, the dedupe window, and the
 * browser-open-failed dialog action, so this timeout and dedupe behavior can be exercised directly
 * instead of waiting out the real 6-minute production timeout or opening a real modal dialog.
 */
@Suppress("UnstableApiUsage")
class KiloMcpAuthServiceTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeAgentBehaviorRpcApi
    private lateinit var behavior: KiloAgentBehaviorService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeAgentBehaviorRpcApi()
        behavior = KiloAgentBehaviorService(scope, rpc)
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    private fun service(
        authTimeoutMs: Long = 60_000L,
        dedupeWindowMs: Long = 4000L,
        showAuthUrl: (String, String) -> Unit = { _, _ -> },
    ) = KiloMcpAuthService(scope, behavior, authTimeoutMs, dedupeWindowMs, showAuthUrl)

    private fun settle() = runBlocking {
        repeat(3) {
            delay(50)
            UIUtil.dispatchAllInvocationEvents()
        }
    }

    fun `test refresh collects only needs_auth servers`() = runBlocking(Dispatchers.Default) {
        rpc.mcps = listOf(
            McpStatusDto("linear", "needs_auth"),
            McpStatusDto("filesystem", "connected"),
            McpStatusDto("github", "needs_auth"),
        )
        val service = service()

        val needs = service.refresh("/test")

        assertEquals(setOf("linear", "github"), needs)
        assertEquals(setOf("linear", "github"), service.needsAuth.value["/test"])
    }

    fun `test refresh with blank directory returns empty and does not call rpc`() = runBlocking(Dispatchers.Default) {
        rpc.mcps = listOf(McpStatusDto("linear", "needs_auth"))
        val service = service()

        val needs = service.refresh("")

        assertTrue(needs.isEmpty())
        assertTrue(rpc.mcpCalls.isEmpty())
    }

    fun `test refresh bounds directory state`() = runBlocking(Dispatchers.Default) {
        val service = service()
        rpc.mcps = listOf(McpStatusDto("linear", "needs_auth"))

        repeat(65) { service.refresh("/test/$it") }

        assertEquals(64, service.needsAuth.value.size)
        assertFalse(service.needsAuth.value.containsKey("/test/0"))
        assertTrue(service.needsAuth.value.containsKey("/test/64"))
    }

    fun `test signIn returns connected result and clears needs_auth`() = runBlocking(Dispatchers.Default) {
        rpc.mcps = listOf(McpStatusDto("linear", "needs_auth"))
        val service = service()
        service.refresh("/test")
        rpc.mcpAuthenticateResult = McpAuthResultDto("connected")
        rpc.mcps = listOf(McpStatusDto("linear", "connected"))

        val result = service.signIn("/test", "linear")

        assertEquals("connected", result.status)
        assertTrue(service.needsAuth.value["/test"].orEmpty().isEmpty())
    }

    fun `test signIn is single-flight per directory and name`() = runBlocking(Dispatchers.Default) {
        // Gates the fake's authenticate call itself, so signIn has already recorded the busy key
        // (which happens before the authenticate call) by the time the second call races it.
        val gate = CompletableDeferred<Unit>()
        rpc.mcpAuthenticateResult = McpAuthResultDto("connected")
        rpc.beforeAuthenticate = { gate.await() }
        val service = service()
        val first = async { service.signIn("/test", "linear") }
        withTimeout(5000) { while (!rpc.mcpAuthenticateStarted) delay(5) }

        // The first call has claimed the busy key and is blocked inside authenticate; the second
        // call must see the busy key and refuse to start a duplicate authenticate request.
        val second = service.signIn("/test", "linear")
        assertEquals("failed", second.status)
        assertEquals(0, rpc.mcpAuthentications.size)

        gate.complete(Unit)
        val firstResult = first.await()
        assertEquals("connected", firstResult.status)
        assertEquals(1, rpc.mcpAuthentications.size)
    }

    fun `test signIn on timeout removes credentials and reports timeout`() = runBlocking(Dispatchers.Default) {
        // The fake's mcpAuthenticate never returns, so withTimeoutOrNull must fire first and the
        // service must fall back to removing credentials and reporting a timeout status.
        val slowRpc = SlowAuthenticateRpc(CompletableDeferred())
        val slowBehavior = KiloAgentBehaviorService(scope, slowRpc)
        val slowService = KiloMcpAuthService(scope, slowBehavior, authTimeoutMs = 100L, dedupeWindowMs = 4000L) { _, _ -> }

        val result = slowService.signIn("/test", "linear")

        assertEquals("timeout", result.status)
        assertEquals(listOf("linear"), slowRpc.mcpAuthRemovals)
    }

    fun `test cancel calls mcpAuthRemove`() = runBlocking(Dispatchers.Default) {
        rpc.mcpAuthRemoveResult = true
        val service = service()

        val ok = service.cancel("/test", "linear")

        assertTrue(ok)
        assertEquals(listOf("linear"), rpc.mcpAuthRemovals)
    }

    fun `test reset reconnects and refreshes needs auth state`() = runBlocking(Dispatchers.Default) {
        rpc.mcps = listOf(McpStatusDto("linear", "connected"))
        rpc.afterMcpConnect = { _, name -> rpc.mcps = listOf(McpStatusDto(name, "needs_auth")) }
        val service = service()

        assertTrue(service.reset("/test", "linear"))

        assertEquals(listOf("linear"), rpc.mcpAuthRemovals)
        assertEquals(listOf("linear"), rpc.mcpDisconnects)
        assertEquals(listOf("linear"), rpc.mcpConnects)
        assertEquals(setOf("linear"), service.needsAuth.value["/test"])
    }

    fun `test cancelling an active sign in returns a quiet cancelled result`() = runBlocking(Dispatchers.Default) {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeAuthenticate = { gate.await() }
        rpc.mcpAuthenticateResult = McpAuthResultDto("failed", "Browser authorization failed: Authorization cancelled")
        val service = service()
        val result = async { service.signIn("/test", "linear") }
        withTimeout(5000) { while (!rpc.mcpAuthenticateStarted) delay(5) }

        assertTrue(service.cancel("/test", "linear"))
        gate.complete(Unit)

        assertEquals("cancelled", result.await().status)
        assertEquals(listOf("linear"), rpc.mcpAuthRemovals)
    }

    fun `test duplicate browser open failed events within the dedupe window are collapsed`() {
        val opened = mutableListOf<Pair<String, String>>()
        val service = service(dedupeWindowMs = 60_000L, showAuthUrl = { name, url -> opened.add(name to url) })

        runBlocking(Dispatchers.Default) {
            service.refresh("/test")
        }
        settle()

        runBlocking(Dispatchers.Default) {
            rpc.mcpAuthEventsFlow.emit(McpAuthEventDto("linear", "https://auth.example.test/authorize"))
        }
        settle()
        runBlocking(Dispatchers.Default) {
            rpc.mcpAuthEventsFlow.emit(McpAuthEventDto("linear", "https://auth.example.test/authorize"))
        }
        settle()

        assertEquals(listOf("linear" to "https://auth.example.test/authorize"), opened)
    }

    fun `test browser open failed events with different urls both open`() {
        val opened = mutableListOf<Pair<String, String>>()
        val service = service(dedupeWindowMs = 0L, showAuthUrl = { name, url -> opened.add(name to url) })

        runBlocking(Dispatchers.Default) {
            service.refresh("/test")
        }
        settle()

        runBlocking(Dispatchers.Default) {
            rpc.mcpAuthEventsFlow.emit(McpAuthEventDto("linear", "https://auth.example.test/authorize?a=1"))
        }
        settle()
        runBlocking(Dispatchers.Default) {
            rpc.mcpAuthEventsFlow.emit(McpAuthEventDto("linear", "https://auth.example.test/authorize?a=2"))
        }
        settle()

        assertEquals(2, opened.size)
    }

    /** A [KiloAgentBehaviorService] backed by an RPC fake whose `mcpAuthenticate` never returns. */
    private class SlowAuthenticateRpc(private val never: CompletableDeferred<McpAuthResultDto>) :
        ai.kilocode.rpc.KiloAgentBehaviorRpcApi by FakeAgentBehaviorRpcApi() {
        val mcpAuthRemovals = mutableListOf<String>()

        override suspend fun mcpAuthenticate(directory: String, name: String): McpAuthResultDto = never.await()

        override suspend fun mcpAuthRemove(directory: String, name: String): Boolean {
            mcpAuthRemovals.add(name)
            return true
        }
    }
}
