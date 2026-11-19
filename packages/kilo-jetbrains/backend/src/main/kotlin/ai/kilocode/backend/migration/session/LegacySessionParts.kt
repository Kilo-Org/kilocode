package ai.kilocode.backend.migration.session

import ai.kilocode.backend.migration.LegacyHistoryItem
import ai.kilocode.backend.migration.LegacyMigrationJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Part conversion for legacy conversation history.
 *
 * Based on packages/kilo-vscode/src/legacy-migration/sessions/lib/parts/, with JetBrains-owned
 * part IDs and assistant-owned tool parts for correct transcript rendering.
 */
object LegacySessionParts {

    private val TODO = Regex("^(?:-\\s*)?\\[\\s*([ xX\\-~])\\s*]\\s+(.+)$")

    fun parseParts(
        conversation: List<LegacyApiMessage>,
        id: String,
        item: LegacyHistoryItem? = null,
    ): List<JsonObject> {
        val filtered = conversation.filter { it.role == "user" || it.role == "assistant" }
        return filtered.flatMapIndexed { index, entry ->
            parseSingleEntryParts(entry, index, id, filtered, item)
        }
    }

    private fun parseSingleEntryParts(
        entry: LegacyApiMessage,
        index: Int,
        id: String,
        conversation: List<LegacyApiMessage>,
        item: LegacyHistoryItem?,
    ): List<JsonObject> {
        val messageId = LegacySessionIds.createMessageId(id, index)
        val sessionId = LegacySessionIds.createSessionId(id)
        val created = entry.ts ?: item?.ts ?: 0L
        val parts = mutableListOf<JsonObject>()
        fun pid() = LegacySessionIds.createOrderedPartId(id, index, parts.size)

        // Simple string content
        if (entry.content is String) {
            val content = entry.content
            if (isEnvironmentDetails(content)) return emptyList()
            parts.add(toText(pid(), messageId, sessionId, created, content))
            return parts
        }

        val contentList = entry.content as? List<*> ?: return emptyList()

        // Reasoning entry (type=reasoning with text field)
        if (entry.type == "reasoning" && entry.text != null) {
            parts.add(toReasoning(pid(), messageId, sessionId, created, entry.text))
        }

        // Provider-specific reasoning (reasoning_content or reasoning_details)
        if (entry.type != "reasoning") {
            val reasoning = extractReasoningText(entry)
            if (reasoning != null) {
                parts.add(toReasoning(pid(), messageId, sessionId, created, reasoning))
            }
        }

        contentList.forEach { part ->
            val elem = part as? Map<*, *> ?: return@forEach

            val type = elem["type"] as? String

            // Text block
            if (type == "text") {
                val text = elem["text"] as? String ?: return@forEach
                if (isEnvironmentDetails(text)) return@forEach
                parts.add(toText(pid(), messageId, sessionId, created, text))
                return@forEach
            }

            // attempt_completion result → visible text
            if (type == "tool_use" && elem["name"] == "attempt_completion") {
                val input = elem["input"] as? Map<*, *>
                val result = input?.get("result") as? String
                if (!result.isNullOrBlank()) {
                    parts.add(toText(pid(), messageId, sessionId, created, result))
                }
                return@forEach
            }

            // tool_use belongs to this assistant message. The matching result lives on a later user entry.
            if (type == "tool_use") {
                val toolId = elem["id"] as? String
                val spec = toolSpec(elem)
                val output = findToolResultText(conversation, toolId) ?: spec.output
                parts.add(toTool(pid(), messageId, sessionId, created, elem, output))
                return@forEach
            }

            // tool_result can include real user feedback, but does not emit a tool part.
            if (type == "tool_result") {
                val feedback = getFeedbackText(elem["content"])
                if (feedback != null) {
                    parts.add(toText(pid(), messageId, sessionId, created, feedback))
                }
            }
        }

        return parts
    }

    // -----------------------------------------------------------------------
    // Builders
    // -----------------------------------------------------------------------

    fun toText(partId: String, messageId: String, sessionId: String, created: Long, rawText: String): JsonObject {
        val text = cleanLegacyTaskText(rawText)
        return buildJsonObject {
            put("id", partId)
            put("messageID", messageId)
            put("sessionID", sessionId)
            put("timeCreated", created)
            put("data", buildJsonObject {
                put("type", "text")
                put("text", text)
                if (isLegacySystemErrorText(text)) {
                    put("ignored", true)
                    put("metadata", buildJsonObject { put("source", "legacy-system-error") })
                }
                put("time", buildJsonObject { put("start", created); put("end", created) })
            })
        }
    }

