package ai.kilocode.backend.cli

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pure unit tests for [KiloCliDataParser].
 *
 * No mocks, no services, no coroutines — just JSON in → DTO out.
 * When a new parsing bug is found, copy the raw JSON that caused
 * the issue and add a test case here.
 */
class KiloCliDataParserTest {

    // ================================================================
    // extractEventType
    // ================================================================

    @Test
    fun `extractEventType - parses type from JSON data`() {
        val result = KiloCliDataParser.extractEventType(
            """{"type":"global.config.updated","payload":{}}"""
        )
        assertEquals("global.config.updated", result)
    }

    @Test
    fun `extractEventType - returns unknown for missing type`() {
        assertEquals("unknown", KiloCliDataParser.extractEventType("""{"data":"something"}"""))
    }

    @Test
    fun `extractEventType - returns unknown for empty string`() {
        assertEquals("unknown", KiloCliDataParser.extractEventType(""))
    }

    // ================================================================
    // parseChatEvent — GlobalEvent wrapper
    // ================================================================

    @Test
    fun `parseChatEvent - message updated with GlobalEvent wrapper`() {
        val data = """{
            "directory": "/tmp/test",
            "payload": {
                "type": "message.updated",
                "properties": {
                    "sessionID": "ses_123",
                    "info": {
                        "id": "msg_1",
                        "sessionID": "ses_123",
                        "role": "assistant",
                        "time": { "created": 1000.0 }
                    }
                }
            }
        }"""

        val result = KiloCliDataParser.parseChatEvent("message.updated", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.MessageUpdated)
        assertEquals("ses_123", result.sessionID)
        assertEquals("msg_1", result.info.id)
        assertEquals("assistant", result.info.role)
    }

    @Test
    fun `parseChatEvent - flat event without payload wrapper`() {
        val data = """{
            "type": "message.updated",
            "properties": {
                "sessionID": "ses_456",
                "info": {
                    "id": "msg_2",
                    "sessionID": "ses_456",
                    "role": "user",
                    "time": { "created": 2000.0 }
                }
            }
        }"""

        val result = KiloCliDataParser.parseChatEvent("message.updated", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.MessageUpdated)
        assertEquals("ses_456", result.sessionID)
        assertEquals("user", result.info.role)
    }

    // ================================================================
    // parseChatEvent — specific event types
    // ================================================================

