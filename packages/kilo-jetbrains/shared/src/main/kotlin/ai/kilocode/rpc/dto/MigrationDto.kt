package ai.kilocode.rpc.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

@Serializable
enum class LegacyMigrationStatusDto {
    @SerialName("completed") completed,
    @SerialName("completed_with_errors") completed_with_errors,
    @SerialName("skipped") skipped,
}

// ---------------------------------------------------------------------------
// Detection DTOs
// ---------------------------------------------------------------------------

@Serializable
data class MigrationProviderInfoDto(
    val profileName: String,
    val provider: String,
    val model: String?,
    val hasApiKey: Boolean,
    val supported: Boolean,
    val newProviderName: String?,
)

@Serializable
data class MigrationMcpServerInfoDto(
    val name: String,
    val type: String,
    val disabled: Boolean?,
)

@Serializable
data class MigrationCustomModeInfoDto(
    val name: String,
    val slug: String,
    val nativeSlug: String? = null,
)

@Serializable
data class MigrationSessionInfoDto(
    val id: String,
    val title: String,
    val directory: String,
    val time: Long,
)

@Serializable
data class MigrationDefaultModelInfoDto(
    val provider: String,
    val model: String,
)

@Serializable
data class LegacyAutocompleteSettingsDto(
    val enableAutoTrigger: Boolean?,
    val enableSmartInlineTaskKeybinding: Boolean?,
    val enableChatAutocomplete: Boolean?,
)

@Serializable
data class LegacySettingsDto(
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
    val autocomplete: LegacyAutocompleteSettingsDto?,
)

@Serializable
data class LegacyMigrationDetectionDto(
    val providers: List<MigrationProviderInfoDto>,
    val mcpServers: List<MigrationMcpServerInfoDto>,
    val customModes: List<MigrationCustomModeInfoDto>,
    val sessions: List<MigrationSessionInfoDto>,
    val defaultModel: MigrationDefaultModelInfoDto?,
    val settings: LegacySettingsDto?,
    val hasData: Boolean,
)

// ---------------------------------------------------------------------------
// Selection DTOs
// ---------------------------------------------------------------------------

@Serializable
data class MigrationAutoApprovalSelectionsDto(
    val commandRules: Boolean,
    val readPermission: Boolean,
    val writePermission: Boolean,
    val executePermission: Boolean,
    val mcpPermission: Boolean,
    val taskPermission: Boolean,
)

@Serializable
data class MigrationSettingsSelectionsDto(
    val autoApproval: MigrationAutoApprovalSelectionsDto,
    val language: Boolean,
    val autocomplete: Boolean,
)

@Serializable
data class MigrationSessionSelectionDto(
    val id: String,
)

@Serializable
data class LegacyMigrationSelectionsDto(
    val providers: List<String>,
    val mcpServers: List<String>,
    val customModes: List<String>,
    val sessions: List<MigrationSessionSelectionDto>,
    val defaultModel: Boolean,
    val settings: MigrationSettingsSelectionsDto,
    val keepLegacySettingsFile: Boolean = true,
)

// ---------------------------------------------------------------------------
// Result / Progress DTOs
// ---------------------------------------------------------------------------

@Serializable
enum class MigrationItemCategoryDto {
    @SerialName("provider") provider,
    @SerialName("mcpServer") mcpServer,
    @SerialName("customMode") customMode,
    @SerialName("session") session,
    @SerialName("defaultModel") defaultModel,
    @SerialName("settings") settings,
}

@Serializable
enum class MigrationItemStatusDto {
    @SerialName("success") success,
    @SerialName("warning") warning,
    @SerialName("error") error,
}

@Serializable
data class LegacyMigrationResultItemDto(
    val item: String,
    val category: MigrationItemCategoryDto,
    val status: MigrationItemStatusDto,
    val message: String? = null,
)

@Serializable
enum class MigrationItemProgressStatusDto {
    @SerialName("migrating") migrating,
    @SerialName("success") success,
    @SerialName("warning") warning,
    @SerialName("error") error,
}

@Serializable
enum class MigrationSessionPhaseDto {
    @SerialName("preparing") preparing,
    @SerialName("storing") storing,
    @SerialName("skipped") skipped,
    @SerialName("done") done,
    @SerialName("summary") summary,
    @SerialName("error") error,
}

@Serializable
data class LegacyMigrationItemProgressDto(
    val item: String,
    val status: MigrationItemProgressStatusDto,
    val message: String? = null,
)

@Serializable
data class LegacyMigrationSessionProgressDto(
    val session: MigrationSessionInfoDto?,
    val index: Int,
    val total: Int,
    val phase: MigrationSessionPhaseDto,
    val error: String? = null,
)

// ---------------------------------------------------------------------------
// Cleanup DTOs
// ---------------------------------------------------------------------------

@Serializable
data class LegacyCleanupTargetsDto(
    val providerProfiles: Boolean = false,
    val mcpSettings: Boolean = false,
    val customModes: Boolean = false,
    val globalState: Boolean = false,
    val taskHistory: Boolean = false,
    val legacySettingsFile: Boolean = false,
)

@Serializable
data class LegacyCleanupReportDto(
    val cleaned: List<String>,
    val errors: List<String>,
)

// ---------------------------------------------------------------------------
// Migration event sealed class (streamed from migrate())
// ---------------------------------------------------------------------------

@Serializable
sealed class LegacyMigrationEventDto {
    @Serializable
    @SerialName("item")
    data class Item(val progress: LegacyMigrationItemProgressDto) : LegacyMigrationEventDto()

    @Serializable
    @SerialName("session")
    data class Session(val progress: LegacyMigrationSessionProgressDto) : LegacyMigrationEventDto()

    @Serializable
    @SerialName("complete")
    data class Complete(val items: List<LegacyMigrationResultItemDto>) : LegacyMigrationEventDto()

    @Serializable
    @SerialName("error")
    data class Error(val message: String) : LegacyMigrationEventDto()
}
