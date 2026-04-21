package ai.kilocode.backend.cli

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.ConfigUpdateDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
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
    // Helpers
    // ================================================================

    /** Wrap payload content in a GlobalEvent structure. */
    private fun globalEvent(payload: String): String =
        """{"directory":"/tmp","payload":{$payload}}"""
}
