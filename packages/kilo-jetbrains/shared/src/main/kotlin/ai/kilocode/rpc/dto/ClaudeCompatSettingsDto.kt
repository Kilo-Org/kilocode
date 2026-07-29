package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class ClaudeCompatSettingsDto(
    val skillsCommands: Boolean = true,
    val instructions: Boolean = false,
)
