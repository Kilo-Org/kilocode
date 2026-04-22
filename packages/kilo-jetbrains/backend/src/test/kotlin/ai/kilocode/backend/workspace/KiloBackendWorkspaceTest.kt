package ai.kilocode.backend.workspace

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.workspace.KiloBackendWorkspace
import ai.kilocode.backend.workspace.KiloWorkspaceState
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class KiloBackendWorkspaceTest {

    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        scope.cancel()
        mock.close()
    }

    private fun setup(): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log)

    private suspend fun ready(app: KiloBackendAppService): KiloBackendWorkspace {
        app.connect()
        withTimeout(10_000) {
            app.appState.first { it is KiloAppState.Ready }
        }
        return app.workspaces.get("/test/project")
    }

    // ------ Workspace manager lifecycle ------

    @Test
    fun `workspace manager throws when not started`() = runBlocking {
        val app = setup()
        assertFailsWith<IllegalStateException> {
            app.workspaces.get("/test")
        }
    }

    @Test
    fun `get creates workspace on demand after Ready`() = runBlocking {
        mock.providers = PROVIDERS_JSON
        mock.agents = AGENTS_JSON
        mock.commands = COMMANDS_JSON
        mock.skills = SKILLS_JSON

        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        assertEquals(1, state.providers.providers.size)
        assertEquals("anthropic", state.providers.providers[0].id)
    }

    @Test
    fun `same directory returns same workspace instance`() = runBlocking {
        val app = setup()
        app.connect()
        withTimeout(10_000) { app.appState.first { it is KiloAppState.Ready } }

        val ws1 = app.workspaces.get("/test")
        val ws2 = app.workspaces.get("/test")
        assertTrue(ws1 === ws2)
    }

    @Test
    fun `different directories return different workspaces`() = runBlocking {
        val app = setup()
        app.connect()
        withTimeout(10_000) { app.appState.first { it is KiloAppState.Ready } }

        val ws1 = app.workspaces.get("/project-a")
        val ws2 = app.workspaces.get("/project-b")
        assertTrue(ws1 !== ws2)
        assertEquals("/project-a", ws1.directory)
        assertEquals("/project-b", ws2.directory)
    }

    @Test
    fun `workspaces stopped on app disconnect`() = runBlocking {
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        app.dispose()

        // Workspace state should be Pending (stopped)
        assertIs<KiloWorkspaceState.Pending>(ws.state.value)

        // Manager should throw since app is disconnected
        assertFailsWith<IllegalStateException> {
            app.workspaces.get("/test/project")
        }
    }

    // ------ Workspace data loading ------

    @Test
    fun `full lifecycle reaches Ready`() = runBlocking {
        mock.providers = PROVIDERS_JSON
        mock.agents = AGENTS_JSON
        mock.commands = COMMANDS_JSON
        mock.skills = SKILLS_JSON

        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        assertEquals(1, state.providers.providers.size)
        assertEquals(listOf("anthropic"), state.providers.connected)
        assertEquals(1, state.agents.agents.size)
        assertEquals("code", state.agents.default)
        assertEquals(1, state.commands.size)
        assertEquals("clear", state.commands[0].name)
        assertEquals(1, state.skills.size)
        assertEquals("test-skill", state.skills[0].name)
    }

    @Test
    fun `workspace reaches Ready after creation`() = runBlocking {
        val app = setup()
        app.connect()
        withTimeout(10_000) { app.appState.first { it is KiloAppState.Ready } }

        // get() creates workspace and starts loading immediately
        val ws = app.workspaces.get("/test")

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        assertIs<KiloWorkspaceState.Ready>(ws.state.value)
    }

    // ------ Error handling ------

    @Test
    fun `providers failure retries then transitions to Error`() = runBlocking {
        mock.providersStatus = 500
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Error }
        }

        val err = ws.state.value as KiloWorkspaceState.Error
        assertTrue(err.message.contains("providers"))
    }

    @Test
    fun `agents failure retries then transitions to Error`() = runBlocking {
        mock.agentsStatus = 500
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Error }
        }

        val err = ws.state.value as KiloWorkspaceState.Error
        assertTrue(err.message.contains("agents"))
    }

    @Test
    fun `commands failure transitions to Error`() = runBlocking {
        mock.commandsStatus = 500
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Error }
        }

        val err = ws.state.value as KiloWorkspaceState.Error
        assertTrue(err.message.contains("commands"))
    }

    @Test
    fun `skills failure transitions to Error`() = runBlocking {
        mock.skillsStatus = 500
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Error }
        }

        val err = ws.state.value as KiloWorkspaceState.Error
        assertTrue(err.message.contains("skills"))
    }

    @Test
    fun `partial failure reports failed resources`() = runBlocking {
        mock.providersStatus = 500
        mock.skillsStatus = 500
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Error }
        }

        val err = ws.state.value as KiloWorkspaceState.Error
        assertTrue(err.message.contains("providers") || err.message.contains("skills"))
    }

    // ------ Reload ------

    @Test
    fun `reload during load produces valid final state`() = runBlocking {
        val app = setup()
        val ws = ready(app)

        ws.reload()
        ws.reload()

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        assertIs<KiloWorkspaceState.Ready>(ws.state.value)
    }

    // ------ Data mapping ------

    @Test
    fun `providers response maps models correctly`() = runBlocking {
        mock.providers = PROVIDERS_JSON
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        val provider = state.providers.providers[0]
        assertEquals("anthropic", provider.id)
        assertEquals("Anthropic", provider.name)
        val model = provider.models["claude-4"]
        assertNotNull(model)
        assertEquals("Claude 4", model.name)
        assertTrue(model.attachment)
        assertTrue(model.reasoning)
        assertTrue(model.toolCall)
    }

    @Test
    fun `agents response filters hidden and subagent`() = runBlocking {
        mock.agents = """[
            {"name":"code","mode":"primary","permission":[],"options":{}},
            {"name":"helper","mode":"subagent","permission":[],"options":{}},
            {"name":"secret","mode":"primary","hidden":true,"permission":[],"options":{}}
        ]"""
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        assertEquals(1, state.agents.agents.size)
        assertEquals("code", state.agents.agents[0].name)
        assertEquals(3, state.agents.all.size)
        assertEquals("code", state.agents.default)
    }

    @Test
    fun `commands response maps source`() = runBlocking {
        mock.commands = """[
            {"name":"clear","template":"","hints":[],"source":"command"},
            {"name":"mcp-tool","template":"","hints":["tool"],"source":"mcp"}
        ]"""
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        assertEquals(2, state.commands.size)
        assertEquals("command", state.commands[0].source)
        assertEquals("mcp", state.commands[1].source)
        assertEquals(listOf("tool"), state.commands[1].hints)
    }

    @Test
    fun `empty responses produce empty Ready`() = runBlocking {
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        assertTrue(state.providers.providers.isEmpty())
        assertTrue(state.agents.all.isEmpty())
        assertTrue(state.commands.isEmpty())
        assertTrue(state.skills.isEmpty())
        assertEquals("code", state.agents.default)
    }

    // ------ Session access through workspace ------

    @Test
    fun `workspace exposes sessions for its directory`() = runBlocking {
        mock.sessions = """[
            {"id":"ses_1","slug":"s","projectID":"p","directory":"/test/project","title":"T","version":"1","time":{"created":1,"updated":1}}
        ]"""
        val app = setup()
        val ws = ready(app)

        val result = ws.sessions()
        assertEquals(1, result.sessions.size)
        assertEquals("ses_1", result.sessions[0].id)
    }

    @Test
    fun `workspace creates session in its directory`() = runBlocking {
        mock.sessionCreate = """{"id":"ses_new","slug":"n","projectID":"p","directory":"/test/project","title":"New","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        val ws = ready(app)

        val session = ws.createSession()
        assertEquals("ses_new", session.id)
        assertEquals("/test/project", session.directory)
    }

    // ------ Concurrency tests ------

    @Test
    fun `concurrent get for same directory returns same instance`() = runBlocking {
        val app = setup()
        app.connect()
        withTimeout(10_000) { app.appState.first { it is KiloAppState.Ready } }

        // Launch many concurrent get() calls for the same directory
        val results = (1..10).map {
            async(Dispatchers.Default) {
                app.workspaces.get("/same/dir")
            }
        }.awaitAll()

        // All must return the exact same instance
        val first = results[0]
        results.forEach { assertTrue(it === first) }
    }

    @Test
    fun `concurrent load calls on workspace produce valid final state`() = runBlocking {
        mock.providers = PROVIDERS_JSON
        mock.agents = AGENTS_JSON
        mock.commands = COMMANDS_JSON
        mock.skills = SKILLS_JSON

        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        // Fire rapid reloads — simulates rapid SSE disposed events
        repeat(5) { ws.reload() }

        // Final state must be valid Ready
        withTimeout(15_000) {
            while (true) {
                val state = ws.state.value
                if (state is KiloWorkspaceState.Ready) {
                    delay(300)
                    if (ws.state.value is KiloWorkspaceState.Ready) break
                }
                delay(100)
            }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        assertEquals(1, state.providers.providers.size)
        assertEquals(1, state.agents.agents.size)
    }

    @Test
    fun `SSE global disposed triggers full app reload with new data`() = runBlocking {
        mock.providers = PROVIDERS_JSON
        mock.agents = AGENTS_JSON
        mock.commands = COMMANDS_JSON
        mock.skills = SKILLS_JSON

        val app = setup()
        ready(app)

        // Change providers response then fire disposed event
        mock.providers = """{
            "all": [{
                "id": "openai",
                "name": "OpenAI",
                "source": "api",
                "env": [],
                "options": {},
                "models": {}
            }],
            "default": {},
            "connected": ["openai"]
        }"""

        mock.awaitSseConnection()
        mock.pushEvent("global.disposed", """{"type":"global.disposed"}""")

        // global.disposed triggers full app reload which restarts the
        // workspace manager (stop + start), clearing all cached workspaces.
        // Wait for app to reach Ready again after reload.
        withTimeout(15_000) {
            // App may briefly leave Ready during reload
            while (true) {
                val state = app.appState.value
                if (state is KiloAppState.Ready) {
                    delay(300)
                    if (app.appState.value is KiloAppState.Ready) break
                }
                delay(100)
            }
        }

        // Get a fresh workspace — old one was stopped during reload
        val ws = app.workspaces.get("/test/project")
        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        assertEquals("openai", state.providers.providers[0].id)
    }

    companion object {
        private val PROVIDERS_JSON = """{
            "all": [{
                "id": "anthropic",
                "name": "Anthropic",
                "source": "api",
                "env": ["ANTHROPIC_API_KEY"],
                "options": {},
                "models": {
                    "claude-4": {
                        "id": "claude-4",
                        "providerID": "anthropic",
                        "name": "Claude 4",
                        "api": {"id": "anthropic", "url": "", "npm": ""},
                        "capabilities": {
                            "temperature": true,
                            "reasoning": true,
                            "attachment": true,
                            "toolcall": true,
                            "input": {"text": true, "audio": false, "image": false, "video": false, "pdf": false},
                            "output": {"text": true, "audio": false, "image": false, "video": false, "pdf": false},
                            "interleaved": false
                        },
                        "cost": {"input": 0, "output": 0, "cache": {"read": 0, "write": 0}},
                        "limit": {"context": 200000, "output": 16000},
                        "status": "active",
                        "options": {},
                        "headers": {},
                        "release_date": "2025-05-01"
                    }
                }
            }],
            "default": {"code": "anthropic/claude-4"},
            "connected": ["anthropic"]
        }""".trimIndent()

        private val AGENTS_JSON = """[
            {"name":"code","displayName":"Code","mode":"primary","permission":[],"options":{}}
        ]""".trimIndent()

        private val COMMANDS_JSON = """[
            {"name":"clear","description":"Clear conversation","template":"","hints":[],"source":"command"}
        ]""".trimIndent()

        private val SKILLS_JSON = """[
            {"name":"test-skill","description":"A test skill","location":"file:///test","content":"# Test"}
        ]""".trimIndent()
    }
}
