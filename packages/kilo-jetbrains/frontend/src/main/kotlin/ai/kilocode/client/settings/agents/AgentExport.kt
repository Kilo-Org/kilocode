package ai.kilocode.client.settings.agents

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal fun buildAgentExport(agent: AgentEditDraft): String = EXPORT.encodeToString(export(agent))

private fun export(agent: AgentEditDraft): JsonObject = buildJsonObject {
    put("name", agent.name)
    agent.description?.let { put("description", it) }
    agent.prompt?.let { put("prompt", it) }
    agent.model?.let { put("model", it) }
    put("mode", agent.mode)
    agent.temperature?.let { put("temperature", it) }
    agent.topP?.let { put("top_p", it) }
    agent.steps?.let { put("steps", it) }
    permission(agent)?.let { put("permission", it) }
}

private fun permission(agent: AgentEditDraft): JsonObject? {
    val items = agent.permission.sortedWith(compareBy({ it.tool }, { it.pattern ?: "" }, { it.action }))
    if (items.isEmpty()) return null
    val values = linkedMapOf<String, JsonElement>()
    for (tool in items.groupBy { it.tool }.toSortedMap()) {
        val scalar = tool.value.lastOrNull { it.pattern == null || it.pattern == "*" }?.action
        val nested = tool.value.filter { it.pattern != null && it.pattern != "*" }
        values[tool.key] = if (nested.isEmpty()) {
            JsonPrimitive(scalar ?: tool.value.last().action)
        } else {
            buildJsonObject {
                scalar?.let { put("*", it) }
                for (item in nested.sortedBy { it.pattern }) put(item.pattern ?: "*", item.action)
            }
        }
    }
    return JsonObject(values)
}

private val EXPORT = Json { prettyPrint = true }
