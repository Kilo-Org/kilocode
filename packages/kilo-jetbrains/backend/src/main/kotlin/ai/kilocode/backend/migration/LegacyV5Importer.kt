package ai.kilocode.backend.migration

import com.intellij.openapi.util.JDOMUtil
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class LegacyV5Importer(private val src: LegacyV5Sources) {
    companion object {
        private const val EXT = "kilo-code"
        private const val PROVIDERS = "roo_cline_config_api_config"
        private const val CODEX = "openai-codex-oauth-credentials"
        private val json = Json { ignoreUnknownKeys = true }
    }

    fun import(includeConversations: Boolean = true, sessions: Set<String>? = null): JsonObject {
        val secrets = parseObject(src.secretsJson())
        val secret = entry(secrets, PROVIDERS)
        val state = parseGlobalState()
        val history = state?.get("taskHistory")?.content()
        val prompts = state?.get("customModePrompts")?.content()
        val stored = historyIds(history)
        val scanned = if (stored.isEmpty()) scanHistory() else emptyList()
        val scanRaw = scanned.takeIf { it.isNotEmpty() }?.let { json.encodeToString(kotlinx.serialization.json.JsonArray.serializer(), buildJsonArray { it.forEach(::add) }) }
        val ids = stored.ifEmpty { scanned.mapNotNull { it["id"]?.content() } }
        val wanted = sessions ?: ids.toSet()
        val conv = ids.mapNotNull { id ->
            if (id !in wanted) return@mapNotNull null
            val raw = if (includeConversations) src.taskConversationFile(id) ?: return@mapNotNull null
            else if (src.hasTaskConversationFile(id)) "" else return@mapNotNull null
            id to JsonPrimitive(raw)
        }.toMap()

        return buildJsonObject {
            secret?.get(PROVIDERS)?.content()?.let { put("providerProfiles", it) }
            oauth(secret).takeIf { it.isNotEmpty() }?.let { put("oauth", JsonObject(it)) }
            src.mcpSettingsFile()?.let { put("mcpSettings", it) }
            src.customModesFile()?.let { put("customModes", it) }
            state?.let { put("globalState", it) }
            prompts?.let { put("customModePrompts", it) }
            (history?.takeIf { stored.isNotEmpty() } ?: scanRaw)?.let { put("taskHistory", it) }
            if (conv.isNotEmpty()) put("conversations", JsonObject(conv))
        }
    }

    // Scan fallback used when the IDE globalState XML has no taskHistory. v5 never writes a
    // per-task metadata file with the workspace (task_metadata.json only holds files_in_context),
    // so workspace must come from the conversation and ts from ui_messages.json.
    private fun scanHistory(): List<JsonObject> = src.taskDirIds().mapNotNull { id ->
        val conv = src.taskConversationFile(id) ?: return@mapNotNull null
        val workspace = workspace(conv) ?: return@mapNotNull null
        buildJsonObject {
            put("id", id)
            put("task", title(conv, id))
            put("workspace", workspace)
            put("ts", uiTimestamp(id) ?: timestamp(id))
        }
    }

    private fun uiTimestamp(id: String): Long? {
        val raw = src.uiMessagesFile(id) ?: return null
        val arr = runCatching { json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return null
        return arr.firstNotNullOfOrNull { (it as? JsonObject)?.get("ts")?.jsonPrimitive?.content?.toLongOrNull() }
    }

    private fun parseGlobalState(): JsonObject? {
        val xml = src.globalStateXml() ?: return null
        val root = runCatching { JDOMUtil.load(xml) }.getOrNull() ?: return null
        val entries = root.descendants()
            .filter { it.name == "entry" }
            .mapNotNull { node ->
                val key = node.getAttributeValue("key") ?: return@mapNotNull null
                val value = node.getAttributeValue("value") ?: node.getChildText("value") ?: return@mapNotNull null
                key to value
            }
            .toList()
        val value = entries.firstOrNull { it.first == EXT }?.second
            ?: entries.singleOrNull()?.second
            ?: entries.firstOrNull { parseObject(it.second)?.containsKey("taskHistory") == true }?.second
            ?: return null
        return parseObject(value)
    }

    private fun entry(root: JsonObject?, probe: String): JsonObject? {
        root ?: return null
        val exact = root[EXT] as? JsonObject
        if (exact != null) return exact
        val objects = root.values.filterIsInstance<JsonObject>()
        return objects.singleOrNull() ?: objects.firstOrNull { it.containsKey(probe) }
    }

    private fun oauth(secret: JsonObject?): Map<String, JsonElement> {
        secret ?: return emptyMap()
        return secret.entries
            .filter { it.key == CODEX || it.key.contains("oauth", ignoreCase = true) }
            .mapNotNull { it.value.content()?.let { value -> it.key to JsonPrimitive(value) } }
            .toMap()
    }

    private fun historyIds(raw: String?): List<String> {
        raw ?: return emptyList()
        val arr = runCatching { json.parseToJsonElement(raw) }.getOrNull() as? kotlinx.serialization.json.JsonArray ?: return emptyList()
        return arr.mapNotNull { item -> (item as? JsonObject)?.get("id")?.content() }
    }

    private fun workspace(raw: String): String? {
        val match = Regex("# Current Workspace Directory \\(([^)]+)\\)").find(raw)
        return match?.groupValues?.get(1)?.takeIf { it.isNotBlank() }
    }

    private fun title(raw: String, id: String): String {
        val arr = runCatching { json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return id
        val text = arr.firstNotNullOfOrNull { item ->
            val msg = item as? JsonObject ?: return@firstNotNullOfOrNull null
            if (msg["role"]?.content() != "user") return@firstNotNullOfOrNull null
            contentText(msg["content"])
        }
        return text?.let(::cleanTitle)?.takeIf { it.isNotBlank() } ?: id
    }

    private fun cleanTitle(raw: String): String {
        val task = Regex("<task>([\\s\\S]*?)</task>", RegexOption.IGNORE_CASE).find(raw)?.groupValues?.get(1)
        val text = task ?: raw
        return text.replace(Regex("<environment_details>[\\s\\S]*", RegexOption.IGNORE_CASE), "")
            .replace("\n", " ")
            .trim()
            .take(120)
    }

    private fun contentText(elem: JsonElement?): String? {
        if (elem == null) return null
        val plain = runCatching { elem.jsonPrimitive.content }.getOrNull()
        if (!plain.isNullOrBlank()) return plain
        val arr = runCatching { elem.jsonArray }.getOrNull() ?: return null
        return arr.firstNotNullOfOrNull { block ->
            val obj = block as? JsonObject ?: return@firstNotNullOfOrNull null
            obj["text"]?.content()?.takeIf { it.isNotBlank() }
        }
    }

    private fun timestamp(id: String): Long = id.toLongOrNull()?.takeIf { it > 1_000_000_000_000L } ?: 0L

    private fun parseObject(raw: String?): JsonObject? {
        raw ?: return null
        return try {
            json.parseToJsonElement(raw).jsonObject
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun JsonElement.content(): String? = runCatching { jsonPrimitive.content }.getOrNull()
}

private fun org.jdom.Element.descendants(): Sequence<org.jdom.Element> = sequence {
    yield(this@descendants)
    for (child in children) yieldAll(child.descendants())
}
