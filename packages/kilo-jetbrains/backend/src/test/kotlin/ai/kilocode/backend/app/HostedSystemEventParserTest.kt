package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.HostedIDs
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
        for (code in listOf("null", "\"Private error at /home/user\"", "\"workspace_setup_failed\"", "\"${"a".repeat(65)}\"", "{}")) {
            val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
                {"type":"cloud.status","properties":{"cloudStatus":{"type":"error",
                    "safeError":$code,"message":"Private server error","error":{"message":"Secret"}}}}
            """.trimIndent()))
            assertEquals("error", event.cloudStatus)
            assertNull(event.failure)
            assertNull(event.message)
            assertNull(event.detail)
            assertNull(event.output)
            assertFalse(event.outputTruncated)
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
        assertEquals("clone_1", event.stepID)
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
    fun `separate Cloud attempt command and phase snapshots retain their own identities and revisions`() {
        val attempt = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,
                "attemptId":"e718c48d-eae1-451a-a773-c84ddff94d59",
                "triggerMessageId":"msg_01a1a792125boXEU3GPUHuh0eH","revision":21,"timestamp":1793812765086,
                "step":"workspace_setup","message":"Preparation snapshot","action":"attempt_snapshot",
                "attempt":{"id":"e718c48d-eae1-451a-a773-c84ddff94d59","status":"failed","revision":21,
                    "completedAt":1793812765086,"safeError":"workspace_setup_failed"}}}}
        """.trimIndent()))
        val command = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,
                "attemptId":"e718c48d-eae1-451a-a773-c84ddff94d59",
                "triggerMessageId":"msg_01a1a792125boXEU3GPUHuh0eH","revision":19,"timestamp":1793812765084,
                "step":"setup_commands","message":"Preparation snapshot","action":"step_snapshot",
                "stepId":"setup_command:0","stepSnapshot":{"id":"setup_command:0","key":"setup_commands",
                    "kind":"setup_command","label":"Setup command 1","status":"failed","revision":19,
                    "commandIndex":0,"commandCount":1,"parentStepId":"phase:setup_commands",
                    "outputTail":"bash: line 1: cd: cloud-agent: No such file or directory\n",
                    "outputTruncated":false,"safeError":"Setup command 1 failed","exitCode":1}}}}
        """.trimIndent()))
        val phase = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,
                "attemptId":"e718c48d-eae1-451a-a773-c84ddff94d59",
                "triggerMessageId":"msg_01a1a792125boXEU3GPUHuh0eH","revision":20,"timestamp":1793812765085,
                "step":"setup_commands","message":"Preparation snapshot","action":"step_snapshot",
                "stepId":"phase:setup_commands","stepSnapshot":{"id":"phase:setup_commands","key":"setup_commands",
                    "kind":"phase","label":"setup commands","status":"failed","revision":20,
                    "safeError":"workspace_setup_failed"}}}}
        """.trimIndent()))

        assertEquals("attempt_failed", attempt.action)
        assertEquals("workspace_setup_failed", attempt.failure)
        assertNull(attempt.step)
        assertNull(attempt.stepID)
        assertNull(attempt.stepKind)
        assertNull(attempt.message)
        assertEquals(listOf(21L, 19L, 20L), listOf(attempt.revision, command.revision, phase.revision))
        assertEquals(attempt.attemptID, command.attemptID)
        assertEquals(attempt.attemptID, phase.attemptID)
        assertEquals(attempt.triggerMessageID, command.triggerMessageID)
        assertEquals("setup_commands", command.step)
        assertEquals("failed", command.action)
        assertEquals("setup_command:0", command.stepID)
        assertEquals("setup_command", command.stepKind)
        assertNull(command.failure)
        assertEquals("Setup command 1 failed (exit code 1)\nbash: line 1: cd: cloud-agent: No such file or directory\n", command.detail)
        assertEquals("bash: line 1: cd: cloud-agent: No such file or directory\n", command.output)
        assertFalse(command.outputTruncated)
        assertEquals("phase:setup_commands", phase.stepID)
        assertEquals("phase", phase.stepKind)
        assertEquals("workspace_setup_failed", phase.failure)
        assertEquals("setup commands failed", phase.detail)
    }

    @Test
    fun `failed setup command preserves the full provider bounded multiline output tail`() {
        val output = "  ${"x".repeat(125)}\n".repeat(512)
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"action":"step_snapshot",
                "step":"setup_commands","stepId":"setup_command:5",
                "stepSnapshot":{"id":"setup_command:5","kind":"setup_command","key":"setup_commands",
                    "label":"Setup command 6","status":"failed","exitCode":128,
                    "safeError":"Setup command 6 failed","outputTail":${JsonPrimitive(output)}}}}}
        """.trimIndent()))

        assertEquals(65_536, output.toByteArray().size)
        assertNull(event.failure)
        assertEquals("Setup command 6 failed (exit code 128)\n$output", event.detail)
        assertEquals("setup_command:5", event.stepID)
        assertEquals("setup_command", event.stepKind)
        assertEquals(output, event.output)
    }

    @Test
    fun `failed command without output retains its exit code and label`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"action":"step_snapshot",
                "stepSnapshot":{"id":"setup_command:0","key":"setup_commands","kind":"setup_command",
                    "label":"Setup command 1","status":"failed","safeError":"Setup command 1 failed","exitCode":1}}}}
        """.trimIndent()))

        assertEquals("Setup command 1 failed (exit code 1)", event.detail)
        assertEquals("setup_command:0", event.stepID)
    }

    @Test
    fun `failed command output retains blank lines and whitespace without trimming`() {
        val output = "\n  \t\n"
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"action":"step_snapshot",
                "stepSnapshot":{"label":"Setup command 1","status":"failed","exitCode":1,
                    "outputTail":${JsonPrimitive(output)}}}}}
        """.trimIndent()))

        assertEquals("Setup command 1 failed (exit code 1)\n$output", event.detail)
    }

    @Test
    fun `live command start retains the provider step kind and identity`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"action":"step_started",
                "step":"setup_commands","stepId":"setup_command:0","kind":"setup_command","label":"Setup command 1"}}}
        """.trimIndent()))

        assertEquals("setup_command:0", event.stepID)
        assertEquals("setup_command", event.stepKind)
    }

    @Test
    fun `live command failure retains its provider safe label and exit code`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"action":"step_failed",
                "step":"setup_commands","stepId":"setup_command:0","safeError":"Setup command 1 failed","exitCode":1}}}
        """.trimIndent()))

        assertEquals("setup_command:0", event.stepID)
        assertEquals("step_failed", event.action)
        assertEquals("Setup command 1 failed (exit code 1)", event.detail)
        assertNull(event.failure)
    }

    @Test
    fun `live step output hands off the complete chunk without trimming or treating it as an error`() {
        val output = "First line\n  ${"detail ".repeat(60)}\nLast line\n"
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"attemptId":"attempt_live",
                "revision":2,"timestamp":1234,"action":"step_output","step":"setup_commands",
                "stepId":"setup_command:0","output":${JsonPrimitive(output)}}}}
        """.trimIndent()))

        assertEquals("step_output", event.action)
        assertEquals("setup_command:0", event.stepID)
        assertEquals(output, event.output)
        assertFalse(event.outputTruncated)
        assertNull(event.detail)
        assertNull(event.failure)
    }

    @Test
    fun `step snapshot output exposes only a typed provider truncation flag`() {
        for (flag in listOf("true", "false", "\"true\"", "null", "{}")) {
            val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
                {"type":"preparing","properties":{"preparation":{"action":"step_snapshot",
                    "stepSnapshot":{"id":"setup_command:0","kind":"setup_command","status":"running",
                        "outputTail":"First line\nLast line\n","outputTruncated":$flag}}}}
            """.trimIndent()))

            assertEquals("First line\nLast line\n", event.output)
            assertEquals(flag == "true", event.outputTruncated)
        }
    }

    @Test
    fun `cloud status never exposes preparation output or raw cloud error strings`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"cloud.status","properties":{"cloudStatus":{"type":"error",
                "safeError":"Private error at /home/user","message":"Private server error"},
                "preparation":{"action":"step_output","output":"Private output","outputTruncated":true}}}
        """.trimIndent()))

        assertNull(event.failure)
        assertNull(event.message)
        assertNull(event.detail)
        assertNull(event.output)
        assertFalse(event.outputTruncated)
    }

    @Test
    fun `failed setup command without output exposes its safe error detail`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"action":"step_snapshot",
                "step":"setup_commands",
                "stepSnapshot":{"key":"setup_commands","label":"Setup command 6","status":"failed",
                    "safeError":"Setup command 6 failed"}}}}
        """.trimIndent()))

        assertNull(event.failure)
        assertEquals("Setup command 6 failed", event.detail)
    }

    @Test
    fun `provider safe error detail takes precedence over the synthesized failed label`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"action":"step_snapshot",
                "step":"setup_commands",
                "stepSnapshot":{"key":"setup_commands","label":"Setup command 6","status":"failed",
                    "safeError":"Permission denied"}}}}
        """.trimIndent()))

        assertNull(event.failure)
        assertEquals("Permission denied", event.detail)
    }

    @Test
    fun `failed setup command without output or safe error falls back to its label`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"action":"step_snapshot",
                "step":"setup_commands",
                "stepSnapshot":{"key":"setup_commands","label":"Setup command 6","status":"failed"}}}}
        """.trimIndent()))

        assertNull(event.failure)
        assertEquals("Setup command 6 failed", event.detail)
    }

    @Test
    fun `failed attempt without a failed step keeps its safe error detail`() {
        val event = assertNotNull(HostedSystemEventParser.parse(session, native, null, """
            {"type":"preparing","properties":{"preparation":{"version":2,"action":"attempt_snapshot",
                "attempt":{"status":"failed","safeError":"Preparation did not complete"}}}}
        """.trimIndent()))

        assertNull(event.failure)
        assertEquals("Preparation did not complete", event.detail)
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
