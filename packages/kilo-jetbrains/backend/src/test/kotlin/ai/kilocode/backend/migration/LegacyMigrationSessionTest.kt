package ai.kilocode.backend.migration

import ai.kilocode.backend.cli.KiloCliDataParser
import ai.kilocode.backend.migration.session.LegacySessionIds
import ai.kilocode.backend.migration.session.LegacySessionParser
import ai.kilocode.backend.migration.session.LegacySessionParts
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Tests for session ID generation, parsing, and part conversion.
 */
class LegacyMigrationSessionTest {

    // -----------------------------------------------------------------------
    // Deterministic IDs
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
    fun `ordered partId sorts by ordinal for a message`() {
        val id = "task-x"
        val index = 1
        val first = LegacySessionIds.createOrderedPartId(id, index, 0)
        val second = LegacySessionIds.createOrderedPartId(id, index, 1)
        assertTrue(first < second)
        assertEquals("prt_migrated_${sha1("$id:$index").take(20)}_0000", first)
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
    fun `legacy tool names are mapped to current tool names`() {
        val conv = """[
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"write_to_file","input":{"path":".kilocode/rules/coding-style.md","content":"rules"}}]},
            {"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"done"}]}]}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-tools", conv)
        val tool = parsed.parts.first { it["data"]!!.jsonObject["type"]!!.jsonPrimitive.content == "tool" }
        val data = tool["data"]!!.jsonObject
        val state = data["state"]!!.jsonObject
        val assistant = LegacySessionIds.createMessageId("task-tools", 0)
        val user = LegacySessionIds.createMessageId("task-tools", 1)
        assertEquals(1, parsed.messages.size)
        assertEquals(assistant, parsed.messages.single()["id"]!!.jsonPrimitive.content)
        assertEquals(assistant, tool["messageID"]!!.jsonPrimitive.content)
        assertFalse(parsed.parts.any { it["messageID"]!!.jsonPrimitive.content == user })
        assertEquals("write", data["tool"]!!.jsonPrimitive.content)
        assertEquals("Write", state["title"]!!.jsonPrimitive.content)
        assertEquals(".kilocode/rules/coding-style.md", state["input"]!!.jsonObject["filePath"]!!.jsonPrimitive.content)
        assertEquals("done", state["output"]!!.jsonPrimitive.content)
    }

    @Test
    fun `assistant text before tool keeps ordered part ids`() {
        val conv = """[
            {"role":"assistant","content":[
                {"type":"text","text":"I will inspect files"},
                {"type":"tool_use","id":"call-1","name":"list_files","input":{"path":"."}}
            ]},
            {"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"a.kt"}]}]}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-order", conv)
        val text = parsed.parts.first { type(it) == "text" }
        val tool = parsed.parts.first { type(it) == "tool" }
        assertEquals(1, parsed.messages.size)
        assertEquals(LegacySessionIds.createMessageId("task-order", 0), text["messageID"]!!.jsonPrimitive.content)
        assertEquals(text["messageID"]!!.jsonPrimitive.content, tool["messageID"]!!.jsonPrimitive.content)
        assertTrue(text["id"]!!.jsonPrimitive.content < tool["id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `tool result feedback produces surviving user message`() {
        val conv = """[
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"read_file","input":{"path":"README.md"}}]},
            {"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"done\n<feedback>Use a different file</feedback>"}]}]}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-feedback", conv)
        val id = LegacySessionIds.createMessageId("task-feedback", 1)
        val part = parsed.parts.first { it["messageID"]!!.jsonPrimitive.content == id }
        assertEquals(2, parsed.messages.size)
        assertEquals("user", parsed.messages[1]["data"]!!.jsonObject["role"]!!.jsonPrimitive.content)
        assertEquals("Use a different file", part["data"]!!.jsonObject["text"]!!.jsonPrimitive.content)
    }

    @Test
    fun `tool result without feedback is dropped from messages`() {
        val conv = """[
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"list_files","input":{"path":"."}}]},
            {"role":"user","content":[
                {"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"done"}]},
                {"type":"text","text":"<environment_details>context</environment_details>"}
            ]}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-drop", conv)
        val user = LegacySessionIds.createMessageId("task-drop", 1)
        assertEquals(1, parsed.messages.size)
        assertFalse(parsed.messages.any { it["id"]!!.jsonPrimitive.content == user })
        assertFalse(parsed.parts.any { it["messageID"]!!.jsonPrimitive.content == user })
    }

    @Test
    fun `assistant parent ids skip result-only carrier before continuation`() {
        val conv = """[
            {"role":"user","content":"Inspect files"},
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"list_files","input":{"path":"."}}]},
            {"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"done"}]}]},
            {"role":"assistant","content":"Next step"}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-relink", conv)
        val prompt = LegacySessionIds.createMessageId("task-relink", 0)
        val carrier = LegacySessionIds.createMessageId("task-relink", 2)
        val second = LegacySessionIds.createMessageId("task-relink", 3)
        val assistant = parsed.messages.single { it["id"]!!.jsonPrimitive.content == second }

        assertEquals(4, parsed.messages.size)
        assertTrue(parsed.messages.any { it["id"]!!.jsonPrimitive.content == carrier })
        assertTrue(parsed.parts.any { it["messageID"]!!.jsonPrimitive.content == prompt })
        assertFalse(parsed.parts.any { it["messageID"]!!.jsonPrimitive.content == carrier })
        assertEquals(prompt, assistant["data"]!!.jsonObject["parentID"]!!.jsonPrimitive.content)
    }

    @Test
    fun `todo tool keeps structured todo list`() {
        val conv = """[
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"update_todo_list","input":{"todos":[
                {"content":"Write tests","status":"completed","priority":"high"},
                {"content":"Review","status":"pending","priority":"medium"}
            ]}}]},
            {"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"todos updated"}]}]}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-todos", conv)
        val tool = parsed.parts.first { type(it) == "tool" }
        val data = tool["data"]!!.jsonObject
        val state = data["state"]!!.jsonObject
        val input = state["input"]!!.jsonObject["todos"]!!.jsonArray
        val metadata = state["metadata"]!!.jsonObject["todos"]!!.jsonArray
        assertEquals("todowrite", data["tool"]!!.jsonPrimitive.content)
        assertEquals(2, input.size)
        assertEquals("Write tests", input[0].jsonObject["content"]!!.jsonPrimitive.content)
        assertEquals(2, metadata.size)
        assertEquals("Review", metadata[1].jsonObject["content"]!!.jsonPrimitive.content)
    }

    @Test
    fun `todo tool parses legacy markdown checklist string`() {
        val conv = """[
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"update_todo_list","input":{"todos":"[x] Done\n[ ] Next\n[-] Working\n[~] Also working"}}]},
            {"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"todos updated"}]}]}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-md-todos", conv)
        val tool = parsed.parts.first { type(it) == "tool" }
        val data = tool["data"]!!.jsonObject
        val state = data["state"]!!.jsonObject
        val todos = state["metadata"]!!.jsonObject["todos"]!!.jsonArray

        assertEquals("todowrite", data["tool"]!!.jsonPrimitive.content)
        assertEquals(4, todos.size)
        assertEquals("Done", todos[0].jsonObject["content"]!!.jsonPrimitive.content)
        assertEquals("completed", todos[0].jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals("medium", todos[0].jsonObject["priority"]!!.jsonPrimitive.content)
        assertEquals("Next", todos[1].jsonObject["content"]!!.jsonPrimitive.content)
        assertEquals("pending", todos[1].jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals("Working", todos[2].jsonObject["content"]!!.jsonPrimitive.content)
        assertEquals("cancelled", todos[2].jsonObject["status"]!!.jsonPrimitive.content)
        assertEquals("Also working", todos[3].jsonObject["content"]!!.jsonPrimitive.content)
        assertEquals("in_progress", todos[3].jsonObject["status"]!!.jsonPrimitive.content)
    }

    @Test
    fun `todo tool legacy markdown todos are visible to dto parser`() {
        val conv = """[
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"update_todo_list","input":{"todos":"[x] Done\n[ ] Next"}}]},
            {"role":"user","content":[{"type":"tool_result","tool_use_id":"call-1","content":[{"type":"text","text":"todos updated"}]}]}
        ]"""
        val migrated = LegacySessionParser.parseSession("task-md-roundtrip", conv)
            .parts
            .first { type(it) == "tool" }
        val data = migrated["data"]!!.jsonObject
        val flat = buildJsonObject {
            put("id", migrated["id"]!!)
            put("sessionID", migrated["sessionID"]!!)
            put("messageID", migrated["messageID"]!!)
            data.entries.forEach { (key, value) -> put(key, value) }
        }

        val part = KiloCliDataParser.parsePart(flat)
        assertEquals(2, part.todos.size)
        assertEquals("Done", part.todos[0].content)
        assertEquals("completed", part.todos[0].status)
        assertEquals("medium", part.todos[0].priority)
        assertEquals("Next", part.todos[1].content)
        assertEquals("pending", part.todos[1].status)
        assertEquals("medium", part.todos[1].priority)
    }

    @Test
    fun `todo tool ignores non checklist text`() {
        val conv = """[
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"update_todo_list","input":{"todos":"not a checklist"}}]}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-empty-todos", conv)
        val tool = parsed.parts.first { type(it) == "tool" }
        val state = tool["data"]!!.jsonObject["state"]!!.jsonObject
        assertFalse(state["metadata"]!!.jsonObject.containsKey("todos"))
    }

    @Test
    fun `tool use without matching result has empty output`() {
        val conv = """[
            {"role":"assistant","content":[{"type":"tool_use","id":"call-1","name":"read_file","input":{"path":"README.md"}}]}
        ]"""
        val parsed = LegacySessionParser.parseSession("task-noresult", conv)
        val tool = parsed.parts.first { type(it) == "tool" }
        val data = tool["data"]!!.jsonObject
        val state = data["state"]!!.jsonObject
        assertEquals("read", data["tool"]!!.jsonPrimitive.content)
        assertEquals("", state["output"]!!.jsonPrimitive.content)
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private fun sha1(value: String): String = LegacySessionIds.hash(value)

    private fun type(part: kotlinx.serialization.json.JsonObject): String =
        part["data"]!!.jsonObject["type"]!!.jsonPrimitive.content

    private fun assertNull(actual: String?) {
        kotlin.test.assertNull(actual)
    }
}
