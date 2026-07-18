package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.McpStatusDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

class KiloAgentBehaviorServiceTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeAgentBehaviorRpcApi
    private lateinit var service: KiloAgentBehaviorService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeAgentBehaviorRpcApi()
        service = KiloAgentBehaviorService(scope, rpc)
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test createAgent forwards input`() = runBlocking {
        val input = AgentCreateDto("reviewer", "Review code", description = "Reviews code")

        val ok = withContext(Dispatchers.Default) { service.createAgent("/test", input) }

        assertTrue(ok)
        assertEquals(listOf(input), rpc.creations)
        assertEquals(listOf("reviewer"), rpc.agents.map { it.name })
    }

    fun `test createAgent returns false on rpc failure`() = runBlocking {
        val input = AgentCreateDto("reviewer", "Review code")
        rpc.createError = RuntimeException("boom")

        val ok = withContext(Dispatchers.Default) { service.createAgent("/test", input) }

        assertFalse(ok)
        assertTrue(rpc.creations.isEmpty())
    }

    fun `test removeAgent records removal`() = runBlocking {
        val ok = withContext(Dispatchers.Default) { service.removeAgent("/test", "reviewer") }

        assertTrue(ok)
        assertEquals(listOf("reviewer"), rpc.removals)
    }

    fun `test removeAgent returns false on rpc failure`() = runBlocking {
        rpc.removeError = RuntimeException("boom")

        val ok = withContext(Dispatchers.Default) { service.removeAgent("/test", "reviewer") }

        assertFalse(ok)
        assertTrue(rpc.removals.isEmpty())
    }

    fun `test mcpStatus forwards directory`() = runBlocking {
        rpc.mcps = listOf(McpStatusDto("filesystem", "connected"))

        val status = withContext(Dispatchers.Default) { service.mcpStatus("/test") }

        assertEquals(listOf(McpStatusDto("filesystem", "connected")), status)
        assertEquals(listOf("/test"), rpc.mcpCalls)
    }

    fun `test mcp runtime actions forward names`() = runBlocking {
        val connected = withContext(Dispatchers.Default) { service.mcpConnect("/test", "filesystem") }
        val disconnected = withContext(Dispatchers.Default) { service.mcpDisconnect("/test", "github") }
        val authenticated = withContext(Dispatchers.Default) { service.mcpAuthenticate("/test", "linear") }

        assertTrue(connected)
        assertTrue(disconnected)
        assertTrue(authenticated)
        assertEquals(listOf("filesystem"), rpc.mcpConnects)
        assertEquals(listOf("github"), rpc.mcpDisconnects)
        assertEquals(listOf("linear"), rpc.mcpAuthentications)
    }

    fun `test mcp calls return fallback on rpc failure`() = runBlocking {
        rpc.mcpStatusError = RuntimeException("boom")
        rpc.mcpConnectError = RuntimeException("boom")

        val status = withContext(Dispatchers.Default) { service.mcpStatus("/test") }
        val ok = withContext(Dispatchers.Default) { service.mcpConnect("/test", "filesystem") }

        assertTrue(status.isEmpty())
        assertFalse(ok)
        assertTrue(rpc.mcpConnects.isEmpty())
    }
}
