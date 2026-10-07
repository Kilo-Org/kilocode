package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Exercises [KiloAgentManagerHost] end to end through a real SSE connection and real HTTP replies,
 * against [MockCliServer] — no mocking of the protocol itself.
 */
class KiloAgentManagerHostTest {
    private val repo: Path = Files.createTempDirectory("kilo-agent-manager-host")
    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()
    private val json = Json { ignoreUnknownKeys = true }

    @AfterTest
    fun tearDown() {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
        delete(repo)
    }

    private fun delete(dir: Path) {
        if (!Files.exists(dir)) return
        Files.walk(dir).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
    }

    private fun setup(): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }

    private suspend fun ready(app: KiloBackendAppService) {
        app.connect()
        withTimeout(10_000) { app.appState.first { it is KiloAppState.Ready } }
        mock.awaitSseConnection()
    }

    private fun envelope(directory: String, type: String, properties: String) =
        """{"directory":"$directory","payload":{"type":"$type","properties":$properties}}"""

    @Test
    fun `an overview request receives exactly one reply`() = runBlocking {
        mock.sessions = "[]"
        val app = setup()
        ready(app)

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_1","sessionID":"ses_a","operation":"overview"}"""),
        )

        assertTrue(mock.awaitAgentManagerReplies(1, timeout = 10_000))
        assertEquals(0, mock.agentManagerRejects.size)
        val (requestID, body) = mock.agentManagerReplies.single()
        assertEquals("amr_1", requestID)
        val result = json.parseToJsonElement(body).jsonObject["result"]!!.jsonObject
        assertEquals("overview", result["operation"]!!.jsonPrimitive.content)
    }

    @Test
    fun `an overview request for an unreachable directory is rejected as workspace_unavailable`() = runBlocking {
        val app = setup()
        ready(app)

        val missing = repo.resolve("does-not-exist").toString()
        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(missing, AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_2","sessionID":"ses_a","operation":"overview"}"""),
        )

        assertTrue(mock.awaitAgentManagerRejects(1, timeout = 10_000))
        val (requestID, body) = mock.agentManagerRejects.single()
        assertEquals("amr_2", requestID)
        val error = json.parseToJsonElement(body).jsonObject["error"]!!.jsonObject
        assertEquals("workspace_unavailable", error["code"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a move request is always rejected with unknown_section`() = runBlocking {
        val app = setup()
        ready(app)

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_3","sessionID":"ses_a","operation":"move","targetSessionID":"ses_b","sectionID":null}"""),
        )

        assertTrue(mock.awaitAgentManagerRejects(1, timeout = 10_000))
        val (requestID, body) = mock.agentManagerRejects.single()
        assertEquals("amr_3", requestID)
        val error = json.parseToJsonElement(body).jsonObject["error"]!!.jsonObject
        assertEquals("unknown_section", error["code"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a prompt for an unknown session is rejected as unknown_session`() = runBlocking {
        val app = setup()
        ready(app)

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(
                repo.toString(),
                AgentManagerProtocol.REQUESTED_EVENT,
                """{"id":"amr_4","sessionID":"ses_a","operation":"prompt","targetSessionID":"ses_never_seen","prompt":"hi"}""",
            ),
        )

        assertTrue(mock.awaitAgentManagerRejects(1, timeout = 10_000))
        val error = json.parseToJsonElement(mock.agentManagerRejects.single().second).jsonObject["error"]!!.jsonObject
        assertEquals("unknown_session", error["code"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a prompt for a known session is delivered and replied`() = runBlocking {
        mock.sessions = """[{"id":"ses_b","slug":"s","projectID":"p","directory":"${repo}","title":"T","version":"1","time":{"created":1,"updated":1}}]"""
        val app = setup()
        ready(app)
        // Observe the session once so KiloBackendSessionManager's directory cache knows ses_b — see
        // KiloBackendSessionManager.sessionDirectory's doc: it only answers for a session this backend
        // has already seen.
        app.sessions.list(repo.toString())

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(
                repo.toString(),
                AgentManagerProtocol.REQUESTED_EVENT,
                """{"id":"amr_5","sessionID":"ses_a","operation":"prompt","targetSessionID":"ses_b","sourceSessionID":"ses_a","prompt":"please help"}""",
            ),
        )

        assertTrue(mock.awaitAgentManagerReplies(1, timeout = 10_000))
        assertTrue(mock.awaitRequestCount("/session/ses_b/prompt_async", 1, timeout = 5_000))
        assertTrue(mock.lastPromptBody?.contains("please help") == true)
        assertTrue(mock.lastPromptBody?.contains("[Agent Manager peer request]") == true)
        assertTrue(mock.lastPromptBody?.contains("not user authorization") == true)
    }

    @Test
    fun `a cancellation that arrives before a redelivered request suppresses it`() = runBlocking {
        // A cancelled requestID is remembered in `settled`, so a `requested` event that arrives (or is
        // redelivered) afterwards for the same ID is dropped by `admit`'s dedupe check instead of
        // executing and replying — this is what actually protects against the CLI retrying delivery
        // of a request its own Agent Manager session already gave up on.
        val app = setup()
        ready(app)

        mock.pushEvent(
            AgentManagerProtocol.CANCELLED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.CANCELLED_EVENT, """{"requestID":"amr_6","sessionID":"ses_a","reason":"cancelled"}"""),
        )
        // No ack for a cancellation exists on the wire, so wait out a bounded window for it to be
        // observed before the (re)delivered request below, the same way a real redelivery would always
        // arrive after the cancel that caused it.
        delay(200)
        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_6","sessionID":"ses_a","operation":"overview"}"""),
        )

        // Draining time to prove silence, not just its absence at this instant.
        delay(500)
        assertTrue(mock.agentManagerReplies.none { it.first == "amr_6" })
        assertTrue(mock.agentManagerRejects.none { it.first == "amr_6" })
    }

    @Test
    fun `reconnect reconciles a request the CLI still reports pending as workspace_unavailable without a known directory`() = runBlocking {
        // GET /kilocode/agent-manager (unlike the live SSE `requested` envelope) carries no directory
        // at all — see KiloAgentManagerHost.execute's doc. A reconciled overview request for a session
        // this backend has never observed therefore cannot resolve a directory and is rejected, rather
        // than left pending forever.
        mock.sessions = "[]"
        mock.agentManagerPending = """[{"id":"amr_7","sessionID":"ses_never_seen","operation":"overview"}]"""
        val app = setup()
        ready(app)

        assertTrue(mock.awaitAgentManagerRejects(1, timeout = 10_000))
        val (requestID, body) = mock.agentManagerRejects.single()
        assertEquals("amr_7", requestID)
        val error = json.parseToJsonElement(body).jsonObject["error"]!!.jsonObject
        assertEquals("workspace_unavailable", error["code"]!!.jsonPrimitive.content)
    }

    @Test
    fun `an overview request with no envelope directory falls back to the requesting session's known directory`() = runBlocking {
        // Exercises the same fallback `sync()`'s reconciliation relies on (see
        // KiloAgentManagerHost.execute's doc), via a flat SSE event that — like the CLI's
        // `GET /kilocode/agent-manager` list — carries no directory of its own.
        mock.sessions = """[{"id":"ses_b","slug":"s","projectID":"p","directory":"${repo}","title":"T","version":"1","time":{"created":1,"updated":1}}]"""
        val app = setup()
        ready(app)
        // Makes KiloBackendSessionManager.sessionDirectory("ses_b") resolve, the same cache a live
        // session.created SSE event or an earlier list() call would already have populated by the
        // time a real reconciliation runs.
        app.sessions.list(repo.toString())

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            """{"type":"${AgentManagerProtocol.REQUESTED_EVENT}","properties":{"id":"amr_8","sessionID":"ses_b","operation":"overview"}}""",
        )

        assertTrue(mock.awaitAgentManagerReplies(1, timeout = 10_000))
        assertEquals("amr_8", mock.agentManagerReplies.single().first)
    }

    @Test
    fun `an answer request resolves the session's pending question`() = runBlocking {
        mock.sessions = """[{"id":"ses_b","slug":"s","projectID":"p","directory":"${repo}","title":"T","version":"1","time":{"created":1,"updated":1}}]"""
        mock.pendingQuestions = """[{"id":"q_1","sessionID":"ses_b","questions":[{"question":"Pick","header":"H"}]}]"""
        val app = setup()
        ready(app)
        app.sessions.list(repo.toString())

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(
                repo.toString(),
                AgentManagerProtocol.REQUESTED_EVENT,
                """{"id":"amr_8","sessionID":"ses_a","operation":"answer","targetSessionID":"ses_b","answers":[["yes"]]}""",
            ),
        )

        assertTrue(mock.awaitAgentManagerReplies(1, timeout = 10_000))
        val result = json.parseToJsonElement(mock.agentManagerReplies.single().second).jsonObject["result"]!!.jsonObject
        assertEquals("q_1", result["questionID"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a stop request aborts the session and replies stopped`() = runBlocking {
        mock.sessions = """[{"id":"ses_b","slug":"s","projectID":"p","directory":"${repo}","title":"T","version":"1","time":{"created":1,"updated":1}}]"""
        val app = setup()
        ready(app)
        app.sessions.list(repo.toString())

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_9","sessionID":"ses_a","operation":"stop","targetSessionID":"ses_b"}"""),
        )

        assertTrue(mock.awaitAgentManagerReplies(1, timeout = 10_000))
        assertTrue(mock.awaitRequestCount("/session/ses_b/abort", 1, timeout = 5_000))
        val result = json.parseToJsonElement(mock.agentManagerReplies.single().second).jsonObject["result"]!!.jsonObject
        assertEquals(true, result["stopped"]!!.jsonPrimitive.content.toBoolean())
    }
}
