package ai.kilocode.client.migration

import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.LegacyMigrationResultItemDto
import ai.kilocode.rpc.dto.LegacyMigrationSessionProgressDto
import ai.kilocode.rpc.dto.MigrationItemCategoryDto
import ai.kilocode.rpc.dto.MigrationItemProgressStatusDto
import ai.kilocode.rpc.dto.MigrationItemStatusDto
import ai.kilocode.rpc.dto.MigrationSessionPhaseDto

// ---------------------------------------------------------------------------
// User selections for UI
// ---------------------------------------------------------------------------

data class MigrationAutoApprovalUiSelections(
    val commandRules: Boolean = false,
    val readPermission: Boolean = false,
    val writePermission: Boolean = false,
    val executePermission: Boolean = false,
    val mcpPermission: Boolean = false,
    val taskPermission: Boolean = false,
)

data class MigrationSettingsUiSelections(
    val autoApproval: MigrationAutoApprovalUiSelections = MigrationAutoApprovalUiSelections(),
    val language: Boolean = false,
    val autocomplete: Boolean = false,
)

data class MigrationUiSelections(
    val providers: List<String> = emptyList(),
    val mcpServers: List<String> = emptyList(),
    val customModes: List<String> = emptyList(),
    val sessions: List<String> = emptyList(),
    val defaultModel: Boolean = false,
    val settings: MigrationSettingsUiSelections = MigrationSettingsUiSelections(),
    val keepLegacySettingsFile: Boolean = true,
)

// ---------------------------------------------------------------------------
// Progress tracking per item
// ---------------------------------------------------------------------------

data class MigrationItemUiProgress(
    val item: String,
    val category: MigrationItemCategoryDto,
    val status: MigrationItemProgressStatusDto = MigrationItemProgressStatusDto.migrating,
    val message: String? = null,
)

// ---------------------------------------------------------------------------
// Session summary buckets
// ---------------------------------------------------------------------------

data class SessionMigrationSummary(
    val imported: List<LegacyMigrationResultItemDto> = emptyList(),
    val errored: List<LegacyMigrationResultItemDto> = emptyList(),
)

// ---------------------------------------------------------------------------
// Migration phase for the overall UI
// ---------------------------------------------------------------------------

enum class MigrationUiPhase {
    /** Wizard showing selection checkboxes. */
    selecting,
    /** Migration is running. */
    migrating,
    /** Migration finished with no errors. */
    done,
    /** Migration finished with errors. */
    error,
}

// ---------------------------------------------------------------------------
// Top-level shared state emitted by KiloMigrationService
// ---------------------------------------------------------------------------

sealed class MigrationUiState {
    /** Migration overlay should not be shown. */
    object Hidden : MigrationUiState()

    /** Migration data was detected; show the wizard. */
    data class Needed(
        val detection: LegacyMigrationDetectionDto,
        val phase: MigrationUiPhase = MigrationUiPhase.selecting,
        val running: Boolean = false,
        val progress: List<MigrationItemUiProgress> = emptyList(),
        val sessionProgress: LegacyMigrationSessionProgressDto? = null,
        val sessionSummary: SessionMigrationSummary = SessionMigrationSummary(),
        val results: List<LegacyMigrationResultItemDto> = emptyList(),
    ) : MigrationUiState()
}

// ---------------------------------------------------------------------------
// Derived helpers on state
// ---------------------------------------------------------------------------

fun MigrationItemProgressStatusDto.toResultStatus(): MigrationItemStatusDto? = when (this) {
    MigrationItemProgressStatusDto.success -> MigrationItemStatusDto.success
    MigrationItemProgressStatusDto.warning -> MigrationItemStatusDto.warning
    MigrationItemProgressStatusDto.error -> MigrationItemStatusDto.error
    MigrationItemProgressStatusDto.migrating -> null
}

/** Derive group-level status from item progress entries in a category. */
fun groupStatus(items: List<MigrationItemUiProgress>): MigrationItemProgressStatusDto {
    if (items.any { it.status == MigrationItemProgressStatusDto.error }) return MigrationItemProgressStatusDto.error
    if (items.any { it.status == MigrationItemProgressStatusDto.warning }) return MigrationItemProgressStatusDto.warning
    if (items.all { it.status == MigrationItemProgressStatusDto.success }) return MigrationItemProgressStatusDto.success
    if (items.any { it.status == MigrationItemProgressStatusDto.migrating }) return MigrationItemProgressStatusDto.migrating
    return MigrationItemProgressStatusDto.migrating
}

/** True if the session summary phase is currently showing. */
fun LegacyMigrationSessionProgressDto.isSummary(): Boolean =
    phase == MigrationSessionPhaseDto.summary
