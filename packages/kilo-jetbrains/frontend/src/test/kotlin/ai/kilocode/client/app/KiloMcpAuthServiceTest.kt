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
        openUrl: (String) -> Unit = { },
    ) = KiloMcpAuthService(scope, behavior, authTimeoutMs, dedupeWindowMs, showAuthUrl, openUrl)

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

    /**
     * A timeout must abandon the attempt without discarding credentials, so it cancels rather than
     * deleting the stored sign-in.
     */
    fun `test signIn on timeout cancels the flow and reports timeout`() = runBlocking(Dispatchers.Default) {
        val slowRpc = SlowAuthenticateRpc(CompletableDeferred())
        val slowBehavior = KiloAgentBehaviorService(scope, slowRpc)
        val slowService = KiloMcpAuthService(scope, slowBehavior, authTimeoutMs = 100L, dedupeWindowMs = 4000L)

        val result = slowService.signIn("/test", "linear")

        assertEquals("timeout", result.status)
        assertEquals(listOf("linear"), slowRpc.mcpAuthCancels)
        assertTrue("a timeout must not delete credentials", slowRpc.mcpAuthRemovals.isEmpty())
    }

    fun `test cancel calls mcpAuthCancel and keeps credentials`() = runBlocking(Dispatchers.Default) {
        rpc.mcpAuthCancelResult = true
        val service = service()

        val ok = service.cancel("/test", "linear")

        assertTrue(ok)
        assertEquals(listOf("linear"), rpc.mcpAuthCancels)
        assertTrue("cancel must not delete credentials", rpc.mcpAuthRemovals.isEmpty())
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

    fun `test reset marks an active sign in as quietly cancelled`() = runBlocking(Dispatchers.Default) {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeAuthenticate = { gate.await() }
        rpc.mcpAuthenticateResult = McpAuthResultDto("failed", "Authorization cancelled")
        rpc.afterMcpConnect = { _, name -> rpc.mcps = listOf(McpStatusDto(name, "needs_auth")) }
        val service = service()
        val signIn = async { service.signIn("/test", "linear") }
        withTimeout(5000) { while (!rpc.mcpAuthenticateStarted) delay(5) }

        assertTrue(service.reset("/test", "linear"))
        gate.complete(Unit)

        assertEquals("cancelled", signIn.await().status)
    }

    fun `test reset keeps needs auth state when reconnect fails`() = runBlocking(Dispatchers.Default) {
        rpc.mcps = listOf(McpStatusDto("linear", "connected"))
        rpc.mcpConnectError = RuntimeException("offline")
        val service = service()

        assertFalse(service.reset("/test", "linear"))

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
        assertEquals(listOf("linear"), rpc.mcpAuthCancels)

        rpc.beforeAuthenticate = null
        rpc.mcpAuthenticateStarted = false
        rpc.mcpAuthenticateResult = McpAuthResultDto("connected")
        assertEquals("connected", service.signIn("/test", "linear").status)
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

    /**
     * `mcp.auth.url` means the CLI deliberately did not open a browser, because in split mode it
     * runs on the host while the user sits at the client. The client must open it itself.
     */
    fun `test external auth url opens in the client browser`() {
        val opened = mutableListOf<String>()
        val dialogs = mutableListOf<String>()
        val service = service(
            showAuthUrl = { _, url -> dialogs.add(url) },
            openUrl = { url -> opened.add(url) },
        )

        runBlocking(Dispatchers.Default) { service.refresh("/test") }
        settle()
        runBlocking(Dispatchers.Default) {
            rpc.mcpAuthEventsFlow.emit(
                McpAuthEventDto("linear", "https://auth.example.test/authorize", external = true),
            )
        }
        settle()

        assertEquals(listOf("https://auth.example.test/authorize"), opened)
        assertTrue("the dialog is only a fallback", dialogs.isEmpty())
    }

    /** When the client cannot open a browser either, the URL still has to reach the user. */
    fun `test external auth url falls back to the dialog when opening fails`() {
        val dialogs = mutableListOf<String>()
        val service = service(
            showAuthUrl = { _, url -> dialogs.add(url) },
            openUrl = { throw RuntimeException("no browser") },
        )

        runBlocking(Dispatchers.Default) { service.refresh("/test") }
        settle()
        runBlocking(Dispatchers.Default) {
            rpc.mcpAuthEventsFlow.emit(
                McpAuthEventDto("linear", "https://auth.example.test/authorize", external = true),
            )
        }
        settle()

        assertEquals(listOf("https://auth.example.test/authorize"), dialogs)
    }

    /** `mcp.browser.open.failed` means the CLI already tried, so the dialog is the only option. */
    fun `test browser open failed event does not retry opening a browser`() {
        val opened = mutableListOf<String>()
        val dialogs = mutableListOf<String>()
        val service = service(
            showAuthUrl = { _, url -> dialogs.add(url) },
            openUrl = { url -> opened.add(url) },
        )

        runBlocking(Dispatchers.Default) { service.refresh("/test") }
        settle()
        runBlocking(Dispatchers.Default) {
            rpc.mcpAuthEventsFlow.emit(McpAuthEventDto("linear", "https://auth.example.test/authorize"))
        }
        settle()

        assertEquals(listOf("https://auth.example.test/authorize"), dialogs)
        assertTrue(opened.isEmpty())
    }

    /**
     * The authorization URL is supplied by the remote MCP server, so a non-web scheme must never
     * reach the browser or the fallback dialog. Otherwise a malicious server could have the IDE
     * open `file:///…` or `smb://…` on the user's machine.
     */
    fun `test non-web auth urls are dropped instead of opened`() {
        val opened = mutableListOf<String>()
        val dialogs = mutableListOf<String>()
        val service = service(
            dedupeWindowMs = 0L,
            showAuthUrl = { _, url -> dialogs.add(url) },
            openUrl = { url -> opened.add(url) },
        )

        runBlocking(Dispatchers.Default) { service.refresh("/test") }
        settle()
        for (url in listOf("file:///etc/passwd", "smb://host/share", "javascript:alert(1)", "https:///nohost")) {
            runBlocking(Dispatchers.Default) {
                rpc.mcpAuthEventsFlow.emit(McpAuthEventDto("linear", url, external = true))
            }
            settle()
        }

        assertTrue("no non-web URL may be opened, got $opened", opened.isEmpty())
        assertTrue("no non-web URL may reach the dialog, got $dialogs", dialogs.isEmpty())
    }

    /** A [KiloAgentBehaviorService] backed by an RPC fake whose `mcpAuthenticate` never returns. */
    private class SlowAuthenticateRpc(private val never: CompletableDeferred<McpAuthResultDto>) :
        ai.kilocode.rpc.KiloAgentBehaviorRpcApi by FakeAgentBehaviorRpcApi() {
        val mcpAuthCancels = mutableListOf<String>()
        val mcpAuthRemovals = mutableListOf<String>()

        override suspend fun mcpAuthenticate(directory: String, name: String): McpAuthResultDto = never.await()

        override suspend fun mcpAuthCancel(directory: String, name: String): Boolean {
            mcpAuthCancels.add(name)
            return true
        }

        override suspend fun mcpAuthRemove(directory: String, name: String): Boolean {
            mcpAuthRemovals.add(name)
            return true
        }
    }
}