    fun toReasoning(partId: String, messageId: String, sessionId: String, created: Long, text: String): JsonObject =
        buildJsonObject {
            put("id", partId)
            put("messageID", messageId)
            put("sessionID", sessionId)
            put("timeCreated", created)
            put("data", buildJsonObject {
                put("type", "reasoning")
                put("text", text)
                put("time", buildJsonObject { put("start", created); put("end", created) })
            })
        }

    fun toTool(partId: String, messageId: String, sessionId: String, created: Long, elem: Map<*, *>, output: String): JsonObject {
        val spec = toolSpec(elem)
        val callId = elem["id"] as? String ?: partId
        val metadata = if (spec.name == "todowrite") {
            spec.input["todos"]?.let { JsonObject(mapOf("todos" to it)) } ?: JsonObject(emptyMap())
        } else {
            JsonObject(emptyMap())
        }
        return buildJsonObject {
            put("id", partId)
            put("messageID", messageId)
            put("sessionID", sessionId)
            put("timeCreated", created)
            put("data", buildJsonObject {
                put("type", "tool")
                put("callID", callId)
                put("tool", spec.name)
                put("state", buildJsonObject {
                    put("status", "completed")
                    put("input", JsonObject(spec.input))
                    put("output", output)
                    put("title", spec.title)
                    put("metadata", metadata)
                    put("time", buildJsonObject { put("start", created); put("end", created) })
                })
            })
        }
    }

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    private fun findToolResultText(conversation: List<LegacyApiMessage>, id: String?): String? {
        if (id == null) return null
        for (entry in conversation) {
            val list = entry.content as? List<*> ?: continue
            val match = list.filterIsInstance<Map<*, *>>()
                .firstOrNull { it["type"] == "tool_result" && it["tool_use_id"] == id }
            val text = getTextFromContent(match?.get("content"))
            if (text != null) return text
        }
        return null
    }

    fun extractReasoningText(entry: LegacyApiMessage): String? {
        val rc = entry.reasoning_content?.trim()
        if (!rc.isNullOrEmpty()) return rc
        val details = entry.reasoning_details ?: return null
        return details.flatMap { item ->
            val m = item as? Map<*, *> ?: return@flatMap emptyList()
            val text = m["text"] as? String
            val reasoning = m["reasoning"] as? String
            listOfNotNull(text ?: reasoning)
        }.joinToString("\n").trim().takeIf { it.isNotEmpty() }
    }

    fun isEnvironmentDetails(input: String): Boolean =
        Regex("^\\s*<environment_details>[\\s\\S]*</environment_details>\\s*$", RegexOption.IGNORE_CASE).matches(input)

    fun cleanLegacyTaskText(input: String): String {
        val task = Regex("<task>([\\s\\S]*?)</task>", RegexOption.IGNORE_CASE).find(input)?.groupValues?.get(1)?.trim()
        if (task != null) return task
        if (isEnvironmentDetails(input)) return ""
        return input
    }

    fun isLegacySystemErrorText(input: String): Boolean = input.trimStart().startsWith("[ERROR]")

    fun getFeedbackText(content: Any?): String? {
        val text = getTextFromContent(content) ?: return null
        return Regex("<feedback>([\\s\\S]*?)</feedback>", RegexOption.IGNORE_CASE)
            .find(text)?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
    }

    fun getTextFromContent(content: Any?): String? {
        if (content is String) return content
        val list = content as? List<*> ?: return null
        return list.filterIsInstance<Map<*, *>>()
            .mapNotNull { m -> if (m["type"] == "text") m["text"] as? String else null }
            .joinToString("\n").trim().takeIf { it.isNotEmpty() }
    }

    private data class ToolSpec(
        val name: String,
        val title: String,
        val input: Map<String, JsonElement>,
        val output: String,
    )

    private fun toolSpec(elem: Map<*, *>): ToolSpec {
        val legacy = elem["name"] as? String ?: "unknown"
        val input = elem["input"] as? Map<*, *> ?: emptyMap<Any, Any>()
        val mapped = when (legacy) {
            "read_file" -> "read"
            "list_files" -> "list"
            "write_to_file" -> "write"
            "apply_diff", "replace_in_file" -> "edit"
            "execute_command" -> "bash"
            "search_files" -> "grep"
            "glob" -> "glob"
            "update_todo_list" -> "todowrite"
            else -> legacy
        }
        val data = toolInput(mapped, input)
        val title = when (mapped) {
            "read" -> "Read"
            "list" -> "List"
            "write" -> "Write"
            "edit" -> "Edit"
            "bash" -> "Shell"
            "grep" -> "Search"
            "todowrite" -> "Update todos"
            else -> legacy.replace('_', ' ').replaceFirstChar { it.titlecase() }
        }
        // No output is known at spec time; the caller fills it from the matching tool_result.
        // Fall back to an empty string (never the tool name) when no result is found.
        return ToolSpec(mapped, title, data, "")
    }

