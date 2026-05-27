package ai.kilocode.backend.migration.session

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ai.kilocode.backend.migration.LegacyHistoryItem

/**
 * Part conversion for legacy conversation history.
 *
 * Port of packages/kilo-vscode/src/legacy-migration/sessions/lib/parts/
 */
object LegacySessionParts {

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

        // Simple string content
        if (entry.content is String) {
            val content = entry.content
            if (isEnvironmentDetails(content)) return emptyList()
            parts.add(toText(LegacySessionIds.createPartId(id, index, 0), messageId, sessionId, created, content))
            return parts
        }

        val contentList = entry.content as? List<*> ?: return emptyList()

        // Reasoning entry (type=reasoning with text field)
        if (entry.type == "reasoning" && entry.text != null) {
            parts.add(toReasoning(LegacySessionIds.createExtraPartId(id, index, "reasoning"), messageId, sessionId, created, entry.text))
        }

        // Provider-specific reasoning (reasoning_content or reasoning_details)
        if (entry.type != "reasoning") {
            val reasoning = extractReasoningText(entry)
            if (reasoning != null) {
                parts.add(toReasoning(LegacySessionIds.createExtraPartId(id, index, "provider-reasoning"), messageId, sessionId, created, reasoning))
            }
        }

        contentList.forEachIndexed { partIndex, part ->
            val partId = LegacySessionIds.createPartId(id, index, partIndex)
            val elem = part as? Map<*, *> ?: return@forEachIndexed

            val type = elem["type"] as? String

            // Text block
            if (type == "text") {
                val text = elem["text"] as? String ?: return@forEachIndexed
                if (isEnvironmentDetails(text)) return@forEachIndexed
                parts.add(toText(partId, messageId, sessionId, created, text))
                return@forEachIndexed
            }

            // attempt_completion result → visible text
            if (type == "tool_use" && elem["name"] == "attempt_completion") {
                val input = elem["input"] as? Map<*, *>
                val result = input?.get("result") as? String
                if (!result.isNullOrBlank()) {
                    parts.add(toText(partId, messageId, sessionId, created, result))
                }
                return@forEachIndexed
            }

            // tool_use without matching result
            if (type == "tool_use") {
                val toolId = elem["id"] as? String
                if (thereIsNoToolResult(conversation, toolId)) {
                    parts.add(toTool(partId, messageId, sessionId, created, elem))
                }
                return@forEachIndexed
            }

            // tool_result — extract feedback and merge with matching tool_use
            if (type == "tool_result") {
                val feedback = getFeedbackText(elem["content"])
                if (feedback != null) {
                    parts.add(toText(
                        LegacySessionIds.createExtraPartId(id, index, "feedback-$partIndex"),
                        messageId, sessionId, created, feedback,
                    ))
                }
                val toolId = elem["tool_use_id"] as? String
                val merged = mergeToolUseAndResult(partId, messageId, sessionId, created, conversation, elem, toolId)
                if (merged != null) parts.add(merged)
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

    fun toTool(partId: String, messageId: String, sessionId: String, created: Long, elem: Map<*, *>): JsonObject {
        val tool = elem["name"] as? String ?: "unknown"
        val callId = elem["id"] as? String ?: partId
        return buildJsonObject {
            put("id", partId)
            put("messageID", messageId)
            put("sessionID", sessionId)
            put("timeCreated", created)
            put("data", buildJsonObject {
                put("type", "tool")
                put("callID", callId)
                put("tool", tool)
                put("state", buildJsonObject {
                    put("status", "completed")
                    put("input", mapToJsonObject(elem["input"]))
                    put("output", tool)
                    put("title", tool)
                    put("metadata", JsonObject(emptyMap()))
                    put("time", buildJsonObject { put("start", created); put("end", created) })
                })
            })
        }
    }

    private fun mergeToolUseAndResult(
        partId: String,
        messageId: String,
        sessionId: String,
        created: Long,
        conversation: List<LegacyApiMessage>,
        result: Map<*, *>,
        toolId: String?,
    ): JsonObject? {
        val toolUse = findToolUseInConversation(conversation, toolId) ?: return null
        val tool = toolUse["name"] as? String ?: "unknown"
        val callId = toolUse["id"] as? String ?: partId
        val output = getTextFromContent(result["content"]) ?: tool

        return buildJsonObject {
            put("id", partId)
            put("messageID", messageId)
            put("sessionID", sessionId)
            put("timeCreated", created)
            put("data", buildJsonObject {
                put("type", "tool")
                put("callID", callId)
                put("tool", tool)
                put("state", buildJsonObject {
                    put("status", "completed")
                    put("input", mapToJsonObject(toolUse["input"]))
                    put("output", output)
                    put("title", tool)
                    put("metadata", JsonObject(emptyMap()))
                    put("time", buildJsonObject { put("start", created); put("end", created) })
                })
            })
        }
    }

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    private fun findToolUseInConversation(conversation: List<LegacyApiMessage>, id: String?): Map<*, *>? {
        if (id == null) return null
        for (entry in conversation) {
            val list = entry.content as? List<*> ?: continue
            val match = list.filterIsInstance<Map<*, *>>()
                .firstOrNull { it["type"] == "tool_use" && it["id"] == id }
            if (match != null) return match
        }
        return null
    }

    fun thereIsNoToolResult(conversation: List<LegacyApiMessage>, id: String?): Boolean {
        if (id == null) return true
        return conversation.none { entry ->
            (entry.content as? List<*>)?.filterIsInstance<Map<*, *>>()
                ?.any { it["type"] == "tool_result" && it["tool_use_id"] == id } == true
        }
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

    private fun mapToJsonObject(input: Any?): JsonObject {
        if (input == null || input !is Map<*, *>) return JsonObject(emptyMap())
        return JsonObject(
            input.entries.mapNotNull { (k, v) ->
                val key = k as? String ?: return@mapNotNull null
                key to (valueToJsonElement(v) ?: return@mapNotNull null)
            }.toMap()
        )
    }

    private fun valueToJsonElement(v: Any?): JsonElement? = when (v) {
        null -> null
        is String -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v.toDouble())
        is Boolean -> JsonPrimitive(v)
        is Map<*, *> -> mapToJsonObject(v)
        is List<*> -> JsonArray(v.mapNotNull { valueToJsonElement(it) })
        else -> JsonPrimitive(v.toString())
    }
}
