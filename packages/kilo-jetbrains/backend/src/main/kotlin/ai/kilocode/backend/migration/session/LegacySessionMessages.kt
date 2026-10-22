package ai.kilocode.backend.migration.session

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import ai.kilocode.backend.migration.LegacyHistoryItem

/**
 * Message conversion for legacy conversation history.
 *
 * Port of packages/kilo-vscode/src/legacy-migration/sessions/lib/messages.ts
 */
object LegacySessionMessages {

    /**
     * Convert legacy API messages to session-import message payloads.
     * Only "user" and "assistant" roles are migrated.
     */
    fun parseMessages(
        conversation: List<LegacyApiMessage>,
        id: String,
        dir: String,
        item: LegacyHistoryItem? = null,
    ): List<JsonObject> {
        return conversation
            .filter { it.role == "user" || it.role == "assistant" }
            .mapIndexed { index, entry -> parseMessage(entry, index, id, dir, item) }
            .filterNotNull()
    }

    private fun parseMessage(
        entry: LegacyApiMessage,
        index: Int,
        id: String,
        dir: String,
        item: LegacyHistoryItem?,
    ): JsonObject? {
        val created = entry.ts ?: item?.ts ?: 0L
        val msgId = LegacySessionIds.createMessageId(id, index)
        val sessionId = LegacySessionIds.createSessionId(id)

        return when (entry.role) {
            "user" -> buildJsonObject {
                put("id", msgId)
                put("sessionID", sessionId)
                put("timeCreated", created)
                put("data", buildJsonObject {
                    put("role", "user")
                    put("time", buildJsonObject { put("created", created) })
                    put("agent", "user")
                    put("model", buildJsonObject {
                        put("providerID", "legacy")
                        put("modelID", "legacy")
                    })
                })
            }
            "assistant" -> buildJsonObject {
                put("id", msgId)
                put("sessionID", sessionId)
                put("timeCreated", created)
                put("data", buildJsonObject {
                    put("role", "assistant")
                    put("time", buildJsonObject {
                        put("created", created)
                        put("completed", created)
                    })
                    put("parentID", if (index > 0) LegacySessionIds.createMessageId(id, index - 1) else msgId)
                    put("modelID", "legacy")
                    put("providerID", "legacy")
                    put("mode", item?.mode ?: "code")
                    put("agent", "main")
                    put("path", buildJsonObject {
                        put("cwd", dir)
                        put("root", dir)
                    })
                    put("cost", 0.0)
                    put("tokens", buildJsonObject {
                        put("input", 0L)
                        put("output", 0L)
                        put("reasoning", 0L)
                        put("cache", buildJsonObject {
                            put("read", 0L)
                            put("write", 0L)
                        })
                    })
                })
            }
            else -> null
        }
    }
}

/**
 * A single entry in a legacy api_conversation_history.json array.
 * Fields beyond role/content/ts are only present for reasoning-capable models.
 */
data class LegacyApiMessage(
    val role: String,
    val content: Any?,  // String or List<*>
    val ts: Long?,
    val isSummary: Boolean?,
    val id: String?,
    val type: String?,
    val text: String?,
    val reasoning_content: String?,
    val reasoning_details: List<*>?,
)
