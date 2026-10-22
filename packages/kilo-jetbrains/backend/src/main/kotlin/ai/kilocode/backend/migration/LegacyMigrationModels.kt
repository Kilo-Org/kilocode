package ai.kilocode.backend.migration

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// ---------------------------------------------------------------------------
// Legacy input models (data shapes from legacy Kilo Code v5.x)
// ---------------------------------------------------------------------------

data class LegacyProviderProfiles(
    val currentApiConfigName: String,
    val apiConfigs: Map<String, JsonObject>,
    val modeApiConfigs: Map<String, String>? = null,
)

data class LegacyMcpServer(
    val type: String?,
    val command: String?,
    val args: List<String>?,
    val url: String?,
    val env: Map<String, String>?,
    val headers: Map<String, String>?,
    val disabled: Boolean?,
    val timeout: Int?,
)

data class LegacyCustomMode(
    val slug: String,
    val name: String,
    val roleDefinition: String,
    val customInstructions: String?,
    val whenToUse: String?,
    val description: String?,
    /** Each element is either a plain String group name or a Pair<String, Map> with options */
    val groups: List<Any>,
)

data class LegacySettings(
    val autoApprovalEnabled: Boolean?,
    val allowedCommands: List<String>?,
    val deniedCommands: List<String>?,
    val alwaysAllowReadOnly: Boolean?,
    val alwaysAllowReadOnlyOutsideWorkspace: Boolean?,
    val alwaysAllowWrite: Boolean?,
    val alwaysAllowExecute: Boolean?,
    val alwaysAllowMcp: Boolean?,
    val alwaysAllowModeSwitch: Boolean?,
    val alwaysAllowSubtasks: Boolean?,
    val language: String?,
    val autocomplete: LegacyAutocompleteSettings?,
)

data class LegacyAutocompleteSettings(
    val enableAutoTrigger: Boolean?,
    val enableSmartInlineTaskKeybinding: Boolean?,
    val enableChatAutocomplete: Boolean?,
)

data class LegacyHistoryItem(
    val id: String,
    val task: String?,
    val workspace: String?,
    val ts: Long?,
    val mode: String?,
    val rootTaskId: String?,
    val parentTaskId: String?,
)

// ---------------------------------------------------------------------------
// Detection summary models (what the wizard shows before migration)
// ---------------------------------------------------------------------------

data class MigrationProviderInfo(
    val profileName: String,
    val provider: String,
    val model: String?,
    val hasApiKey: Boolean,
    val supported: Boolean,
    val newProviderName: String?,
)

data class MigrationMcpServerInfo(
    val name: String,
    val type: String,
    val disabled: Boolean?,
)

data class MigrationCustomModeInfo(
    val name: String,
    val slug: String,
    /** Original slug when migrating a modified native mode under a new slug */
    val nativeSlug: String? = null,
)

data class MigrationSessionInfo(
    val id: String,
    val title: String,
    val directory: String,
    val time: Long,
)

data class MigrationDefaultModelInfo(
    val provider: String,
    val model: String,
)

data class LegacyMigrationDetection(
    val providers: List<MigrationProviderInfo>,
    val mcpServers: List<MigrationMcpServerInfo>,
    val customModes: List<MigrationCustomModeInfo>,
    val sessions: List<MigrationSessionInfo>,
    val defaultModel: MigrationDefaultModelInfo?,
    val settings: LegacySettings?,
    val hasData: Boolean,
)

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

enum class LegacyMigrationStatus {
    Completed,
    CompletedWithErrors,
    Skipped,
}

// ---------------------------------------------------------------------------
// Migration selections (what the user wants to migrate)
// ---------------------------------------------------------------------------

data class MigrationAutoApprovalSelections(
    val commandRules: Boolean,
    val readPermission: Boolean,
    val writePermission: Boolean,
    val executePermission: Boolean,
    val mcpPermission: Boolean,
    val taskPermission: Boolean,
)

data class MigrationSettingsSelections(
    val autoApproval: MigrationAutoApprovalSelections,
    val language: Boolean,
    val autocomplete: Boolean,
)

data class MigrationSessionSelection(
    val id: String,
)

data class LegacyMigrationSelections(
    val providers: List<String>,
    val mcpServers: List<String>,
    val customModes: List<String>,
    val sessions: List<MigrationSessionSelection>,
    val defaultModel: Boolean,
    val settings: MigrationSettingsSelections,
    val keepLegacySettingsFile: Boolean = true,
)

// ---------------------------------------------------------------------------
// Result / progress models
// ---------------------------------------------------------------------------

enum class MigrationItemCategory {
    provider, mcpServer, customMode, session, defaultModel, settings
}

enum class MigrationItemStatus {
    success, warning, error
}

data class LegacyMigrationResultItem(
    val item: String,
    val category: MigrationItemCategory,
    val status: MigrationItemStatus,
    val message: String? = null,
)

data class LegacyMigrationReport(
    val items: List<LegacyMigrationResultItem>,
) {
    val hasErrors: Boolean get() = items.any { it.status == MigrationItemStatus.error }
    val hasWarnings: Boolean get() = items.any { it.status == MigrationItemStatus.warning }
}

// ---------------------------------------------------------------------------
// Progress sink models
// ---------------------------------------------------------------------------

enum class MigrationItemProgressStatus {
    migrating, success, warning, error
}

data class LegacyMigrationItemProgress(
    val item: String,
    val status: MigrationItemProgressStatus,
    val message: String? = null,
)

enum class MigrationSessionPhase {
    preparing, storing, skipped, done, summary, error
}

data class LegacyMigrationSessionProgress(
    val session: MigrationSessionInfo?,
    val index: Int,
    val total: Int,
    val phase: MigrationSessionPhase,
    val error: String? = null,
)

// ---------------------------------------------------------------------------
// Cleanup models
// ---------------------------------------------------------------------------

data class LegacyCleanupTargets(
    val providerProfiles: Boolean = false,
    val mcpSettings: Boolean = false,
    val customModes: Boolean = false,
    val globalState: Boolean = false,
    val taskHistory: Boolean = false,
    val legacySettingsFile: Boolean = false,
)

data class LegacyCleanupReport(
    val cleaned: List<String>,
    val errors: List<String>,
)

// ---------------------------------------------------------------------------
// Import result from backend
// ---------------------------------------------------------------------------

data class LegacyImportResult(
    val id: String,
    val skipped: Boolean,
)
