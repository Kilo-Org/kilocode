package ai.kilocode.backend.cli

import ai.kilocode.backend.workspace.CommandInfo
import ai.kilocode.backend.workspace.ProviderData
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import org.junit.jupiter.api.Nested
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Pure unit tests for [KiloCliDataParser].
 *
 * No mocks, no services, no coroutines — just JSON in → DTO out.
 * When a new parsing bug is found, copy the raw JSON that caused
 * the issue and add a test case here.
 *
 * Tests are grouped into three nested classes:
 *  - [SseEvents]  — SSE/chat event parsing
 *  - [HttpResponses] — HTTP response body parsing
 *  - [RequestBuilders] — outgoing JSON body builders and local model state
 */
class KiloCliDataParserTest {

    // ================================================================
    // Group 1 — SSE / chat event parsing
    // ================================================================

    @Nested
    inner class SseEvents {

        // ---- extractEventType ----

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

        // ---- parseChatEvent — GlobalEvent wrapper ----

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

        // ---- parseChatEvent — specific event types ----

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
        fun `parseChatEvent - read tool part preserves input metadata and time`() {
            val data = globalEvent("""
                "type": "message.part.updated",
                "properties": {
                    "sessionID": "ses_1",
                    "part": {
                        "id": "part_read",
                        "sessionID": "ses_1",
                        "messageID": "msg_1",
                        "type": "tool",
                        "tool": "read",
                        "callID": "call_read",
                        "metadata": { "loaded": ["README.MD"] },
                        "state": {
                            "status": "completed",
                            "input": { "filePath": "README.MD", "limit": 200 },
                            "metadata": { "source": "workspace" },
                            "title": "Read README.MD",
                            "time": { "start": 10, "end": 12 }
                        }
                    }
                }
            """)

            val result = KiloCliDataParser.parseChatEvent("message.part.updated", data)
            assertNotNull(result)
            assertTrue(result is ChatEventDto.PartUpdated)
            assertEquals("read", result.part.tool)
            assertEquals("completed", result.part.state)
            assertEquals("Read README.MD", result.part.title)
            assertEquals("README.MD", result.part.input["filePath"])
            assertEquals("200", result.part.input["limit"])
            assertEquals("workspace", result.part.metadata["source"])
            assertEquals("[\"README.MD\"]", result.part.metadata["loaded"])
            assertEquals(10.0, result.part.time?.start)
            assertEquals(12.0, result.part.time?.end)
        }

        @Test
        fun `parseChatEvent - bash tool part preserves command output and error`() {
            val data = globalEvent("""
                "type": "message.part.updated",
                "properties": {
                    "sessionID": "ses_1",
                    "part": {
                        "id": "part_bash",
                        "sessionID": "ses_1",
                        "messageID": "msg_1",
                        "type": "tool",
                        "tool": "bash",
                        "callID": "call_bash",
                        "state": {
                            "status": "error",
                            "input": {
                                "command": "git remote -v",
                                "description": "View git remote URLs"
                            },
                            "metadata": { "command": "git remote -v" },
                            "output": "origin git@example.com:repo.git",
                            "error": "exit code 1",
                            "time": { "start": 20, "end": 25 }
                        }
                    }
                }
            """)

            val result = KiloCliDataParser.parseChatEvent("message.part.updated", data)
            assertNotNull(result)
            assertTrue(result is ChatEventDto.PartUpdated)
            assertEquals("bash", result.part.tool)
            assertEquals("error", result.part.state)
            assertEquals("git remote -v", result.part.input["command"])
            assertEquals("View git remote URLs", result.part.input["description"])
            assertEquals("origin git@example.com:repo.git", result.part.output)
            assertEquals("exit code 1", result.part.error)
            assertEquals(20.0, result.part.time?.start)
            assertEquals(25.0, result.part.time?.end)
        }

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
        fun `parseChatEvent - session error preserves API error details`() {
            val data = globalEvent("""
                "type": "session.error",
                "properties": {
                    "sessionID": "ses_1",
                    "error": {
                        "name": "APIError",
                        "message": "Unauthorized",
                        "data": {
                            "statusCode": 401,
                            "responseBody": "{\"error\":{\"code\":\"PAID_MODEL_AUTH_REQUIRED\"}}"
                        }
                    }
                }
            """)

            val result = KiloCliDataParser.parseChatEvent("session.error", data)
            assertNotNull(result)
            assertTrue(result is ChatEventDto.Error)
            assertEquals("ses_1", result.sessionID)
            assertEquals("APIError", result.error?.type)
            assertEquals("Unauthorized", result.error?.message)
            assertEquals(401, result.error?.statusCode)
            assertEquals("""{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}""", result.error?.responseBody)
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

        // ---- session lifecycle events ----

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
        fun `parseChatEvent - session updated`() {
            val data = globalEvent("""
                "type": "session.updated",
                "properties": {
                    "sessionID": "ses_1",
                    "info": {
                        "id": "ses_1",
                        "projectID": "proj_1",
                        "directory": "/tmp/project",
                        "title": "Updated title",
                        "version": "1",
                        "time": { "created": 1.0, "updated": 2.0 },
                        "summary": { "additions": 3, "deletions": 1, "files": 2 }
                    }
                }
            """)

            val result = KiloCliDataParser.parseChatEvent("session.updated", data)
            assertNotNull(result)
            assertTrue(result is ChatEventDto.SessionUpdated)
            assertEquals("ses_1", result.sessionID)
            assertEquals("Updated title", result.session.title)
            assertEquals(2, result.session.summary?.files)
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

        @Test
        fun `parseChatEvent - session diff clamps large counts`() {
            val data = globalEvent("""
                "type": "session.diff",
                "properties": {
                    "sessionID": "ses_1",
                    "diff": [{"file": "src/A.kt", "additions": 2147483648, "deletions": 9223372036854775807, "patch": "@@ ..."}]
                }
            """)

            val result = KiloCliDataParser.parseChatEvent("session.diff", data) as ChatEventDto.SessionDiffChanged
            assertEquals(Int.MAX_VALUE, result.diff[0].additions)
            assertEquals(Int.MAX_VALUE, result.diff[0].deletions)
        }

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

        // ---- session status events ----

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
        fun `parseChatEvent - session status clamps large attempt`() {
            val data = globalEvent("""
                "type": "session.status",
                "properties": {
                    "sessionID": "ses_1",
                    "status": {"type": "retry", "message": "Retrying...", "attempt": 2147483648, "next": 9223372036854775807}
                }
            """)

            val result = KiloCliDataParser.parseChatEvent("session.status", data) as ChatEventDto.SessionStatusChanged
            assertEquals(Int.MAX_VALUE, result.status.attempt)
            assertEquals(Long.MAX_VALUE, result.status.next)
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

        // ---- permission / question events ----

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

        // ---- error cases ----

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

        // ---- parseSessionStatus ----

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

        // ---- parsePermissionRequests / parseQuestionRequests ----

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
    }

    // ================================================================
    // Group 2 — HTTP response parsing
    // ================================================================

    @Nested
    inner class HttpResponses {

        // ---- parseSession ----

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

        // ---- parseMessages ----

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
        fun `parseMessages - step finish part with tokens`() {
            val raw = """[{
                "info": { "id": "m1", "sessionID": "s1", "role": "assistant", "time": { "created": 1.0 } },
                "parts": [{
                    "id": "p1",
                    "sessionID": "s1",
                    "messageID": "m1",
                    "type": "step-finish",
                    "reason": "stop",
                    "cost": 0.005,
                    "tokens": { "input": 100, "output": 50, "reasoning": 10, "cache": { "read": 20, "write": 5 } }
                }]
            }]"""

            val part = KiloCliDataParser.parseMessages(raw)[0].parts[0]
            assertEquals("step-finish", part.type)
            assertEquals("stop", part.reason)
            assertEquals(0.005, part.cost)
            assertEquals(100L, part.tokens?.input)
            assertEquals(50L, part.tokens?.output)
            assertEquals(10L, part.tokens?.reasoning)
            assertEquals(20L, part.tokens?.cacheRead)
            assertEquals(5L, part.tokens?.cacheWrite)
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

        @Test
        fun `parseMessages - malformed JSON returns empty`() {
            assertEquals(emptyList(), KiloCliDataParser.parseMessages("not json"))
        }

        // ---- parseCloudSessions ----

        @Test
        fun `parseCloudSessions maps cloud session list`() {
            val raw = """{
                "cliSessions": [
                    {"session_id":"cloud_1","title":"Cloud One","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z","version":2},
                    {"session_id":"cloud_2","title":null,"created_at":"2026-01-03T00:00:00Z","updated_at":"2026-01-04T00:00:00Z","version":3.5,"extra":true}
                ],
                "nextCursor": "cursor_2"
            }"""

            val result = KiloCliDataParser.parseCloudSessions(raw)

            assertEquals(2, result.sessions.size)
            assertEquals("cloud_1", result.sessions[0].id)
            assertEquals("Cloud One", result.sessions[0].title)
            assertEquals("2026-01-02T00:00:00Z", result.sessions[0].updatedAt)
            assertEquals(2.0, result.sessions[0].version)
            assertNull(result.sessions[1].title)
            assertEquals("cursor_2", result.nextCursor)
        }

        @Test
        fun `parseCloudSessions tolerates malformed response`() {
            assertEquals(emptyList(), KiloCliDataParser.parseCloudSessions("not json").sessions)
            assertNull(KiloCliDataParser.parseCloudSessions("{}").nextCursor)
        }

        // ---- parseProviders ----

        @Test
        fun `parseProviders - maps provider id, name, source, connected, and defaults`() {
            val raw = """{
                "all": [{"id":"anthropic","name":"Anthropic","source":"api","env":[],"options":{},"models":{}}],
                "default": {"code": "anthropic/claude-4"},
                "connected": ["anthropic"]
            }"""

            val result = KiloCliDataParser.parseProviders(raw)

            assertEquals(1, result.providers.size)
            assertEquals("anthropic", result.providers[0].id)
            assertEquals("Anthropic", result.providers[0].name)
            assertEquals("api", result.providers[0].source)
            assertEquals(listOf("anthropic"), result.connected)
            assertEquals(mapOf("code" to "anthropic/claude-4"), result.defaults)
        }

        @Test
        fun `parseProviders - maps model capabilities, limit, and recommendedIndex`() {
            val raw = """{
                "all": [{
                    "id": "anthropic", "name": "Anthropic", "source": "api", "env": [], "options": {},
                    "models": {
                        "claude-4": {
                            "id": "claude-4",
                            "name": "Claude 4",
                            "capabilities": {
                                "temperature": true, "reasoning": true,
                                "attachment": true, "toolcall": true
                            },
                            "limit": {"context": 200000, "input": 100000, "output": 16000},
                            "status": "active",
                            "recommendedIndex": 2,
                            "variants": {"high": {}, "low": {}, "medium": {}},
                            "options": {}, "headers": {}
                        }
                    }
                }],
                "default": {}, "connected": []
            }"""

            val provider = KiloCliDataParser.parseProviders(raw).providers[0]
            val model = provider.models["claude-4"]
            assertNotNull(model)
            assertEquals("claude-4", model.id)
            assertEquals("Claude 4", model.name)
            assertTrue(model.attachment)
            assertTrue(model.reasoning)
            assertTrue(model.temperature)
            assertTrue(model.toolCall)
            assertEquals("active", model.status)
            assertEquals(2.0, model.recommendedIndex)
            assertEquals(200000L, model.limit?.context)
            assertEquals(100000L, model.limit?.input)
            assertEquals(16000L, model.limit?.output)
        }

        @Test
        fun `parseProviders - orders variants by effort rank then name`() {
            val raw = """{
                "all": [{
                    "id": "p", "name": "P", "source": "api", "env": [], "options": {},
                    "models": {
                        "m": {
                            "capabilities": {}, "options": {}, "headers": {},
                            "variants": {"high": {}, "low": {}, "medium": {}}
                        }
                    }
                }],
                "default": {}, "connected": []
            }"""

            val model = KiloCliDataParser.parseProviders(raw).providers[0].models["m"]
            assertNotNull(model)
            assertEquals(listOf("low", "medium", "high"), model.variants)
        }

        @Test
        fun `parseProviders - missing collections default to empty`() {
            val result = KiloCliDataParser.parseProviders("""{"all":[],"default":{},"connected":[]}""")
            assertEquals(emptyList(), result.providers)
            assertEquals(emptyList(), result.connected)
            assertEquals(emptyMap(), result.defaults)
        }

        @Test
        fun `parseProviders - model boolean capabilities default to false`() {
            val raw = """{
                "all": [{
                    "id": "p", "name": "P", "source": "api", "env": [], "options": {},
                    "models": { "m": { "capabilities": {}, "options": {}, "headers": {} } }
                }],
                "default": {}, "connected": []
            }"""

            val model = KiloCliDataParser.parseProviders(raw).providers[0].models["m"]
            assertNotNull(model)
            assertEquals(false, model.attachment)
            assertEquals(false, model.reasoning)
            assertEquals(false, model.temperature)
            assertEquals(false, model.toolCall)
            assertNull(model.limit)
        }

        @Test
        fun `parseProviders - throws for malformed JSON`() {
            assertFailsWith<Exception> {
                KiloCliDataParser.parseProviders("not json")
            }
        }

        @Test
        fun `parseProviders - throws for non-object JSON`() {
            assertFailsWith<Exception> {
                KiloCliDataParser.parseProviders("""[1,2,3]""")
            }
        }

        // ---- parseCommands ----

        @Test
        fun `parseCommands - maps name, description, source, and hints`() {
            val raw = """[
                {"name":"init","description":"guided AGENTS.md setup","template":"static body","hints":["${'$'}ARGUMENTS"],"source":"command"},
                {"name":"mcp-tool","template":"","hints":["${'$'}1","${'$'}2"],"source":"mcp"}
            ]"""

            val result = KiloCliDataParser.parseCommands(raw)

            assertEquals(2, result.size)
            assertEquals("init", result[0].name)
            assertEquals("guided AGENTS.md setup", result[0].description)
            assertEquals("command", result[0].source)
            assertEquals(listOf("\$ARGUMENTS"), result[0].hints)
            assertEquals("mcp", result[1].source)
            assertEquals(listOf("\$1", "\$2"), result[1].hints)
        }

        @Test
        fun `parseCommands - ignores lazy template object without crashing`() {
            // Regression: CLI serializes promise-backed templates as {} which used to
            // crash JetBrains startup before parsing was moved to this parser.
            val raw = """[
                {"name":"local-review","description":"local review","template":{},"hints":[],"source":"command"},
                {"name":"local-review-uncommitted","description":"local review (uncommitted)","template":{},"hints":[]}
            ]"""

            val result = KiloCliDataParser.parseCommands(raw)

            assertEquals(2, result.size)
            assertEquals("local-review", result[0].name)
            assertEquals("local review", result[0].description)
            assertEquals("command", result[0].source)
            assertEquals(emptyList(), result[0].hints)
            assertEquals("local-review-uncommitted", result[1].name)
        }

        @Test
        fun `parseCommands - ignores template when it is a string`() {
            val raw = """[{"name":"review","template":"do a review of ${'$'}ARGUMENTS","hints":["${'$'}ARGUMENTS"]}]"""
            val result = KiloCliDataParser.parseCommands(raw)
            assertEquals(1, result.size)
            assertEquals("review", result[0].name)
            assertEquals(listOf("\$ARGUMENTS"), result[0].hints)
        }

        @Test
        fun `parseCommands - missing hints defaults to empty`() {
            val raw = """[{"name":"nohints","template":"x"}]"""
            val result = KiloCliDataParser.parseCommands(raw)
            assertEquals(emptyList<String>(), result[0].hints)
        }

        @Test
        fun `parseCommands - empty array`() {
            assertEquals(emptyList<CommandInfo>(), KiloCliDataParser.parseCommands("[]"))
        }

        // ---- parsePathState ----

        @Test
        fun `parsePathState - extracts state from valid path response`() {
            val raw = """{"home":"/home/user","state":"/home/user/.local/state/kilo","config":"/home/user/.config/kilo","worktree":"/project","directory":"/project"}"""
            assertEquals("/home/user/.local/state/kilo", KiloCliDataParser.parsePathState(raw))
        }

        @Test
        fun `parsePathState - returns null for missing state field`() {
            assertNull(KiloCliDataParser.parsePathState("""{"home":"/home/user"}"""))
        }

        @Test
        fun `parsePathState - returns null for malformed JSON`() {
            assertNull(KiloCliDataParser.parsePathState("not json"))
        }

        @Test
        fun `parsePathState - returns null for non-string state value`() {
            assertNull(KiloCliDataParser.parsePathState("""{"state":42}"""))
            assertNull(KiloCliDataParser.parsePathState("""{"state":null}"""))
            assertNull(KiloCliDataParser.parsePathState("""{"state":{}}"""))
        }
    }

    // ================================================================
    // Group 3 — Request / body builders and local model state
    // ================================================================

    @Nested
    inner class RequestBuilders {

        // ---- buildPromptJson ----

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
        fun `buildPromptJson - with messageID`() {
            val prompt = PromptDto(
                parts = listOf(PromptPartDto("text", "Hi")),
                messageID = "msg_1",
            )
            val result = KiloCliDataParser.buildPromptJson(prompt)
            assertTrue(result.contains(""""messageID":"msg_1""""))
        }

        @Test
        fun `buildPromptJson - with noReply`() {
            val prompt = PromptDto(
                parts = listOf(PromptPartDto("text", "Hi")),
                noReply = true,
            )
            val result = KiloCliDataParser.buildPromptJson(prompt)
            assertEquals("""{"parts":[{"type":"text","text":"Hi"}],"noReply":true}""", result)
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
        fun `buildPromptJson - with variant`() {
            val prompt = PromptDto(
                parts = listOf(PromptPartDto("text", "Hi")),
                variant = "medium",
            )
            val result = KiloCliDataParser.buildPromptJson(prompt)
            assertTrue(result.contains(""""variant":"medium""""))
        }

        @Test
        fun `buildPromptJson - escapes special characters`() {
            val prompt = PromptDto(parts = listOf(PromptPartDto("text", "line1\nline2\t\"quoted\"")))
            val result = KiloCliDataParser.buildPromptJson(prompt)
            assertTrue(result.contains("""line1\nline2\t\"quoted\""""))
        }

        // ---- buildSummarizeJson ----

        @Test
        fun `buildSummarizeJson - writes provider and model`() {
            val result = KiloCliDataParser.buildSummarizeJson(ModelSelectionDto("anthropic", "claude-4"))
            assertEquals("""{"providerID":"anthropic","modelID":"claude-4"}""", result)
        }

        // ---- buildConfigPartial ----

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

        // ---- buildPermissionReplyJson ----

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

        // ---- buildPermissionAlwaysRulesJson ----

        @Test
        fun `buildPermissionAlwaysRulesJson - approved list`() {
            val result = KiloCliDataParser.buildPermissionAlwaysRulesJson(
                PermissionAlwaysRulesDto(approvedAlways = listOf("src/**"), deniedAlways = emptyList())
            )
            assertTrue(result.contains(""""approvedAlways":["src/**"]"""))
            assertTrue(result.contains(""""deniedAlways":[]"""))
        }

        // ---- buildQuestionReplyJson ----

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

        // ---- parseModelState / buildModelStateJson ----

        @Test
        fun `parseModelState - parses favorites`() {
            val result = KiloCliDataParser.parseModelState(
                """{"favorite":[{"providerID":"kilo","modelID":"auto"},{"providerID":"openai","modelID":"gpt"}]}""",
            )
            assertEquals(listOf("kilo/auto", "openai/gpt"), result.favorite.map { "${it.providerID}/${it.modelID}" })
        }

        @Test
        fun `parseModelState - parses recent selections`() {
            val result = KiloCliDataParser.parseModelState(
                """{"recent":[{"providerID":"anthropic","modelID":"claude"},{"providerID":"openai","modelID":"gpt"}]}""",
            )
            assertEquals(listOf("anthropic/claude", "openai/gpt"), result.recent.map { "${it.providerID}/${it.modelID}" })
        }

        @Test
        fun `parseModelState - parses model selections and variants`() {
            val result = KiloCliDataParser.parseModelState(
                """{"model":{"code":{"providerID":"kilo","modelID":"auto"}},"variant":{"kilo/auto":"medium"}}""",
            )
            assertEquals("kilo", result.model["code"]?.providerID)
            assertEquals("auto", result.model["code"]?.modelID)
            assertEquals("medium", result.variant["kilo/auto"])
        }

        @Test
        fun `parseModelState - drops malformed favorites`() {
            val result = KiloCliDataParser.parseModelState(
                """{"favorite":[{"providerID":"kilo"},false,{"providerID":"openai","modelID":"gpt"}]}""",
            )
            assertEquals(listOf("openai/gpt"), result.favorite.map { "${it.providerID}/${it.modelID}" })
        }

        @Test
        fun `parseModelState - malformed inputs return empty favorites`() {
            for (raw in listOf("", "not-json", "[]", "42", "null")) {
                assertTrue(KiloCliDataParser.parseModelState(raw).favorite.isEmpty(), raw)
            }
        }

        @Test
        fun `parseModelState - drops malformed model selections and variants`() {
            val result = KiloCliDataParser.parseModelState(
                """{"model":{"bad":false,"ok":{"providerID":"kilo","modelID":"auto"}},"variant":{"":"low","kilo/auto":false,"openai/gpt":"high"}}""",
            )
            assertEquals(listOf("ok"), result.model.keys.toList())
            assertEquals(mapOf("openai/gpt" to "high"), result.variant)
        }

        @Test
        fun `buildModelStateJson - preserves unrelated keys and replaces favorites`() {
            val raw = """{"model":{"code":{"providerID":"kilo","modelID":"auto"}},"recent":[{"providerID":"old","modelID":"recent"}],"variant":{"kilo/auto":"fast"},"extra":true,"favorite":[]}"""
            val result = KiloCliDataParser.buildModelStateJson(raw, listOf(ModelSelectionDto("anthropic", "claude")))

            assertTrue(result.contains("\"model\""), result)
            assertTrue(result.contains("\"recent\""), result)
            assertTrue(result.contains("\"variant\""), result)
            assertTrue(result.contains("\"extra\""), result)
            assertEquals(listOf("anthropic/claude"), KiloCliDataParser.parseModelState(result).favorite.map { "${it.providerID}/${it.modelID}" })
        }

        @Test
        fun `buildModelStateJson - writes model selections and variants`() {
            val raw = """{"recent":[],"extra":true}"""
            val result = KiloCliDataParser.buildModelStateJson(
                raw,
                ModelStateDto(
                    model = mapOf("code" to ModelSelectionDto("kilo", "auto")),
                    variant = mapOf("kilo/auto" to "medium"),
                    recent = listOf(ModelSelectionDto("anthropic", "claude")),
                ),
            )

            val state = KiloCliDataParser.parseModelState(result)
            assertEquals("auto", state.model["code"]?.modelID)
            assertEquals("medium", state.variant["kilo/auto"])
            assertEquals(listOf("anthropic/claude"), state.recent.map { "${it.providerID}/${it.modelID}" })
            assertTrue(result.contains("\"extra\""), result)
        }
    }

    // ================================================================
    // parsePermissionRequest — rich metadata
    // ================================================================

    @Test
    fun `parsePermissionRequest - command metadata extracted`() {
        val data = globalEvent("""
            "type": "permission.asked",
            "properties": {
                "id": "perm_cmd",
                "sessionID": "ses_1",
                "permission": "bash",
                "patterns": [],
                "always": [],
                "metadata": {"command": "git status --short"}
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("permission.asked", data)
        assertNotNull(result)
        val asked = result as? ChatEventDto.PermissionAsked ?: error("Expected PermissionAsked")
        assertEquals("git status --short", asked.request.command)
        assertEquals("git status --short", asked.request.metadata["command"])
    }

    @Test
    fun `parsePermissionRequest - diff and filepath fallback`() {
        val data = globalEvent("""
            "type": "permission.asked",
            "properties": {
                "id": "perm_diff",
                "sessionID": "ses_1",
                "permission": "edit",
                "patterns": [],
                "always": [],
                "metadata": {"filepath": "src/App.kt", "diff": "@@ -1 +1 @@"}
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("permission.asked", data)
        assertNotNull(result)
        val asked = result as? ChatEventDto.PermissionAsked ?: error("Expected PermissionAsked")
        assertEquals("src/App.kt", asked.request.filePath)
        assertEquals(1, asked.request.fileDiffs.size)
        assertEquals("src/App.kt", asked.request.fileDiffs[0].file)
        assertEquals("@@ -1 +1 @@", asked.request.fileDiffs[0].patch)
    }

    @Test
    fun `parsePermissionRequest - filediff object`() {
        val data = globalEvent("""
            "type": "permission.asked",
            "properties": {
                "id": "perm_filediff",
                "sessionID": "ses_1",
                "permission": "edit",
                "patterns": [],
                "always": [],
                "metadata": {
                    "filediff": {
                        "file": "src/A.kt",
                        "patch": "@@ -1 +1 @@",
                        "additions": 1,
                        "deletions": 1
                    }
                }
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("permission.asked", data)
        assertNotNull(result)
        val asked = result as? ChatEventDto.PermissionAsked ?: error("Expected PermissionAsked")
        assertEquals(1, asked.request.fileDiffs.size)
        assertEquals("src/A.kt", asked.request.fileDiffs[0].file)
        assertEquals("@@ -1 +1 @@", asked.request.fileDiffs[0].patch)
        assertEquals(1, asked.request.fileDiffs[0].additions)
        assertEquals(1, asked.request.fileDiffs[0].deletions)
    }

    @Test
    fun `parsePermissionRequest - files array`() {
        val data = globalEvent("""
            "type": "permission.asked",
            "properties": {
                "id": "perm_files",
                "sessionID": "ses_1",
                "permission": "edit",
                "patterns": [],
                "always": [],
                "metadata": {
                    "files": [
                        {"relativePath": "src/A.kt", "patch": "@@", "additions": 2, "deletions": 0},
                        {"filePath": "src/B.kt", "patch": "@@", "additions": 0, "deletions": 3}
                    ]
                }
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("permission.asked", data)
        assertNotNull(result)
        val asked = result as? ChatEventDto.PermissionAsked ?: error("Expected PermissionAsked")
        assertEquals(2, asked.request.fileDiffs.size)
        assertEquals("src/A.kt", asked.request.fileDiffs[0].file)
        assertEquals(2, asked.request.fileDiffs[0].additions)
        assertEquals("src/B.kt", asked.request.fileDiffs[1].file)
        assertEquals(3, asked.request.fileDiffs[1].deletions)
    }

    @Test
    fun `parsePermissionRequest - malformed files metadata returns empty diffs`() {
        val data = globalEvent("""
            "type": "permission.asked",
            "properties": {
                "id": "perm_bad",
                "sessionID": "ses_1",
                "permission": "edit",
                "patterns": [],
                "always": [],
                "metadata": {"files": "not-an-array"}
            }
        """)

        val result = KiloCliDataParser.parseChatEvent("permission.asked", data)
        assertNotNull(result)
        val asked = result as? ChatEventDto.PermissionAsked ?: error("Expected PermissionAsked")
        assertTrue(asked.request.fileDiffs.isEmpty())
    }

    @Test
    fun `parsePermissionRequest - old json without new fields uses defaults`() {
        val raw = """[
            {"id": "p1", "sessionID": "s1", "permission": "edit", "patterns": ["*.kt"], "always": [], "metadata": {}}
        ]"""
        val result = KiloCliDataParser.parsePermissionRequests(raw)
        assertEquals(1, result.size)
        assertNull(result[0].command)
        assertTrue(result[0].rules.isEmpty())
        assertTrue(result[0].fileDiffs.isEmpty())
        assertNull(result[0].filePath)
        assertNull(result[0].message)
    }

    // ================================================================
    // Helpers
    // ================================================================

    /** Wrap payload content in a GlobalEvent structure. */
    private fun globalEvent(payload: String): String =
        """{"directory":"/tmp","payload":{$payload}}"""
}
