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
        val answer = mock.agentManagerReplies.single()
        val requestID = answer.requestID
        val body = answer.body
        assertEquals("amr_1", requestID)
        val result = json.parseToJsonElement(body).jsonObject["result"]!!.jsonObject
        assertEquals("overview", result["operation"]!!.jsonPrimitive.content)
    }

    @Test
    fun `an overview request for an unreachable directory is rejected through that same directory`() = runBlocking {
        // The directory is still the only instance that can accept the answer, even though it is not
        // a readable directory here — the reject must route to it rather than being dropped.
        val app = setup()
        ready(app)

        val missing = repo.resolve("does-not-exist").toString()
        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(missing, AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_2","sessionID":"ses_a","operation":"overview"}"""),
        )

        assertTrue(mock.awaitAgentManagerRejects(1, timeout = 10_000))
        val answer = mock.agentManagerRejects.single()
        assertEquals("amr_2", answer.requestID)
        assertEquals(missing, answer.directory)
        val error = json.parseToJsonElement(answer.body).jsonObject["error"]!!.jsonObject
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
        val answer = mock.agentManagerRejects.single()
        val requestID = answer.requestID
        val body = answer.body
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
        val error = json.parseToJsonElement(mock.agentManagerRejects.single().body).jsonObject["error"]!!.jsonObject
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
        assertTrue(mock.agentManagerReplies.none { it.requestID == "amr_6" })
        assertTrue(mock.agentManagerRejects.none { it.requestID == "amr_6" })
    }

    @Test
    fun `a newly observed session directory is reconciled once and its pending request executed`() = runBlocking {
        // Reconciliation is per directory (the endpoint is workspace-routed), and the session
        // manager's directory map is cleared on every disconnect, so the host reconciles a directory
        // when it first observes a session there rather than only at connect time.
        mock.agentManagerPending = """[{"id":"amr_7","sessionID":"ses_b","operation":"overview"}]"""
        val app = setup()
        ready(app)

        mock.pushEvent(
            "session.created",
            """{"directory":"${repo}","payload":{"type":"session.created","properties":{"info":{"id":"ses_b","directory":"${repo}"}}}}""",
        )

        assertTrue(mock.awaitAgentManagerLists(1, timeout = 10_000))
        assertEquals(repo.toString(), mock.agentManagerListDirectories.first())
        assertTrue(mock.awaitAgentManagerReplies(1, timeout = 10_000))
        val answer = mock.agentManagerReplies.single()
        assertEquals("amr_7", answer.requestID)
        assertEquals(repo.toString(), answer.directory)
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
        assertEquals("amr_8", mock.agentManagerReplies.single().requestID)
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
        val result = json.parseToJsonElement(mock.agentManagerReplies.single().body).jsonObject["result"]!!.jsonObject
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
        val result = json.parseToJsonElement(mock.agentManagerReplies.single().body).jsonObject["result"]!!.jsonObject
        assertEquals(true, result["stopped"]!!.jsonPrimitive.content.toBoolean())
    }

    // ---- workspace routing (review feedback) ----

    @Test
    fun `a reply carries the directory query so it reaches the right workspace instance`() = runBlocking {
        // `/kilocode/agent-manager/{id}/reply` is workspace-routed and the pending set is per-directory
        // instance state. Without `?directory=` the POST lands on the server's process.cwd() instance,
        // finds no pending entry, 404s, and the CLI request hangs until its 60s timeout.
        mock.sessions = "[]"
        val app = setup()
        ready(app)

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_10","sessionID":"ses_a","operation":"overview"}"""),
        )

        assertTrue(mock.awaitAgentManagerReplies(1, timeout = 10_000))
        assertEquals(repo.toString(), mock.agentManagerReplies.single().directory)
    }

    @Test
    fun `a reject carries the directory query too`() = runBlocking {
        val app = setup()
        ready(app)

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_11","sessionID":"ses_a","operation":"move","targetSessionID":"ses_b","sectionID":null}"""),
        )

        assertTrue(mock.awaitAgentManagerRejects(1, timeout = 10_000))
        assertEquals(repo.toString(), mock.agentManagerRejects.single().directory)
    }

    @Test
    fun `reconciliation lists each observed directory separately with its own directory query`() = runBlocking {
        // A single un-parameterised GET would only ever see the server's process.cwd() instance, so
        // nothing would be reconciled for the directories this backend actually serves.
        val other = Files.createTempDirectory("kilo-agent-manager-other")
        try {
            val app = setup()
            ready(app)

            mock.pushEvent(
                "session.created",
                """{"directory":"${repo}","payload":{"type":"session.created","properties":{"info":{"id":"ses_a","directory":"${repo}"}}}}""",
            )
            mock.pushEvent(
                "session.created",
                """{"directory":"$other","payload":{"type":"session.created","properties":{"info":{"id":"ses_b","directory":"$other"}}}}""",
            )

            assertTrue(mock.awaitAgentManagerLists(2, timeout = 10_000))
            val listed = mock.agentManagerListDirectories.filterNotNull().toSet()
            assertTrue(repo.toString() in listed, "expected $repo among $listed")
            assertTrue(other.toString() in listed, "expected $other among $listed")
        } finally {
            delete(other)
        }
    }

    @Test
    fun `a stop whose abort fails is rejected instead of reporting stopped`() = runBlocking {
        // KiloBackendChatManager.abort logs and returns on a non-2xx by default; reporting
        // `stopped: true` for a failed abort would tell the model the session was stopped when it
        // was not.
        mock.sessions = """[{"id":"ses_b","slug":"s","projectID":"p","directory":"${repo}","title":"T","version":"1","time":{"created":1,"updated":1}}]"""
        mock.sessionAbortStatus = 500
        val app = setup()
        ready(app)
        app.sessions.list(repo.toString())

        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_12","sessionID":"ses_a","operation":"stop","targetSessionID":"ses_b"}"""),
        )

        assertTrue(mock.awaitAgentManagerRejects(1, timeout = 10_000))
        assertEquals(0, mock.agentManagerReplies.size)
        val error = json.parseToJsonElement(mock.agentManagerRejects.single().body).jsonObject["error"]!!.jsonObject
        assertEquals("host_error", error["code"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a malformed agent manager event is dropped without killing the event stream`() = runBlocking {
        // route() runs inside events.collect, so an escaping exception would silently disable
        // agent_manager handling for the rest of the connection.
        mock.sessions = "[]"
        val app = setup()
        ready(app)

        mock.pushEvent(
            AgentManagerProtocol.START_EVENT,
            """{"directory":"${repo}","payload":{"type":"${AgentManagerProtocol.START_EVENT}","properties":{"requestID":"am-bad","sessionID":"ses_a","mode":"worktree","tasks":"not-an-array"}}}""",
        )
        // The stream must still serve the next request.
        mock.pushEvent(
            AgentManagerProtocol.REQUESTED_EVENT,
            envelope(repo.toString(), AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_13","sessionID":"ses_a","operation":"overview"}"""),
        )

        assertTrue(mock.awaitAgentManagerReplies(1, timeout = 10_000))
        assertEquals("amr_13", mock.agentManagerReplies.single().requestID)
    }
}
