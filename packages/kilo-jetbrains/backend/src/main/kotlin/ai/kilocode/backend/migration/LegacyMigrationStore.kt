package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonElement

/**
 * Source adapter for legacy Kilo Code v5.x data.
 *
 * Abstracts over VS Code SecretStorage, globalState, and filesystem access.
 * Callers supply raw content; this interface never reads VS Code storage directly.
 * The store also persists the migration status key ("kilo.legacyMigrationStatus").
 */
interface LegacyMigrationStore {
    fun status(): LegacyMigrationStatus?
    fun mark(status: LegacyMigrationStatus)

    /** Raw JSON from "roo_cline_config_api_config" secret */
    fun providerProfilesRaw(): String?
    /** Raw JSON from an OAuth secret key (e.g. openai-codex-oauth-credentials) */
    fun oauthRaw(key: String): String?
    /** Raw JSON from mcp_settings.json */
    fun mcpSettingsRaw(): String?
    /** Raw YAML or JSON from custom_modes.yaml */
    fun customModesRaw(): String?
    /** Raw JSON from customModePrompts globalState key */
    fun customModePromptsRaw(): String?
    /** Raw JSON from ghostServiceSettings globalState key */
    fun autocompleteRaw(): String?
    /** Value from a globalState key */
    fun globalStateValue(key: String): JsonElement?
    /** Raw JSON array from "taskHistory" globalState key */
    fun taskHistoryRaw(): String?
    /** Raw JSON array from tasks/<id>/api_conversation_history.json */
    fun taskConversationRaw(id: String): String?

    fun cleanup(targets: LegacyCleanupTargets): LegacyCleanupReport
}