    private fun toolInput(tool: String, input: Map<*, *>): Map<String, JsonElement> {
        fun str(key: String) = scalar(input[key])?.takeIf { it.isNotBlank() }?.let { JsonPrimitive(it) }
        return when (tool) {
            "read" -> mapOfNotNull("filePath" to str("path"), "offset" to str("start_line"), "limit" to str("end_line"))
            "list" -> mapOfNotNull("path" to str("path"))
            "write" -> mapOfNotNull("filePath" to str("path"), "content" to str("content"))
            "edit" -> {
                val patch = str("diff") ?: str("content")
                mapOfNotNull("filePath" to str("path"), "patch" to patch)
            }
            "bash" -> mapOfNotNull("command" to str("command"))
            "grep" -> {
                val pattern = str("regex") ?: str("pattern")
                mapOfNotNull("pattern" to pattern, "path" to str("path"), "include" to str("file_pattern"))
            }
            "glob" -> mapOfNotNull("pattern" to str("pattern"), "path" to str("path"))
            "todowrite" -> {
                val todos = todoInput(input["todos"] ?: input["content"])
                mapOfNotNull("todos" to todos)
            }
            else -> input.entries.mapNotNull { (k, v) ->
                val key = k as? String ?: return@mapNotNull null
                val value = valueToJsonElement(v) ?: return@mapNotNull null
                key to value
            }.toMap()
        }
    }

    private fun todoInput(raw: Any?): JsonElement? {
        val elem = valueToJsonElement(raw) ?: return null
        if (elem is JsonArray) return normalizeTodos(elem)
        val text = (elem as? JsonPrimitive)?.jsonPrimitive?.content?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        LegacyMigrationJson.parseArray(text)?.let { return normalizeTodos(it) }
        return parseMarkdownTodos(text)
    }

    private fun parseMarkdownTodos(raw: String): JsonArray? {
        val items = raw.split(Regex("\\r?\\n"))
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .mapNotNull { line ->
                val match = TODO.matchEntire(line) ?: return@mapNotNull null
                val marker = match.groupValues[1]
                val status = when (marker) {
                    "x", "X" -> "completed"
                    "-" -> "cancelled"
                    "~" -> "in_progress"
                    else -> "pending"
                }
                todo(match.groupValues[2].trim(), status, "medium")
            }
        return items.takeIf { it.isNotEmpty() }?.let { JsonArray(it) }
    }

    private fun normalizeTodos(raw: JsonArray): JsonArray? {
        val items = raw.mapNotNull { elem ->
            val obj = elem as? JsonObject ?: return@mapNotNull null
            val content = field(obj, "content")?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            todo(content, field(obj, "status") ?: "pending", field(obj, "priority") ?: "medium")
        }
        return items.takeIf { it.isNotEmpty() }?.let { JsonArray(it) }
    }

    private fun todo(content: String, status: String, priority: String) = buildJsonObject {
        put("content", content)
        put("status", status)
        put("priority", priority)
    }

    private fun field(obj: JsonObject, key: String): String? =
        runCatching { obj[key]?.jsonPrimitive?.content }.getOrNull()

    private fun scalar(value: Any?): String? = when (value) {
        is String -> value
        is JsonPrimitive -> value.jsonPrimitive.content
        null -> null
        else -> value.toString()
    }

    private fun mapToJsonObject(input: Any?): JsonObject {
        if (input !is Map<*, *>) return JsonObject(emptyMap())
        return JsonObject(
            input.entries.mapNotNull { (k, v) ->
                val key = k as? String ?: return@mapNotNull null
                val value = valueToJsonElement(v) ?: return@mapNotNull null
                key to value
            }.toMap()
        )
    }

    private fun mapOfNotNull(vararg pairs: Pair<String, JsonElement?>): Map<String, JsonElement> =
        pairs.mapNotNull { (k, v) -> v?.let { k to it } }.toMap()

    private fun valueToJsonElement(value: Any?): JsonElement? = when (value) {
        null -> null
        is JsonElement -> value
        is String -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is Map<*, *> -> mapToJsonObject(value)
        is List<*> -> JsonArray(value.mapNotNull { valueToJsonElement(it) })
        else -> JsonPrimitive(value.toString())
    }

}
