package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.agentmanager.AgentManagerProtocol.ErrorCode
import ai.kilocode.backend.agentmanager.AgentManagerProtocol.Request
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentManagerProtocolTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun envelope(directory: String, type: String, properties: String) =
        """{"directory":"$directory","payload":{"type":"$type","properties":$properties}}"""

    @Test
    fun `parseRequest reads an overview request through the GlobalEvent envelope`() {
        val data = envelope(
            "/repo",
            AgentManagerProtocol.REQUESTED_EVENT,
            """{"id":"amr_1","sessionID":"ses_a","operation":"overview","filter":{"states":["idle","busy"]}}""",
        )
        val request = AgentManagerProtocol.parseRequest(AgentManagerProtocol.REQUESTED_EVENT, data)
        val overview = assertIs<Request.Overview>(request)
        assertEquals("amr_1", overview.id)
        assertEquals("ses_a", overview.sessionID)
        assertEquals(listOf("idle", "busy"), overview.states)
        assertNull(overview.sectionIDs)
    }

    @Test
    fun `parseRequest reads a flat event without the GlobalEvent wrapper`() {
        val data = """{"type":"${AgentManagerProtocol.REQUESTED_EVENT}","properties":{"id":"amr_2","sessionID":"ses_a","operation":"stop","targetSessionID":"ses_b"}}"""
        val request = AgentManagerProtocol.parseRequest(AgentManagerProtocol.REQUESTED_EVENT, data)
        val stop = assertIs<Request.Stop>(request)
        assertEquals("ses_b", stop.targetSessionID)
    }

    @Test
    fun `parseRequest reads a prompt request with replyTo`() {
        val data = envelope(
            "/repo",
            AgentManagerProtocol.REQUESTED_EVENT,
            """{"id":"amr_3","sessionID":"ses_a","operation":"prompt","targetSessionID":"ses_b","sourceSessionID":"ses_a","prompt":"hello","replyTo":"amr_0"}""",
        )
        val request = assertIs<Request.Prompt>(AgentManagerProtocol.parseRequest(AgentManagerProtocol.REQUESTED_EVENT, data))
        assertEquals("hello", request.prompt)
        assertEquals("amr_0", request.replyTo)
        assertEquals("ses_a", request.sourceSessionID)
    }

    @Test
    fun `parseRequest reads a move request with a null sectionID`() {
        val data = envelope(
            "/repo",
            AgentManagerProtocol.REQUESTED_EVENT,
            """{"id":"amr_4","sessionID":"ses_a","operation":"move","targetSessionID":"ses_b","sectionID":null}""",
        )
        val request = assertIs<Request.Move>(AgentManagerProtocol.parseRequest(AgentManagerProtocol.REQUESTED_EVENT, data))
        assertNull(request.sectionID)
    }

    @Test
    fun `parseRequest reads an answer request with multi-select rows`() {
        val data = envelope(
            "/repo",
            AgentManagerProtocol.REQUESTED_EVENT,
            """{"id":"amr_5","sessionID":"ses_a","operation":"answer","targetSessionID":"ses_b","questionID":"q1","answers":[["yes"],["a","b"]]}""",
        )
        val request = assertIs<Request.Answer>(AgentManagerProtocol.parseRequest(AgentManagerProtocol.REQUESTED_EVENT, data))
        assertEquals("q1", request.questionID)
        assertEquals(listOf(listOf("yes"), listOf("a", "b")), request.answers)
    }

    @Test
    fun `parseRequest returns null for a different event type`() {
        val data = envelope("/repo", "session.updated", """{"id":"amr_1","sessionID":"ses_a","operation":"overview"}""")
        assertNull(AgentManagerProtocol.parseRequest("session.updated", data))
    }

    @Test
    fun `parseRequest returns null for malformed json`() {
        assertNull(AgentManagerProtocol.parseRequest(AgentManagerProtocol.REQUESTED_EVENT, "not json"))
    }

    @Test
    fun `parseRequest returns null when a required field is missing`() {
        val data = envelope("/repo", AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_1","operation":"overview"}""")
        assertNull(AgentManagerProtocol.parseRequest(AgentManagerProtocol.REQUESTED_EVENT, data))
    }

    @Test
    fun `parseRequest returns null for an unknown operation`() {
        val data = envelope("/repo", AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_1","sessionID":"ses_a","operation":"bogus"}""")
        assertNull(AgentManagerProtocol.parseRequest(AgentManagerProtocol.REQUESTED_EVENT, data))
    }

    @Test
    fun `parseCancelled reads requestID and sessionID`() {
        val data = envelope("/repo", AgentManagerProtocol.CANCELLED_EVENT, """{"requestID":"amr_1","sessionID":"ses_a","reason":"timeout"}""")
        val cancelled = AgentManagerProtocol.parseCancelled(AgentManagerProtocol.CANCELLED_EVENT, data)
        assertEquals("amr_1", cancelled?.requestID)
        assertEquals("ses_a", cancelled?.sessionID)
    }

    @Test
    fun `parseStart reads tasks including model overrides`() {
        val data = envelope(
            "/repo",
            AgentManagerProtocol.START_EVENT,
            """{"requestID":"am-1","sessionID":"ses_a","mode":"worktree","tasks":[
                {"prompt":"do thing","name":"Task A","branchName":"feature-a","model":{"providerID":"anthropic","modelID":"claude"},"variant":"high"}
            ]}""",
        )
        val start = AgentManagerProtocol.parseStart(AgentManagerProtocol.START_EVENT, data)
        assertEquals("am-1", start?.requestID)
        assertEquals("worktree", start?.mode)
        assertEquals(1, start?.tasks?.size)
        val task = start!!.tasks.single()
        assertEquals("do thing", task.prompt)
        assertEquals("feature-a", task.branchName)
        assertEquals("anthropic", task.providerID)
        assertEquals("claude", task.modelID)
        assertEquals("high", task.variant)
    }

    @Test
    fun `parseStart returns null for an empty task list`() {
        val data = envelope("/repo", AgentManagerProtocol.START_EVENT, """{"requestID":"am-1","sessionID":"ses_a","mode":"local","tasks":[]}""")
        assertNull(AgentManagerProtocol.parseStart(AgentManagerProtocol.START_EVENT, data))
    }

    @Test
    fun `parsePendingRequests reads a bare array from the GET endpoint`() {
        val raw = """[
            {"id":"amr_1","sessionID":"ses_a","operation":"overview"},
            {"id":"amr_2","sessionID":"ses_a","operation":"stop","targetSessionID":"ses_b"}
        ]"""
        val requests = AgentManagerProtocol.parsePendingRequests(raw)
        assertEquals(2, requests.size)
        assertIs<Request.Overview>(requests[0])
        assertIs<Request.Stop>(requests[1])
    }

    @Test
    fun `parsePendingRequests drops a malformed element instead of failing the whole list`() {
        val raw = """[{"id":"amr_1","sessionID":"ses_a","operation":"overview"},{"bogus":true}]"""
        val requests = AgentManagerProtocol.parsePendingRequests(raw)
        assertEquals(1, requests.size)
    }

    @Test
    fun `envelopeDirectory reads the GlobalEvent directory field`() {
        val data = envelope("/repo/path", AgentManagerProtocol.REQUESTED_EVENT, """{"id":"amr_1","sessionID":"ses_a","operation":"overview"}""")
        assertEquals("/repo/path", AgentManagerProtocol.envelopeDirectory(data))
    }

    @Test
    fun `envelopeDirectory returns null for a flat event with no directory`() {
        val data = """{"type":"x","properties":{}}"""
        assertNull(AgentManagerProtocol.envelopeDirectory(data))
    }

    @Test
    fun `replyBody for prompt matches the protocol result shape`() {
        val request = Request.Prompt("amr_1", "ses_a", "ses_b", "ses_a", "hi", null)
        val body = json.parseToJsonElement(AgentManagerProtocol.replyBody(request)).jsonObject
        val result = body["result"]!!.jsonObject
        assertEquals("prompt", result["operation"]!!.jsonPrimitive.content)
        assertEquals("ses_b", result["sessionID"]!!.jsonPrimitive.content)
        assertTrue(result["delivered"]!!.jsonPrimitive.content.toBoolean())
    }

    @Test
    fun `rejectBody carries the wire error code and message`() {
        val body = json.parseToJsonElement(AgentManagerProtocol.rejectBody(ErrorCode.UNKNOWN_SECTION, "no sections here")).jsonObject
        val error = body["error"]!!.jsonObject
        assertEquals("unknown_section", error["code"]!!.jsonPrimitive.content)
        assertEquals("no sections here", error["message"]!!.jsonPrimitive.content)
    }
}