    @Test
    fun `parseChatEvent - message part delta`() {
        val data = globalEvent("""
            "type": "message.part.delta",
            "properties": {
                "sessionID": "ses_1",
                "messageID": "msg_1",
                "partID": "part_1",
                "field": "text",
                "delta": "Hello world"
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("message.part.delta", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.PartDelta)
        assertEquals("ses_1", result.sessionID)
        assertEquals("msg_1", result.messageID)
        assertEquals("part_1", result.partID)
        assertEquals("text", result.field)
        assertEquals("Hello world", result.delta)
    }

    @Test
    fun `parseChatEvent - message part updated`() {
        val data = globalEvent("""
            "type": "message.part.updated",
            "properties": {
                "sessionID": "ses_1",
                "part": {
                    "id": "part_1",
                    "sessionID": "ses_1",
                    "messageID": "msg_1",
                    "type": "text",
                    "text": "Hello"
                }
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("message.part.updated", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.PartUpdated)
        assertEquals("ses_1", result.sessionID)
        assertEquals("part_1", result.part.id)
        assertEquals("text", result.part.type)
        assertEquals("Hello", result.part.text)
    }

    @Test
    fun `parseChatEvent - turn open`() {
        val data = globalEvent("""
            "type": "session.turn.open",
            "properties": { "sessionID": "ses_1" }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.turn.open", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.TurnOpen)
        assertEquals("ses_1", result.sessionID)
    }

    @Test
    fun `parseChatEvent - turn close`() {
        val data = globalEvent("""
            "type": "session.turn.close",
            "properties": { "sessionID": "ses_1", "reason": "completed" }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.turn.close", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.TurnClose)
        assertEquals("ses_1", result.sessionID)
        assertEquals("completed", result.reason)
    }

    @Test
    fun `parseChatEvent - session error`() {
        val data = globalEvent("""
            "type": "session.error",
            "properties": {
                "sessionID": "ses_1",
                "error": { "type": "provider_auth", "message": "Invalid key" }
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.error", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.Error)
        assertEquals("ses_1", result.sessionID)
        assertEquals("provider_auth", result.error?.type)
        assertEquals("Invalid key", result.error?.message)
    }

    @Test
    fun `parseChatEvent - message removed`() {
        val data = globalEvent("""
            "type": "message.removed",
            "properties": { "sessionID": "ses_1", "messageID": "msg_1" }
        """)

        val result = KiloCliDataParser.parseChatEvent("message.removed", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.MessageRemoved)
        assertEquals("ses_1", result.sessionID)
        assertEquals("msg_1", result.messageID)
    }

    // ================================================================
    // parseChatEvent — error cases
    // ================================================================

    @Test
    fun `parseChatEvent - unknown type returns null`() {
        val data = globalEvent("""
            "type": "some.unknown.event",
            "properties": { "sessionID": "ses_1" }
        """)
        assertNull(KiloCliDataParser.parseChatEvent("some.unknown.event", data))
    }

    @Test
    fun `parseChatEvent - malformed JSON returns null`() {
        assertNull(KiloCliDataParser.parseChatEvent("message.updated", "not json"))
    }

    @Test
    fun `parseChatEvent - missing properties returns null`() {
        assertNull(KiloCliDataParser.parseChatEvent("message.updated", """{"payload":{"type":"x"}}"""))
    }

    @Test
    fun `parseChatEvent - missing sessionID returns null`() {
        val data = globalEvent("""
            "type": "message.updated",
            "properties": { "info": { "id": "msg_1", "role": "user", "time": {} } }
        """)
        assertNull(KiloCliDataParser.parseChatEvent("message.updated", data))
    }

    // ================================================================
    // parseSessionStatus
    // ================================================================

    @Test
    fun `parseSessionStatus - valid status event`() {
        val data = """{"sessionID":"ses_abc","status":{"type":"busy","message":"Running..."}}"""
        val result = KiloCliDataParser.parseSessionStatus(data)
        assertNotNull(result)
        assertEquals("ses_abc", result.first)
        assertEquals("busy", result.second.type)
        assertEquals("Running...", result.second.message)
    }

    @Test
    fun `parseSessionStatus - missing sessionID returns null`() {
        val data = """{"status":{"type":"idle"}}"""
        assertNull(KiloCliDataParser.parseSessionStatus(data))
    }

    @Test
    fun `parseSessionStatus - missing status defaults to idle`() {
        val data = """{"sessionID":"ses_xyz"}"""
        val result = KiloCliDataParser.parseSessionStatus(data)
        assertNotNull(result)
        assertEquals("idle", result.second.type)
        assertNull(result.second.message)
    }

    // ================================================================
    // parseSession
    // ================================================================

    @Test
    fun `parseSession - full session response`() {
        val raw = """{
            "id": "ses_abc",
            "projectID": "proj_1",
            "directory": "/tmp/project",
            "parentID": null,
            "title": "Test session",
            "version": "1",
            "time": { "created": 1000.0, "updated": 2000.0 },
            "summary": { "additions": 10, "deletions": 5, "files": 3 }
        }"""

        val result = KiloCliDataParser.parseSession(raw)
        assertEquals("ses_abc", result.id)
        assertEquals("proj_1", result.projectID)
        assertEquals("/tmp/project", result.directory)
        assertNull(result.parentID)
        assertEquals("Test session", result.title)
        assertEquals(1000.0, result.time.created)
        assertEquals(2000.0, result.time.updated)
        assertNotNull(result.summary)
        assertEquals(10, result.summary?.additions)
        assertEquals(5, result.summary?.deletions)
        assertEquals(3, result.summary?.files)
    }

    @Test
    fun `parseSession - minimal session response`() {
        val raw = """{
            "id": "ses_min",
            "projectID": "proj_2",
            "directory": "/tmp",
            "title": "",
            "version": "0",
            "time": { "created": 0.0, "updated": 0.0 }
        }"""

        val result = KiloCliDataParser.parseSession(raw)
        assertEquals("ses_min", result.id)
        assertNull(result.summary)
    }

    // ================================================================
    // parseMessages
    // ================================================================

    @Test
    fun `parseMessages - empty array`() {
        assertEquals(emptyList(), KiloCliDataParser.parseMessages("[]"))
    }

    @Test
    fun `parseMessages - user and assistant messages`() {
        val raw = """[
            {
                "info": { "id": "m1", "sessionID": "s1", "role": "user", "time": { "created": 1.0 } },
                "parts": [{ "id": "p1", "sessionID": "s1", "messageID": "m1", "type": "text", "text": "Hello" }]
            },
            {
                "info": { "id": "m2", "sessionID": "s1", "role": "assistant", "time": { "created": 2.0 } },
                "parts": [{ "id": "p2", "sessionID": "s1", "messageID": "m2", "type": "text", "text": "Hi there" }]
            }
        ]"""

        val result = KiloCliDataParser.parseMessages(raw)
        assertEquals(2, result.size)
        assertEquals("user", result[0].info.role)
        assertEquals("Hello", result[0].parts[0].text)
        assertEquals("assistant", result[1].info.role)
        assertEquals("Hi there", result[1].parts[0].text)
    }

    @Test
    fun `parseMessages - message with tool parts`() {
        val raw = """[{
            "info": { "id": "m1", "sessionID": "s1", "role": "assistant", "time": { "created": 1.0 } },
            "parts": [{
                "id": "p1",
                "sessionID": "s1",
                "messageID": "m1",
                "type": "tool",
                "tool": "read_file",
                "state": { "status": "completed", "title": "Read file.txt" }
            }]
        }]"""

        val result = KiloCliDataParser.parseMessages(raw)
        assertEquals(1, result.size)
        val part = result[0].parts[0]
        assertEquals("tool", part.type)
        assertEquals("read_file", part.tool)
        assertEquals("completed", part.state)
        assertEquals("Read file.txt", part.title)
    }

    @Test
    fun `parseMessages - malformed JSON returns empty`() {
        assertEquals(emptyList(), KiloCliDataParser.parseMessages("not json"))
    }

    @Test
    fun `parseMessages - message with tokens`() {
        val raw = """[{
            "info": {
                "id": "m1", "sessionID": "s1", "role": "assistant",
                "time": { "created": 1.0, "completed": 2.0 },
                "tokens": { "input": 100, "output": 50, "reasoning": 10, "cache": { "read": 20, "write": 5 } },
                "cost": 0.005
            },
            "parts": []
        }]"""

        val result = KiloCliDataParser.parseMessages(raw)
        val info = result[0].info
        assertNotNull(info.tokens)
        assertEquals(100L, info.tokens?.input)
        assertEquals(50L, info.tokens?.output)
        assertEquals(10L, info.tokens?.reasoning)
        assertEquals(20L, info.tokens?.cacheRead)
        assertEquals(5L, info.tokens?.cacheWrite)
        assertEquals(0.005, info.cost)
        assertEquals(2.0, info.time.completed)
    }

    // ================================================================
    // buildPromptJson
    // ================================================================

    @Test
    fun `buildPromptJson - text only`() {
        val prompt = PromptDto(parts = listOf(PromptPartDto("text", "Hello")))
        val result = KiloCliDataParser.buildPromptJson(prompt)
        assertEquals("""{"parts":[{"type":"text","text":"Hello"}]}""", result)
    }

    @Test
    fun `buildPromptJson - with model override`() {
        val prompt = PromptDto(
            parts = listOf(PromptPartDto("text", "Hi")),
            providerID = "anthropic",
            modelID = "claude-4",
        )
        val result = KiloCliDataParser.buildPromptJson(prompt)
        assertTrue(result.contains(""""model":{"providerID":"anthropic","modelID":"claude-4"}"""))
    }

    @Test
    fun `buildPromptJson - with agent`() {
        val prompt = PromptDto(
            parts = listOf(PromptPartDto("text", "Hi")),
            agent = "ask",
        )
        val result = KiloCliDataParser.buildPromptJson(prompt)
        assertTrue(result.contains(""""agent":"ask""""))
    }

    @Test
    fun `buildPromptJson - escapes special characters`() {
        val prompt = PromptDto(parts = listOf(PromptPartDto("text", "line1\nline2\t\"quoted\"")))
        val result = KiloCliDataParser.buildPromptJson(prompt)
        assertTrue(result.contains("""line1\nline2\t\"quoted\""""))
    }

    // ================================================================
    // buildConfigPartial
    // ================================================================

    @Test
    fun `buildConfigPartial - model only`() {
        val result = KiloCliDataParser.buildConfigPartial(ConfigUpdateDto(model = "anthropic/claude-4"))
        assertEquals("""{"model":"anthropic/claude-4"}""", result)
    }

    @Test
    fun `buildConfigPartial - agent and temperature`() {
        val result = KiloCliDataParser.buildConfigPartial(
            ConfigUpdateDto(agent = "code", temperature = 0.7)
        )
        assertTrue(result.contains(""""default_agent":"code""""))
        assertTrue(result.contains(""""agent":{"code":{"temperature":0.7}}"""))
    }

    @Test
    fun `buildConfigPartial - empty update`() {
        val result = KiloCliDataParser.buildConfigPartial(ConfigUpdateDto())
        assertEquals("{}", result)
    }

    @Test
    fun `buildConfigPartial - temperature without agent defaults to ask`() {
        val result = KiloCliDataParser.buildConfigPartial(ConfigUpdateDto(temperature = 0.5))
        assertTrue(result.contains(""""agent":{"ask":{"temperature":0.5}}"""))
    }

    // ================================================================
    // parseChatEvent — permission / question events
    // ================================================================

    @Test
    fun `parseChatEvent - permission asked`() {
        val data = globalEvent("""
            "type": "permission.asked",
            "properties": {
                "id": "perm_1",
                "sessionID": "ses_1",
                "permission": "edit",
                "patterns": ["*.kt"],
                "always": [],
                "metadata": {"file": "src/A.kt"},
                "tool": {"messageID": "msg_1", "callID": "call_1"}
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("permission.asked", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.PermissionAsked)
        assertEquals("ses_1", result.sessionID)
        assertEquals("perm_1", result.request.id)
        assertEquals("edit", result.request.permission)
        assertEquals(listOf("*.kt"), result.request.patterns)
        assertEquals("src/A.kt", result.request.metadata["file"])
        assertEquals("msg_1", result.request.tool?.messageID)
    }

    @Test
    fun `parseChatEvent - permission replied`() {
        val data = globalEvent("""
            "type": "permission.replied",
            "properties": { "sessionID": "ses_1", "requestID": "perm_1" }
        """)

        val result = KiloCliDataParser.parseChatEvent("permission.replied", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.PermissionReplied)
        assertEquals("ses_1", result.sessionID)
        assertEquals("perm_1", result.requestID)
    }

    @Test
    fun `parseChatEvent - question asked`() {
        val data = globalEvent("""
            "type": "question.asked",
            "properties": {
                "id": "q_1",
                "sessionID": "ses_1",
                "questions": [{"question": "Pick one", "header": "Choice", "options": [{"label": "A", "description": "Option A"}]}],
                "tool": null
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("question.asked", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.QuestionAsked)
        assertEquals("ses_1", result.sessionID)
        assertEquals("q_1", result.request.id)
        assertEquals(1, result.request.questions.size)
        assertEquals("Pick one", result.request.questions[0].question)
        assertEquals("A", result.request.questions[0].options[0].label)
    }

    @Test
    fun `parseChatEvent - question replied`() {
        val data = globalEvent("""
            "type": "question.replied",
            "properties": { "sessionID": "ses_1", "requestID": "q_1" }
        """)

        val result = KiloCliDataParser.parseChatEvent("question.replied", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.QuestionReplied)
        assertEquals("q_1", result.requestID)
    }

    @Test
    fun `parseChatEvent - question rejected`() {
        val data = globalEvent("""
            "type": "question.rejected",
            "properties": { "sessionID": "ses_1", "requestID": "q_1" }
        """)

        val result = KiloCliDataParser.parseChatEvent("question.rejected", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.QuestionRejected)
        assertEquals("q_1", result.requestID)
    }

    // ================================================================
    // parseChatEvent — session.status with retry/offline detail
    // ================================================================

    @Test
    fun `parseChatEvent - session status idle`() {
        val data = globalEvent("""
            "type": "session.status",
            "properties": { "sessionID": "ses_1", "status": {"type": "idle"} }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.status", data) as ChatEventDto.SessionStatusChanged
        assertEquals("idle", result.status.type)
        assertNull(result.status.attempt)
        assertNull(result.status.requestID)
    }

    @Test
    fun `parseChatEvent - session status retry with attempt and next`() {
        val data = globalEvent("""
            "type": "session.status",
            "properties": {
                "sessionID": "ses_1",
                "status": {"type": "retry", "message": "Retrying...", "attempt": 2, "next": 5000}
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.status", data) as ChatEventDto.SessionStatusChanged
        assertEquals("retry", result.status.type)
        assertEquals("Retrying...", result.status.message)
        assertEquals(2, result.status.attempt)
        assertEquals(5000L, result.status.next)
    }

    @Test
    fun `parseChatEvent - session status offline with requestID`() {
        val data = globalEvent("""
            "type": "session.status",
            "properties": {
                "sessionID": "ses_1",
                "status": {"type": "offline", "message": "No network", "requestID": "req_abc"}
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.status", data) as ChatEventDto.SessionStatusChanged
        assertEquals("offline", result.status.type)
        assertEquals("No network", result.status.message)
        assertEquals("req_abc", result.status.requestID)
    }

    // ================================================================
    // parseChatEvent — message.part.removed
    // ================================================================

    @Test
    fun `parseChatEvent - message part removed`() {
        val data = globalEvent("""
            "type": "message.part.removed",
            "properties": { "sessionID": "ses_1", "messageID": "msg_1", "partID": "part_1" }
        """)

        val result = KiloCliDataParser.parseChatEvent("message.part.removed", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.PartRemoved)
        assertEquals("ses_1", result.sessionID)
        assertEquals("msg_1", result.messageID)
        assertEquals("part_1", result.partID)
    }

    // ================================================================
    // parseChatEvent — todo.updated
    // ================================================================

    @Test
    fun `parseChatEvent - todo updated`() {
        val data = globalEvent("""
            "type": "todo.updated",
            "properties": {
                "sessionID": "ses_1",
                "todos": [
                    {"content": "Write tests", "status": "in_progress", "priority": "high"},
                    {"content": "Review PR", "status": "pending", "priority": "medium"}
                ]
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("todo.updated", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.TodoUpdated)
        assertEquals("ses_1", result.sessionID)
        assertEquals(2, result.todos.size)
        assertEquals("Write tests", result.todos[0].content)
        assertEquals("high", result.todos[0].priority)
    }

    // ================================================================
    // parseChatEvent — session.idle / session.compacted / session.diff
    // ================================================================

    @Test
    fun `parseChatEvent - session idle`() {
        val data = globalEvent("""
            "type": "session.idle",
            "properties": { "sessionID": "ses_1" }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.idle", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.SessionIdle)
        assertEquals("ses_1", result.sessionID)
    }

    @Test
    fun `parseChatEvent - session compacted`() {
        val data = globalEvent("""
            "type": "session.compacted",
            "properties": { "sessionID": "ses_1" }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.compacted", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.SessionCompacted)
    }

    @Test
    fun `parseChatEvent - session diff`() {
        val data = globalEvent("""
            "type": "session.diff",
            "properties": {
                "sessionID": "ses_1",
                "diff": [{"file": "src/A.kt", "additions": 3, "deletions": 1, "patch": "@@ ..."}]
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("session.diff", data)
        assertNotNull(result)
        assertTrue(result is ChatEventDto.SessionDiffChanged)
        assertEquals(1, result.diff.size)
        assertEquals("src/A.kt", result.diff[0].file)
        assertEquals(3, result.diff[0].additions)
    }

    // ================================================================
    // parseChatEvent — part with callID
    // ================================================================

    @Test
    fun `parseChatEvent - part updated with callID`() {
        val data = globalEvent("""
            "type": "message.part.updated",
            "properties": {
                "sessionID": "ses_1",
                "part": {
                    "id": "part_1",
                    "sessionID": "ses_1",
                    "messageID": "msg_1",
                    "type": "tool",
                    "tool": "bash",
                    "callID": "call_abc",
                    "state": { "status": "running" }
                }
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("message.part.updated", data) as ChatEventDto.PartUpdated
        assertEquals("call_abc", result.part.callID)
        assertEquals("bash", result.part.tool)
    }

    // ================================================================
    // parseSessionStatus — full detail
    // ================================================================

    @Test
    fun `parseSessionStatus - retry preserves attempt and next`() {
        val data = globalEvent("""
            "type": "session.status",
            "properties": {
                "sessionID": "ses_retry",
                "status": {"type": "retry", "message": "Rate limited", "attempt": 3, "next": 10000}
            }
        """)
        val result = KiloCliDataParser.parseSessionStatus(data)
        assertNotNull(result)
        assertEquals("ses_retry", result.first)
        assertEquals("retry", result.second.type)
        assertEquals(3, result.second.attempt)
        assertEquals(10000L, result.second.next)
    }

    @Test
    fun `parseSessionStatus - offline preserves requestID`() {
        val data = globalEvent("""
            "type": "session.status",
            "properties": {
                "sessionID": "ses_off",
                "status": {"type": "offline", "message": "Offline", "requestID": "req_xyz"}
            }
        """)
        val result = KiloCliDataParser.parseSessionStatus(data)
        assertNotNull(result)
        assertEquals("req_xyz", result.second.requestID)
    }

    // ================================================================
    // buildPermissionReplyJson
    // ================================================================

    @Test
    fun `buildPermissionReplyJson - once reply`() {
        val result = KiloCliDataParser.buildPermissionReplyJson(PermissionReplyDto(reply = "once"))
        assertEquals("""{"reply":"once"}""", result)
    }

    @Test
    fun `buildPermissionReplyJson - always reply with message`() {
        val result = KiloCliDataParser.buildPermissionReplyJson(PermissionReplyDto(reply = "always", message = "approved"))
        assertTrue(result.contains(""""reply":"always""""))
        assertTrue(result.contains(""""message":"approved""""))
    }

    // ================================================================
    // buildPermissionAlwaysRulesJson
    // ================================================================

    @Test
    fun `buildPermissionAlwaysRulesJson - approved list`() {
        val result = KiloCliDataParser.buildPermissionAlwaysRulesJson(
            PermissionAlwaysRulesDto(approvedAlways = listOf("src/**"), deniedAlways = emptyList())
        )
        assertTrue(result.contains(""""approvedAlways":["src/**"]"""))
        assertTrue(result.contains(""""deniedAlways":[]"""))
    }

    // ================================================================
    // buildQuestionReplyJson
    // ================================================================

    @Test
    fun `buildQuestionReplyJson - single question single answer`() {
        val result = KiloCliDataParser.buildQuestionReplyJson(QuestionReplyDto(answers = listOf(listOf("A"))))
        assertEquals("""{"answers":[["A"]]}""", result)
    }

    @Test
    fun `buildQuestionReplyJson - multiple questions`() {
        val result = KiloCliDataParser.buildQuestionReplyJson(
            QuestionReplyDto(answers = listOf(listOf("A", "B"), listOf("Yes")))
        )
        assertEquals("""{"answers":[["A","B"],["Yes"]]}""", result)
    }

    // ================================================================
    // parsePermissionRequests / parseQuestionRequests
    // ================================================================

    @Test
    fun `parsePermissionRequests - parses list`() {
        val raw = """[
            {"id": "p1", "sessionID": "s1", "permission": "edit", "patterns": ["*.kt"], "always": [], "metadata": {}}
        ]"""
        val result = KiloCliDataParser.parsePermissionRequests(raw)
        assertEquals(1, result.size)
        assertEquals("p1", result[0].id)
        assertEquals("edit", result[0].permission)
    }

    @Test
    fun `parsePermissionRequests - empty list`() {
        assertEquals(emptyList(), KiloCliDataParser.parsePermissionRequests("[]"))
    }

    @Test
    fun `parseQuestionRequests - parses list`() {
        val raw = """[
            {"id": "q1", "sessionID": "s1", "questions": [{"question": "pick", "header": "h", "options": []}]}
        ]"""
        val result = KiloCliDataParser.parseQuestionRequests(raw)
        assertEquals(1, result.size)
        assertEquals("q1", result[0].id)
    }

    // ================================================================
    // Helpers
    // ================================================================

    /** Wrap payload content in a GlobalEvent structure. */
    private fun globalEvent(payload: String): String =
        """{"directory":"/tmp","payload":{$payload}}"""
}
