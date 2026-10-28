package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.HostedIDs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class HostedSystemEventParserTest {
    private val native = "ses_cloud"
    private val session = HostedIDs.session("cloud", "wrk_1", native)

    @Test
    fun `structured cloud preparation selects the latest progressing step`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"cloud.status","properties":{"sessionID":"ses_cloud","cloudStatus":{"type":"preparing","steps":[
                {"step":"creating_workspace","status":"completed"},
                {"step":"starting_sandbox","status":"in_progress","message":"Starting sandbox"},
                {"step":"cloning","status":"in_progress","message":"Cloning repository"},
                {"step":"ready","status":"pending"}
            ]},"observedAt":1234}}
        """.trimIndent()))
        assertEquals(session, event.sessionID)
        assertEquals("cloud.status", event.kind)
        assertEquals("preparing", event.cloudStatus)
        assertEquals("cloning", event.step)
        assertEquals("in_progress", event.action)
        assertEquals("Cloning repository", event.message)
        assertEquals(1234.0, event.observedAt)
    }

    @Test
    fun `preparation steps use the final completed or failed step when nothing is progressing`() {
        for (status in listOf("completed", "failed")) {
            val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
                {"type":"cloud.status","properties":{"cloudStatus":{"type":"ready"},"preparation":{"steps":[
                    {"step":"starting_sandbox","status":"completed"},
                    {"step":"cloning","status":"$status","message":"Preparation finished"},
                    {"step":"ready","status":"pending"}
                ]}}}
            """.trimIndent()))
            assertEquals("cloning", event.step)
            assertEquals(status, event.action)
            assertEquals("Preparation finished", event.message)
            assertEquals("ready", event.cloudStatus)
        }
    }

    @Test
    fun `canonical cloud lifecycle step and preparation events retain their nested fields`() {
        val cloud = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"cloud.status","properties":{"sessionID":"ses_cloud","cloudStatus":{"type":"preparing","step":"cloning","message":"Cloning repository"}}}
        """.trimIndent()))
        assertEquals("preparing", cloud.cloudStatus)
        assertEquals("cloning", cloud.step)
        assertEquals("Cloning repository", cloud.message)
        val preparation = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"sessionID":"ses_cloud","preparation":{"version":2,"action":"step_started","step":"cloning","message":"Cloning repository"}}}
        """.trimIndent()))
        assertEquals("preparing", preparation.kind)
        assertEquals("cloning", preparation.step)
        assertEquals("step_started", preparation.action)
        assertEquals("Cloning repository", preparation.message)
    }

    @Test
    fun `materialized preparation snapshot projects its actual step status and detail`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"action":"step_snapshot","step":"cloning",
                "stepSnapshot":{"key":"cloning","status":"running","latestDetail":"Fetching repository"}}}}
        """.trimIndent()))
        assertEquals("cloning", event.step)
        assertEquals("running", event.action)
        assertEquals("Fetching repository", event.message)
    }

    @Test
    fun `sandbox states and details use nested observation time and preserve workspace identity`() {
        for (state in listOf("running", "starting", "unavailable", "idle")) {
            val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
                {"type":"cloud.sandbox.status","properties":{"sessionID":"ses_cloud","sandbox":{"state":"$state","detailCode":"sandbox_$state","observedAt":5678},"observedAt":1234}}
            """.trimIndent()))
            assertEquals(session, event.sessionID)
            assertEquals("cloud.sandbox.status", event.kind)
            assertEquals(state, event.sandboxStatus)
            assertEquals("sandbox_$state", event.sandboxDetail)
            assertEquals(5678.0, event.observedAt)
        }
        val other = HostedIDs.session("cloud", "wrk_2", native)
        val event = assertNotNull(HostedSystemEventParser.parse(other, native, null,
            """{"type":"cloud.status","properties":{"cloudStatus":{"type":"ready"}}}"""))
        assertEquals(other, event.sessionID)
    }

    @Test
    fun `canonical sandbox snapshot status is parsed without scalar coercion`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"cloud.sandbox.status","properties":{"sessionID":"ses_cloud","sandbox":{"status":"starting","provider":"container","detailCode":"container_starting","observedAt":1234,"inactivityTimeoutMs":null,"estimatedSleepAt":null}}}
        """.trimIndent()))
        assertEquals("starting", event.sandboxStatus)
        assertEquals("container_starting", event.sandboxDetail)
        assertEquals(1234.0, event.observedAt)
    }

    @Test
    fun `other native session payloads and invalid session identifiers are ignored`() {
        for (id in listOf("\"ses_other\"", "{}", "[]", "false", "123")) {
            assertNull(HostedSystemEventParser.parse(session, native, null,
                """{"type":"cloud.status","properties":{"sessionID":$id,"cloudStatus":{"type":"ready"}}}"""))
        }
    }

    @Test
    fun `malformed envelopes and non system events do not crash`() {
        for (data in listOf(
            "{", "null", "[]", "true", "\"cloud.status\"", "{}",
            """{"type":"cloud.status","properties":[]} """,
            """{"type":"cloud.status","properties":null} """,
            """{"type":{},"properties":{}}""",
            """{"payload":false}""",
            """{"payload":null}""",
            """{"type":"message.updated","properties":{}}""",
        )) {
            assertNull(HostedSystemEventParser.parse(session, native, null, data), data)
        }
    }

    @Test
    fun `mixed objects scalars arrays and null fields never become coerced status strings`() {
        for (value in listOf("null", "{}", "[]", "false", "123", "\"idle\"")) {
            val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
                {"type":"cloud.status","properties":{"sessionID":null,"cloudStatus":$value,"preparation":$value,"sandbox":$value,"observedAt":$value}}
            """.trimIndent()))
            assertNull(event.cloudStatus)
            assertNull(event.sandboxStatus)
            assertNull(event.sandboxDetail)
            assertNull(event.step)
            assertNull(event.action)
            assertNull(event.message)
            assertEquals(if (value == "123") 123.0 else 0.0, event.observedAt)
        }
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"cloud.status","properties":{"cloudStatus":{"type":{}},"preparation":{"steps":[null,false,"idle",{"step":{},"status":[]},{"step":"cloning","status":"running","message":null}]},"sandbox":{"state":[],"detailCode":{},"observedAt":{}},"observedAt":1234}}
        """.trimIndent()))
        assertEquals("cloning", event.step)
        assertEquals("running", event.action)
        assertNull(event.cloudStatus)
        assertNull(event.sandboxStatus)
        assertNull(event.sandboxDetail)
        assertNull(event.message)
        assertEquals(1234.0, event.observedAt)
    }

    @Test
    fun `wrapped payload and SSE type fallback keep the composite session ID`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, "cloud.status", """
            {"directory":"/provider/private","payload":{"properties":{"sessionID":"ses_cloud","cloudStatus":{"type":"ready"}}}}
        """.trimIndent()))
        assertEquals(session, event.sessionID)
        assertEquals("cloud.status", event.kind)
        assertEquals("ready", event.cloudStatus)
    }
}
