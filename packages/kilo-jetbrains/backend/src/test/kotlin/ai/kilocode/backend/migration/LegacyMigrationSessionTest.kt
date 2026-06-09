package ai.kilocode.backend.migration

import ai.kilocode.backend.migration.session.LegacySessionIds
import ai.kilocode.backend.migration.session.LegacySessionParser
import ai.kilocode.backend.migration.session.LegacySessionParts
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Tests for session ID generation, parsing, and part conversion.
 */
class LegacyMigrationSessionTest {

    // -----------------------------------------------------------------------
    // Deterministic IDs matching VS Code formulas
    // -----------------------------------------------------------------------

    @Test
    fun `sessionId matches VS Code formula`() {
        // VS Code: ses_migrated_${sha1(id).take(26)}
        val id = "1234567890"
        val expected = "ses_migrated_${sha1(id).take(26)}"
        assertEquals(expected, LegacySessionIds.createSessionId(id))
    }

    @Test
    fun `messageId matches VS Code formula`() {
        val id = "abc-task"
        val index = 3
        val expected = "msg_migrated_${sha1("$id:$index").take(26)}"
        assertEquals(expected, LegacySessionIds.createMessageId(id, index))
    }

    @Test
    fun `partId matches VS Code formula`() {
        val id = "task-x"
        val index = 1
        val part = 2
        val expected = "prt_migrated_${sha1("$id:$index:$part").take(26)}"
        assertEquals(expected, LegacySessionIds.createPartId(id, index, part))
    }

    @Test
    fun `projectId uses hash of worktree`() {
        val path = "/home/user/project"
        assertEquals(sha1(path), LegacySessionIds.createProjectId(path))
    }

    // -----------------------------------------------------------------------
    // Task wrapper stripping
    // -----------------------------------------------------------------------

    @Test
    fun `cleanLegacyTaskText strips task wrapper`() {
        val input = "<task>Do the thing</task><environment_details>...</environment_details>"
        assertEquals("Do the thing", LegacySessionParts.cleanLegacyTaskText(input))
    }

    @Test
    fun `cleanLegacyTaskText returns empty for pure environment details`() {
        val input = "<environment_details>some context</environment_details>"
        assertEquals("", LegacySessionParts.cleanLegacyTaskText(input))
    }

    @Test
    fun `isEnvironmentDetails matches environment_details block`() {
        assertTrue(LegacySessionParts.isEnvironmentDetails("<environment_details>foo</environment_details>"))
        assertFalse(LegacySessionParts.isEnvironmentDetails("Hello world"))
    }

    // -----------------------------------------------------------------------
    // Reasoning preserved
    // -----------------------------------------------------------------------

    @Test
    fun `reasoning_content extracted`() {
        val entry = ai.kilocode.backend.migration.session.LegacyApiMessage(
            role = "assistant",
            content = listOf(mapOf("type" to "text", "text" to "Hi")),
            ts = 0L,
            isSummary = null,
            id = null,
            type = null,
            text = null,
            reasoning_content = "  I think therefore I am  ",
            reasoning_details = null,
        )
        val reasoning = LegacySessionParts.extractReasoningText(entry)
        assertEquals("I think therefore I am", reasoning)
    }

    @Test
    fun `reasoning_details extracted from text field`() {
        val entry = ai.kilocode.backend.migration.session.LegacyApiMessage(
            role = "assistant",
            content = listOf<Any>(),
            ts = null,
            isSummary = null, id = null, type = null, text = null,
            reasoning_content = null,
            reasoning_details = listOf(mapOf("type" to "thinking", "text" to "Let me think")),
        )
        assertEquals("Let me think", LegacySessionParts.extractReasoningText(entry))
    }

    // -----------------------------------------------------------------------
    // ERROR text marked as ignored
    // -----------------------------------------------------------------------

    @Test
    fun `isLegacySystemErrorText detects ERROR prefix`() {
        assertTrue(LegacySessionParts.isLegacySystemErrorText("[ERROR] something went wrong"))
        assertFalse(LegacySessionParts.isLegacySystemErrorText("Normal text"))
    }

    @Test
    fun `toText marks ERROR parts as ignored`() {
        val part = LegacySessionParts.toText("p1", "m1", "s1", 0L, "[ERROR] failed")
        val data = part["data"]!!
        assertEquals("true", data.jsonObject["ignored"]?.jsonPrimitive?.content)
    }

    // -----------------------------------------------------------------------
    // Feedback extraction
    // -----------------------------------------------------------------------

    @Test
    fun `getFeedbackText extracts feedback block`() {
        val content = "Some text\n<feedback>This is user feedback</feedback>"
        assertEquals("This is user feedback", LegacySessionParts.getFeedbackText(content))
    }

    @Test
    fun `getFeedbackText returns null when no feedback block`() {
        assertNull(LegacySessionParts.getFeedbackText("No feedback here"))
    }

    // -----------------------------------------------------------------------
    // Full session parsing
    // -----------------------------------------------------------------------

    @Test
    fun `parseSession produces project and session payloads`() {
        val item = LegacyHistoryItem(
            id = "task-abc",
            task = "Do something",
            workspace = "/tmp/project",
            ts = 1700000000000L,
            mode = "code",
            rootTaskId = null, parentTaskId = null,
        )
        val conv = """[
            {"role":"user","content":"Hello","ts":1700000000000},
            {"role":"assistant","content":"World","ts":1700000001000}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-abc", conv, item)

        assertEquals(LegacySessionIds.createSessionId("task-abc"), parsed.session["id"]?.jsonPrimitive?.content)
        assertEquals("task-abc", parsed.session["slug"]?.jsonPrimitive?.content)
        assertEquals("Do something", parsed.session["title"]?.jsonPrimitive?.content)
        assertEquals("v2", parsed.session["version"]?.jsonPrimitive?.content)
        assertEquals(2, parsed.messages.size)
        assertEquals("user", parsed.messages[0]["data"]?.jsonObject?.get("role")?.jsonPrimitive?.content)
        assertEquals("assistant", parsed.messages[1]["data"]?.jsonObject?.get("role")?.jsonPrimitive?.content)
    }

    @Test
    fun `parseSession only migrates user and assistant messages`() {
        val conv = """[
            {"role":"user","content":"Hi"},
            {"role":"system","content":"You are an assistant"},
            {"role":"assistant","content":"Hello"}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-x", conv)
        assertEquals(2, parsed.messages.size)
    }

    // -----------------------------------------------------------------------
    // Tool use / result merge
    // -----------------------------------------------------------------------

    @Test
    fun `thereIsNoToolResult returns true when no matching result`() {
        val conv = listOf(
            ai.kilocode.backend.migration.session.LegacyApiMessage("user", "text", null, null, null, null, null, null, null),
        )
        assertTrue(LegacySessionParts.thereIsNoToolResult(conv, "call-id-1"))
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private fun sha1(value: String): String = LegacySessionIds.hash(value)

    private fun assertNull(actual: String?) {
        kotlin.test.assertNull(actual)
    }
}
