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
    fun `safe failure code is separate from simultaneous progress detail and trigger identity`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"attemptId":"attempt_1",
                "triggerMessageId":"msg_1","action":"step_failed","step":"workspace_setup",
                "detail":"Finishing setup","safeError":"workspace_setup_failed","revision":8,"timestamp":1234}}}
        """.trimIndent()))
        assertEquals("Finishing setup", event.message)
        assertEquals("workspace_setup_failed", event.failure)
        assertEquals("msg_1", event.triggerMessageID)
    }

    @Test
    fun `failed attempt snapshot replays explicit safe code without its generic message`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"action":"attempt_snapshot",
                "message":"Preparation snapshot","attempt":{"id":"attempt_1","status":"failed",
                "triggerMessageId":"msg_1","safeError":"workspace_setup_failed","revision":9}}}}
        """.trimIndent()))
        assertEquals("attempt_failed", event.action)
        assertEquals("workspace_setup_failed", event.failure)
        assertNull(event.message)
    }

    @Test
    fun `cloud error has generic failure semantics without forwarding raw errors`() {
        for (code in listOf("null", "\"Private error at /home/user\"", "\"${"a".repeat(65)}\"", "{}")) {
            val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
                {"type":"cloud.status","properties":{"cloudStatus":{"type":"error",
                    "safeError":$code,"message":"Private server error","error":{"message":"Secret"}}}}
            """.trimIndent()))
            assertEquals("error", event.cloudStatus)
            assertNull(event.failure)
            assertNull(event.message)
        }
    }

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
    fun `canonical progress detail and timestamp take precedence over generic labels and other clocks`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"sessionID":"ses_cloud","observedAt":9000,
                "sandbox":{"status":"sleeping","observedAt":10000},"preparation":{"version":2,"attemptId":"attempt_1",
                "triggerMessageId":"msg_1","revision":3,"timestamp":1234,"action":"step_progress",
                "step":"cloning","stepId":"clone_1","message":"Cloning repo","detail":"Receiving objects: 33%"}}}
        """.trimIndent()))
        assertEquals("Receiving objects: 33%", event.message)
        assertEquals("step_progress", event.action)
        assertEquals("cloning", event.step)
        assertEquals(1234.0, event.observedAt)
        assertEquals("attempt_1", event.attemptID)
        assertEquals(3L, event.revision)
        assertNull(event.sandboxStatus)
    }

    @Test
    fun `materialized step snapshot prefers latest detail then label with its real revision`() {
        for (detail in listOf("\"Receiving objects: 66%\"", "null")) {
            val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
                {"type":"preparing","properties":{"preparation":{"version":2,"attemptId":"attempt_1",
                    "triggerMessageId":"msg_1","revision":6,"timestamp":2345,"action":"step_snapshot",
                    "step":"cloning","message":"Preparation snapshot","stepSnapshot":{"id":"clone_1",
                    "key":"cloning","label":"Cloning repo","status":"running","startedAt":1200,
                    "revision":6,"latestDetail":$detail}}}}
            """.trimIndent()))
            assertEquals(if (detail == "null") "Cloning repo" else "Receiving objects: 66%", event.message)
            assertEquals("running", event.action)
            assertEquals(2345.0, event.observedAt)
            assertEquals("attempt_1", event.attemptID)
            assertEquals(6L, event.revision)
        }
    }

    @Test
    fun `attempt snapshots distinguish whole preparation completion from step completion`() {
        for ((status, action) in listOf("running" to "attempt_started", "completed" to "attempt_completed",
            "failed" to "attempt_failed")) {
            val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
                {"type":"preparing","properties":{"preparation":{"version":2,"attemptId":"attempt_1",
                    "triggerMessageId":"msg_1","revision":7,"timestamp":3456,"action":"attempt_snapshot",
                    "step":"workspace_setup","message":"Preparation snapshot","attempt":{"id":"attempt_1",
                    "triggerMessageId":"msg_1","status":"$status","startedAt":1000,"revision":7}}}}
            """.trimIndent()))
            assertEquals(action, event.action)
            assertNull(event.step)
            assertNull(event.message)
            assertEquals(3456.0, event.observedAt)
            assertEquals(7L, event.revision)
        }
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"attemptId":"attempt_1",
                "revision":8,"timestamp":4567,"action":"step_completed","step":"cloning","message":"Cloned"}}}
        """.trimIndent()))
        assertEquals("step_completed", event.action)
        assertEquals("Cloned", event.message)
    }

    @Test
    fun `absent preparation timestamps stay unknown and never borrow sandbox clock`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"sandbox":{"observedAt":9999},"preparation":{
                "version":2,"attemptId":"attempt_1","revision":2,"action":"step_progress",
                "step":"cloning","message":"Cloning repo","detail":"Receiving objects: 33%"}}}
        """.trimIndent()))
        assertEquals(0.0, event.observedAt)
        assertEquals("Receiving objects: 33%", event.message)
        assertEquals(2L, event.revision)
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
