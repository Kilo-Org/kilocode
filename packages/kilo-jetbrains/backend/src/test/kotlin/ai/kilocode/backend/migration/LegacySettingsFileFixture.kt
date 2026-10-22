package ai.kilocode.backend.migration

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Files

internal class LegacySettingsFileFixture {
    private val file = Files.createTempDirectory("kilo-legacy-migration").resolve("legacy-settings.json").toFile()
    var migrationStatus: LegacyMigrationStatus? = null
    var providerProfiles: String? = null
    val oauthSecrets: MutableMap<String, String> = mutableMapOf()
    var mcpSettings: String? = null
    var customModes: String? = null
    var customModePrompts: String? = null
    var autocomplete: String? = null
    val globalState: MutableMap<String, JsonElement> = mutableMapOf()
    var taskHistory: String? = null
    val conversations: MutableMap<String, String> = mutableMapOf()

    fun store(): LegacyMigrationStore {
        flush()
        return LegacySettingsFileMigrationStore(file)
    }

    fun refresh() {
        migrationStatus = LegacySettingsFileMigrationStore(file).status()
    }

    fun exists() = file.exists()

    private fun flush() {
        val root = mutableMapOf<String, JsonElement>()
        migrationStatus?.let { root["migrationStatus"] = JsonPrimitive(it.name) }
        providerProfiles?.let { root["providerProfiles"] = JsonPrimitive(it) }
        if (oauthSecrets.isNotEmpty()) root["oauth"] = JsonObject(oauthSecrets.mapValues { JsonPrimitive(it.value) })
        mcpSettings?.let { root["mcpSettings"] = JsonPrimitive(it) }
        customModes?.let { root["customModes"] = JsonPrimitive(it) }
        customModePrompts?.let { root["customModePrompts"] = JsonPrimitive(it) }
        autocomplete?.let { root["autocomplete"] = JsonPrimitive(it) }
        if (globalState.isNotEmpty()) root["globalState"] = JsonObject(globalState)
        taskHistory?.let { root["taskHistory"] = JsonPrimitive(it) }
        if (conversations.isNotEmpty()) root["conversations"] = JsonObject(conversations.mapValues { JsonPrimitive(it.value) })
        file.parentFile.mkdirs()
        file.writeText(Json.encodeToString(JsonObject.serializer(), JsonObject(root)))
    }
}
