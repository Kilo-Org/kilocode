package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.rpc.dto.AgentConfigPatchDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.PermissionConfigDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

internal const val MAX_AGENT_IMPORT_SIZE = 1_048_576L

internal data class AgentImport(
    val name: String,
    val patch: ConfigPatchDto,
)

internal enum class AgentImportError(val key: String) {
    INVALID_JSON("settings.agentBehavior.agents.import.invalidJson"),
    INVALID_NAME("settings.agentBehavior.agents.import.invalidName"),
    NAME_TAKEN("settings.agentBehavior.agents.import.nameTaken"),
    TOO_LARGE("settings.agentBehavior.agents.import.tooLarge"),
}

internal class AgentImportException(val error: AgentImportError) : RuntimeException(error.key)

internal fun parseAgentImport(json: String, names: Collection<String>): AgentImport {
    val root = try {
        JSON.parseToJsonElement(json)
    } catch (_: SerializationException) {
        throw AgentImportException(AgentImportError.INVALID_JSON)
    } as? JsonObject ?: throw AgentImportException(AgentImportError.INVALID_JSON)

    val name = root.string("name")?.trim().orEmpty()
    if (!AGENT_ID.matches(name)) throw AgentImportException(AgentImportError.INVALID_NAME)
    if (names.any { it == name }) throw AgentImportException(AgentImportError.NAME_TAKEN)

    val cfg = AgentConfigPatchDto(
        model = root.string("model"),
        prompt = root.string("prompt"),
        description = root.string("description"),
        mode = root.string("mode")?.takeIf { it in MODES } ?: KiloCliParser.MODE_PRIMARY,
        temperature = root.number("temperature"),
        top_p = root.number("top_p"),
        steps = root.long("steps"),
        permission = permission(root["permission"]),
    )
    return AgentImport(name, ConfigPatchDto(agents = mapOf(name to cfg)))
}

private fun permission(raw: JsonElement?): PermissionConfigDto? {
    val obj = raw as? JsonObject ?: return null
    val out = linkedMapOf<String, PermissionRuleDto>()
    for ((tool, item) in obj) {
        val scalar = level(item)
        if (scalar != null) {
            out[tool] = PermissionRuleDto.Level(scalar)
            continue
        }
        val nested = item as? JsonObject ?: continue
        val map = linkedMapOf<String, String?>()
        for ((pattern, value) in nested) {
            val action = level(value) ?: continue
            map[pattern] = action
        }
        if (map.isNotEmpty()) out[tool] = PermissionRuleDto.Patterns(map)
    }
    return out.takeIf { it.isNotEmpty() }
}

private fun level(raw: JsonElement?): String? {
    val item = raw as? JsonPrimitive ?: return null
    if (!item.isString) return null
    val value = item.content
    return value.takeIf { it in LEVELS }
}

private fun JsonObject.string(key: String): String? {
    val item = this[key] as? JsonPrimitive ?: return null
    if (!item.isString) return null
    return item.content
}

private fun JsonObject.number(key: String): Double? {
    val item = this[key] as? JsonPrimitive ?: return null
    if (item.isString) return null
    return item.doubleOrNull?.takeIf { it.isFinite() }
}

private fun JsonObject.long(key: String): Long? {
    val item = this[key] as? JsonPrimitive ?: return null
    if (item.isString) return null
    return item.longOrNull
}

private val JSON = Json
private val MODES = setOf(KiloCliParser.MODE_PRIMARY, KiloCliParser.MODE_SUBAGENT, KiloCliParser.MODE_ALL)
private val LEVELS = setOf("allow", "ask", "deny")
