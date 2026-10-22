package ai.kilocode.backend.migration.session

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ai.kilocode.backend.migration.LegacyHistoryItem
import ai.kilocode.backend.migration.LegacyMigrationJson

/**
 * Parses legacy conversation history files into normalized session-import payloads.
 *
 * Port of packages/kilo-vscode/src/legacy-migration/sessions/parser.ts and related lib/ files.
 */
object LegacySessionParser {

    data class NormalizedSession(
        val project: JsonObject,
        val session: JsonObject,
        val messages: List<JsonObject>,
        val parts: List<JsonObject>,
    )

    fun parseSession(
        id: String,
        conversationRaw: String,
        item: LegacyHistoryItem? = null,
    ): NormalizedSession {
        val workspace = LegacySessionPath.normalize(item?.workspace)
        val effectiveItem = item?.copy(workspace = workspace.takeIf { it.isNotEmpty() })

        val project = createProject(effectiveItem)
        val session = createSession(id, effectiveItem, project["id"]?.jsonPrimitive?.content ?: "", workspace)
        val conversation = parseConversation(conversationRaw)
        val messages = LegacySessionMessages.parseMessages(conversation, id, workspace, effectiveItem)
        val parts = LegacySessionParts.parseParts(conversation, id, effectiveItem)
        val referenced = parts.mapNotNull { it["messageID"]?.jsonPrimitive?.content }.toSet()
        val kept = relink(keep(messages, referenced), referenced)

        return NormalizedSession(project = project, session = session, messages = kept, parts = parts)
    }

    private fun keep(messages: List<JsonObject>, referenced: Set<String>): List<JsonObject> = messages.filterIndexed { index, msg ->
        val id = msg["id"]?.jsonPrimitive?.content ?: return@filterIndexed false
        if (id in referenced) return@filterIndexed true
        if (role(msg) != "user") return@filterIndexed false
        val next = messages.getOrNull(index + 1) ?: return@filterIndexed false
        role(next) == "assistant" && next["id"]?.jsonPrimitive?.content in referenced
    }

    private fun relink(messages: List<JsonObject>, referenced: Set<String>): List<JsonObject> = messages.mapIndexed { index, msg ->
        val data = msg["data"] as? JsonObject ?: return@mapIndexed msg
        if (role(msg) != "assistant") return@mapIndexed msg
        val parent = messages.take(index).lastOrNull {
            val id = it["id"]?.jsonPrimitive?.content
            role(it) == "user" && id != null && id in referenced
        }?.get("id")?.jsonPrimitive?.content
            ?: msg["id"]?.jsonPrimitive?.content
        parent ?: return@mapIndexed msg
        JsonObject(msg.toMutableMap().also {
            it["data"] = JsonObject(data.toMutableMap().also { body -> body["parentID"] = JsonPrimitive(parent) })
        })
    }

    private fun role(msg: JsonObject): String? = (msg["data"] as? JsonObject)?.get("role")?.jsonPrimitive?.content

    // -----------------------------------------------------------------------
    // Project payload
    // -----------------------------------------------------------------------

    fun createProject(item: LegacyHistoryItem?): JsonObject {
        val dir = item?.workspace ?: ""
        val ts = item?.ts ?: 0L
        return buildJsonObject {
            put("id", LegacySessionIds.createProjectId(dir))
            put("worktree", dir)
            put("sandboxes", if (dir.isNotEmpty()) JsonArray(listOf(JsonPrimitive(dir))) else JsonArray(emptyList()))
            put("timeCreated", ts)
            put("timeUpdated", ts)
        }
    }

    // -----------------------------------------------------------------------
    // Session payload
    // -----------------------------------------------------------------------

    fun createSession(id: String, item: LegacyHistoryItem?, projectId: String, dir: String): JsonObject {
        val ts = item?.ts ?: 0L
        return buildJsonObject {
            put("id", LegacySessionIds.createSessionId(id))
            put("projectID", projectId)
            put("slug", id)
            put("directory", dir)
            put("title", item?.task ?: id)
            put("version", "v2")
            put("timeCreated", ts)
            put("timeUpdated", ts)
        }
    }

    // -----------------------------------------------------------------------
    // Conversation file parsing
    // -----------------------------------------------------------------------

    fun parseConversation(raw: String): List<LegacyApiMessage> {
        val arr = LegacyMigrationJson.parseArray(raw) ?: return emptyList()
        return arr.mapNotNull { elem ->
            val obj = runCatching { elem.jsonObject }.getOrNull() ?: return@mapNotNull null
            val role = obj["role"]?.jsonPrimitive?.content ?: return@mapNotNull null
            val ts = obj["ts"]?.jsonPrimitive?.content?.toLongOrNull()
            val type = obj["type"]?.jsonPrimitive?.content
            val text = obj["text"]?.jsonPrimitive?.content
            val reasoningContent = obj["reasoning_content"]?.jsonPrimitive?.content
            val reasoningDetails = runCatching {
                obj["reasoning_details"]?.let {
                    (it as? JsonArray)?.map { e ->
                        val m = runCatching { e.jsonObject }.getOrNull() ?: return@map null
                        m.entries.associate { (k, v) ->
                            k to (runCatching { v.jsonPrimitive.content }.getOrNull() ?: "")
                        }
                    }?.filterNotNull()
                }
            }.getOrNull()

            // Parse content: either a String or a List of blocks
            val contentRaw = obj["content"]
            val content: Any? = when {
                contentRaw == null -> null
                contentRaw is JsonPrimitive && contentRaw.isString -> contentRaw.content
                contentRaw is JsonArray -> contentRaw.map { e ->
                    val block = runCatching { e.jsonObject }.getOrNull()
                    block?.entries?.associate { (k, v) ->
                        k to (runCatching { v.jsonPrimitive.content }.getOrNull()
                            ?: runCatching { v.jsonObject.toMap() }.getOrNull()
                            ?: runCatching { (v as JsonArray).map { inner ->
                                runCatching { inner.jsonPrimitive.content }.getOrNull()
                                    ?: runCatching { inner.jsonObject.entries.associate { (ik, iv) -> ik to runCatching { iv.jsonPrimitive.content }.getOrNull() } }.getOrNull()
                            }}.getOrNull()
                            ?: v.toString())
                    }
                }.filterNotNull()
                else -> null
            }

            LegacyApiMessage(
                role = role,
                content = content,
                ts = ts,
                isSummary = obj["isSummary"]?.jsonPrimitive?.content?.toBooleanStrictOrNull(),
                id = obj["id"]?.jsonPrimitive?.content,
                type = type,
                text = text,
                reasoning_content = reasoningContent,
                reasoning_details = reasoningDetails,
            )
        }
    }
}
