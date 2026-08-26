package ai.kilocode.backend.workspace

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.app.KiloBackendSessionManager
import ai.kilocode.backend.app.SseEvent
import ai.kilocode.backend.cli.KiloBackendHttpClients
import ai.kilocode.backend.workspace.KiloBackendWorkspace
import ai.kilocode.backend.workspace.KiloWorkspaceState
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.jetbrains.api.client.DefaultApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import java.nio.file.Files
import java.nio.file.Path
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
    private val apps = mutableListOf<KiloBackendAppService>()
    private val root: Path = Files.createTempDirectory("kilo-backend-workspace")
    private val project: Path = Files.createDirectories(root.resolve("project"))

    @AfterTest
    fun tearDown() {
        runBlocking {
            apps.forEach { it.dispose() }
            apps.clear()
            scope.cancel()
            mock.close()
            withTimeout(10_000) { scope.coroutineContext[Job]?.join() }
            delete(root)
        }
    }

    private fun setup(): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }

    private suspend fun connect(app: KiloBackendAppService) {
        app.connect()
        val state = assertNotNull(
            withTimeoutOrNull(35_000) {
                app.appState.first {
                    it is KiloAppState.Ready || it is KiloAppState.Error || it is KiloAppState.MigrationRequired
                }
            },
            "App startup timed out in ${app.appState.value}; logs=${log.messages}",
        )
        assertIs<KiloAppState.Ready>(state, "App startup failed; logs=${log.messages}")
    }

    private suspend fun ready(app: KiloBackendAppService): KiloBackendWorkspace {
        connect(app)
        return app.workspaces.get(project.toString())
    }

    private fun dir(name: String): String = Files.createDirectories(root.resolve(name)).toString()

    private suspend fun loaded(ws: KiloBackendWorkspace) {
        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }
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
        connect(app)

        val path = dir("same")
        val ws1 = app.workspaces.get(path)
        val ws2 = app.workspaces.get(path)
        // LLM note: get() starts background loading; settle it so teardown is not racing active HTTP calls in CI.
        loaded(ws1)
        assertTrue(ws1 === ws2)
    }

    @Test
    fun `different directories return different workspaces`() = runBlocking {
        val app = setup()
        connect(app)

        val first = dir("project-a")
        val second = dir("project-b")
        val ws1 = app.workspaces.get(first)
        val ws2 = app.workspaces.get(second)
        // LLM note: get() starts background loading; settle both loads before the scope-cancelling teardown.
        loaded(ws1)
        loaded(ws2)
        assertTrue(ws1 !== ws2)
        assertEquals(first, ws1.directory)
        assertEquals(second, ws2.directory)
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
            app.workspaces.get(project.toString())
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
        connect(app)

        // get() creates workspace and starts loading immediately
        val ws = app.workspaces.get(dir("plain"))

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
        assertTrue(err.errors.any { it.resource == "providers" })
        assertTrue(log.messages.any { it.contains("Workspace error [${project}]: Failed to load:") && it.contains("providers") })
    }

    @Test
    fun `providers decode failure includes detail`() = runBlocking {
        mock.providers = """{"all":[false],"default":{},"connected":[]}"""
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Error }
        }

        val err = ws.state.value as KiloWorkspaceState.Error
        val detail = err.errors.single { it.resource == "providers" }.detail
        assertTrue(detail?.isNotBlank() == true)
    }

    @Test
    fun `agents failure retries then transitions to Error`() = runBlocking {
        mock.agentsStatus = 500
        mock.agents = """{"error":"invalid agent config"}"""
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Error }
        }

        val err = ws.state.value as KiloWorkspaceState.Error
        assertTrue(err.message.contains("agents"))
        val item = err.errors.single { it.resource == "agents" }
        assertEquals(500, item.status)
        assertTrue(item.detail?.contains("invalid agent config") == true)
        assertTrue(log.messages.any { it.contains("agents response body:") && it.contains("invalid agent config") })
        assertTrue(log.messages.any { it.contains("WARN: agents: all 3 attempts failed") })
        assertTrue(log.messages.none { it.contains("ERROR: agents: all 3 attempts failed") })
    }

    @Test
    fun `dev container virtual directory transitions to Unsupported without fetching agents`() = runBlocking {
        val app = setup()
        connect(app)
        mock.resetCounts()
        val ws = app.workspaces.get("/${'$'}devcontainer.ij/abc@u~run~user~1001~podman~podman.sock/workspaces/project")

        val state = withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Unsupported }
        } as KiloWorkspaceState.Unsupported

        assertEquals("devcontainer_virtual_filesystem", state.reason)
        assertEquals(0, mock.requestCount("/agent"))
        assertEquals(0, mock.requestCount("/provider"))
        assertTrue(log.messages.none { it.contains("all 3 attempts failed") })
        assertTrue(log.messages.none { it.contains("Workspace error") })
    }

    @Test
    fun `wsl virtual directory transitions to Unsupported without fetching agents`() = runBlocking {
        val app = setup()
        connect(app)
        mock.resetCounts()
        val ws = app.workspaces.get("\\\\wsl${'$'}\\Ubuntu\\home\\user\\project")

        val state = withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Unsupported }
        } as KiloWorkspaceState.Unsupported

        assertEquals("wsl_virtual_filesystem", state.reason)
        assertEquals(0, mock.requestCount("/agent"))
    }

    @Test
    fun `invalid virtual directory transitions to Unsupported without fetching agents`() = runBlocking {
        val app = setup()
        connect(app)
        mock.resetCounts()
        val ws = app.workspaces.get("bad" + Char.MIN_VALUE + "path")

        val state = withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Unsupported }
        } as KiloWorkspaceState.Unsupported

        assertEquals("invalid_virtual_path", state.reason)
        assertEquals(0, mock.requestCount("/agent"))
    }

    @Test
    fun `missing directory transitions to Missing without fetching workspace data`() = runBlocking {
        val app = setup()
        connect(app)
        mock.resetCounts()
        val dir = Files.createTempDirectory("kilo-missing-workspace")
        Files.delete(dir)
        val ws = app.workspaces.get(dir.toString())

        val state = withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Missing }
        } as KiloWorkspaceState.Missing

        assertEquals(dir.toString(), state.path)
        assertEquals(0, mock.requestCount("/agent"))
        assertEquals(0, mock.requestCount("/provider"))
        assertEquals(0, mock.requestCount("/command"))
        assertEquals(0, mock.requestCount("/skill"))
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
        assertTrue(err.errors.any { it.resource == "providers" } || err.errors.any { it.resource == "skills" })
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
    // Detailed provider/command/path parsing correctness is covered in KiloCliDataParserTest.
    // These integration tests verify end-to-end data flow: server → workspace state.

    @Test
    fun `providers response reaches state with expected provider and model`() = runBlocking {
        mock.providers = PROVIDERS_JSON
        val app = setup()
        val ws = ready(app)

        withTimeout(15_000) {
            ws.state.first { it is KiloWorkspaceState.Ready }
        }

        val state = ws.state.value as KiloWorkspaceState.Ready
        assertEquals(1, state.providers.providers.size)
        assertEquals("anthropic", state.providers.providers[0].id)
        assertNotNull(state.providers.providers[0].models["claude-4"])
        assertEquals(listOf("anthropic"), state.providers.connected)
    }

    @Test
    fun `agents response filters hidden and subagent`() = runBlocking {
        mock.providers = PROVIDERS_JSON
        mock.agents = """[
            {"name":"code","mode":"primary","permission":[],"options":{}},
            {"name":"helper","mode":"subagent","permission":[],"options":{}},
            {"name":"secret","mode":"primary","hidden":true,"permission":[],"options":{}}
        ]"""
        mock.commands = COMMANDS_JSON
        mock.skills = SKILLS_JSON
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
            {"id":"ses_1","slug":"s","projectID":"p","directory":"${project}","title":"T","version":"1","time":{"created":1,"updated":1}}
        ]"""
        val app = setup()
        val ws = ready(app)
        loaded(ws)

        val result = ws.sessions()
        assertEquals(1, result.sessions.size)
        assertEquals("ses_1", result.sessions[0].id)
    }

    @Test
    fun `workspace maps missing session timestamps to zero`() = runBlocking {
        mock.sessions = """[
            {"id":"ses_1","slug":"s","projectID":"p","directory":"${project}","title":"T","version":"1","time":{"created":null,"updated":null}}
        ]"""
        val app = setup()
        val ws = ready(app)
        loaded(ws)

        val session = ws.sessions().sessions.single()
        assertEquals(0.0, session.time.created)
        assertEquals(0.0, session.time.updated)
    }

    @Test
    fun `workspace creates session in its directory`() = runBlocking {
        mock.sessionCreate = """{"id":"ses_new","slug":"n","projectID":"p","directory":"${project}","title":"New","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        val ws = ready(app)
        loaded(ws)

        val session = ws.createSession()
        assertEquals("ses_new", session.id)
        assertEquals(project.toString(), session.directory)
    }

    // ------ Concurrency tests ------

    @Test
    fun `concurrent get for same directory returns same instance`() = runBlocking {
        val port = mock.start()
        val http = KiloBackendHttpClients.api(mock.password)
        val api = DefaultApi(basePath = "http://127.0.0.1:$port", client = http)
        val events = MutableSharedFlow<SseEvent>()
        val sessions = KiloBackendSessionManager(scope, log)
        val manager = KiloBackendWorkspaceManager(scope, sessions, log)
        manager.start(api, http, port, events)

        try {
            val results = (1..10).map {
                async(Dispatchers.Default) {
                    manager.get(dir("same-concurrent"))
                }
            }.awaitAll()

            val first = results[0]
            results.forEach { assertTrue(it === first) }
            loaded(first)
        } finally {
            manager.stop()
            KiloBackendHttpClients.shutdown(http)
        }
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

        mock.providers = OPENAI_PROVIDERS_JSON
        val before = mock.requestCount("/provider")

        repeat(5) { ws.reload() }

        assertTrue(
            mock.awaitRequestCount("/provider", before + 1),
            "Workspace reload did not request providers; state=${ws.state.value}; logs=${log.messages}",
        )

        val state = withTimeout(15_000) {
            ws.state.first {
                it is KiloWorkspaceState.Ready &&
                    it.providers.providers.firstOrNull()?.id == "openai"
            }
        } as KiloWorkspaceState.Ready

        assertEquals(1, state.providers.providers.size)
        assertEquals("openai", state.providers.providers[0].id)
        assertEquals(1, state.agents.agents.size)
    }

    @Test
    fun `SSE global disposed triggers full app reload with new data`() = runBlocking {
        mock.providers = PROVIDERS_JSON
        mock.agents = AGENTS_JSON
        mock.commands = COMMANDS_JSON
        mock.skills = SKILLS_JSON

        val app = setup()
        val initial = ready(app)

        mock.providers = OPENAI_PROVIDERS_JSON

        assertTrue(mock.awaitSseConnection())
        val prev = (app.appState.value as KiloAppState.Ready).rev
        val before = mock.requestCount("/global/config")
        val reload = async(start = CoroutineStart.UNDISPATCHED) {
            app.appState.first { it is KiloAppState.Ready && it.rev > prev }
        }
        mock.pushEvent("global.disposed", """{"type":"global.disposed"}""")
        assertTrue(
            mock.awaitRequestCount("/global/config", before + 1),
            "global.disposed did not start app reload; state=${app.appState.value}; logs=${log.messages}",
        )
        withTimeout(15_000) { reload.await() }

        val ws = app.workspaces.get(project.toString())
        assertTrue(ws !== initial)
        val state = withTimeout(15_000) {
            ws.state.first {
                it is KiloWorkspaceState.Ready &&
                    it.providers.providers.firstOrNull()?.id == "openai"
            }
        } as KiloWorkspaceState.Ready
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
                        "limit": {"context": 200000, "input": 100000, "output": 16000},
                        "status": "active",
                        "recommendedIndex": 2,
                        "variants": {"high": {}, "low": {}, "medium": {}},
                        "options": {},
                        "headers": {},
                        "release_date": "2025-05-01"
                    }
                }
            }],
            "default": {"code": "anthropic/claude-4"},
            "connected": ["anthropic"]
        }""".trimIndent()

        private val OPENAI_PROVIDERS_JSON = """{
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

    private fun delete(dir: Path) {
        if (!Files.exists(dir)) return
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
