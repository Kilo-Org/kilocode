package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

class InMemoryLegacyMigrationStore(private val root: JsonObject) : LegacyMigrationStore {
    override fun status(): LegacyMigrationStatus? = null
    override fun mark(status: LegacyMigrationStatus) = Unit

    override fun providerProfilesRaw(): String? = string("providerProfiles")
    override fun oauthRaw(key: String): String? = (root["oauth"] as? JsonObject)?.get(key)?.jsonPrimitive?.content
    override fun mcpSettingsRaw(): String? = string("mcpSettings")
    override fun customModesRaw(): String? = string("customModes")
    override fun customModePromptsRaw(): String? = string("customModePrompts")
    override fun autocompleteRaw(): String? = string("autocomplete")
    override fun globalStateValue(key: String): JsonElement? = (root["globalState"] as? JsonObject)?.get(key)
    override fun taskHistoryRaw(): String? = string("taskHistory")
    override fun taskConversationRaw(id: String): String? = (root["conversations"] as? JsonObject)?.get(id)?.jsonPrimitive?.content

    override fun cleanup(targets: LegacyCleanupTargets): LegacyCleanupReport =
        LegacyCleanupReport(cleaned = emptyList(), errors = emptyList())

    private fun string(key: String): String? = root[key]?.jsonPrimitive?.content
}
