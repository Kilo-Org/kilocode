package ai.kilocode.client.migration

import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.LegacyMigrationSelectionsDto
import ai.kilocode.rpc.dto.MigrationAutoApprovalSelectionsDto
import ai.kilocode.rpc.dto.MigrationSessionSelectionDto
import ai.kilocode.rpc.dto.MigrationSettingsSelectionsDto

/**
 * Builds default preselections from detection data, mirroring VS Code behavior.
 * Also converts UI selections to wire DTOs for RPC.
 */
object MigrationSelectionBuilder {

    /**
     * Build default selections mirroring VS Code preselection logic:
     * - Providers: supported providers with API keys
     * - MCP: all if any servers exist
     * - Modes: all if any custom modes exist
     * - Sessions: all if any sessions exist
     * - Default model: if present
     * - Auto-approval: subfields if corresponding data exists
     * - Language: if present
     * - Autocomplete: if present
     */
    fun defaults(detection: LegacyMigrationDetectionDto): MigrationUiSelections {
        val providers = detection.providers
            .filter { it.supported && it.hasApiKey }
            .map { it.profileName }
        val mcpServers = if (detection.mcpServers.isNotEmpty()) detection.mcpServers.map { it.name } else emptyList()
        val customModes = if (detection.customModes.isNotEmpty()) detection.customModes.map { it.slug } else emptyList()
        val sessions = if (detection.sessions.isNotEmpty()) detection.sessions.map { it.id } else emptyList()
        val defaultModel = detection.defaultModel != null

        val settings = detection.settings
        val ap = MigrationAutoApprovalUiSelections(
            commandRules = settings?.let {
                !it.allowedCommands.isNullOrEmpty() || !it.deniedCommands.isNullOrEmpty()
            } ?: false,
            readPermission = settings?.alwaysAllowReadOnly != null || settings?.alwaysAllowReadOnlyOutsideWorkspace != null,
            writePermission = settings?.alwaysAllowWrite != null,
            executePermission = settings?.alwaysAllowExecute != null,
            mcpPermission = settings?.alwaysAllowMcp != null,
            taskPermission = settings?.alwaysAllowModeSwitch != null || settings?.alwaysAllowSubtasks != null,
        )
        val settingsSel = MigrationSettingsUiSelections(
            autoApproval = ap,
            language = !settings?.language.isNullOrEmpty(),
            autocomplete = settings?.autocomplete != null,
        )

        return MigrationUiSelections(
            providers = providers,
            mcpServers = mcpServers,
            customModes = customModes,
            sessions = sessions,
            defaultModel = defaultModel,
            settings = settingsSel,
            keepLegacySettingsFile = true,
        )
    }

    /**
     * Convert UI selections into the wire DTO, taking only supported+apiKey providers.
     */
    fun toDto(selections: MigrationUiSelections): LegacyMigrationSelectionsDto = LegacyMigrationSelectionsDto(
        providers = selections.providers,
        mcpServers = selections.mcpServers,
        customModes = selections.customModes,
        sessions = selections.sessions.map { MigrationSessionSelectionDto(it) },
        defaultModel = selections.defaultModel,
        settings = MigrationSettingsSelectionsDto(
            autoApproval = MigrationAutoApprovalSelectionsDto(
                commandRules = selections.settings.autoApproval.commandRules,
                readPermission = selections.settings.autoApproval.readPermission,
                writePermission = selections.settings.autoApproval.writePermission,
                executePermission = selections.settings.autoApproval.executePermission,
                mcpPermission = selections.settings.autoApproval.mcpPermission,
                taskPermission = selections.settings.autoApproval.taskPermission,
            ),
            language = selections.settings.language,
            autocomplete = selections.settings.autocomplete,
        ),
        keepLegacySettingsFile = selections.keepLegacySettingsFile,
    )
}
