package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName

@Serializable
enum class KiloAppStatusDto {
    DISCONNECTED,
    CONNECTING,
    LOADING,
    MIGRATION_REQUIRED,
    READY,
    ERROR,
}

@Serializable
enum class ProfileStatusDto {
    PENDING,
    LOADED,
    NOT_LOGGED_IN,
}

@Serializable
data class LoadProgressDto(
    val config: Boolean = false,
    val notifications: Boolean = false,
    val profile: ProfileStatusDto = ProfileStatusDto.PENDING,
)

@Serializable
data class LoadErrorDto(
    val resource: String,
    val status: Int? = null,
    val detail: String? = null,
)

@Serializable
data class ConfigWarningDto(
    val path: String,
    val message: String,
    val detail: String? = null,
)

@Serializable
data class AgentConfigDto(
    val model: String? = null,
    val variant: String? = null,
    val prompt: String? = null,
    val description: String? = null,
    val mode: String? = null,
    val hidden: Boolean? = null,
    val disable: Boolean? = null,
    val temperature: Double? = null,
    val top_p: Double? = null,
    val steps: Long? = null,
    val permission: PermissionConfigDto? = null,
)

@Serializable
data class ConfigDto(
    val model: String? = null,
    val smallModel: String? = null,
    val subagentModel: String? = null,
    val subagentVariant: String? = null,
    val defaultAgent: String? = null,
    val instructions: List<String> = emptyList(),
    val skills: SkillsConfigDto? = null,
    val mcp: Map<String, McpConfigDto> = emptyMap(),
    val agent: Map<String, AgentConfigDto> = emptyMap(),
)

@Serializable
data class SkillsConfigDto(
    val paths: List<String> = emptyList(),
    val urls: List<String> = emptyList(),
)

@Serializable
data class SkillsPatchDto(
    val paths: List<String>? = null,
    val urls: List<String>? = null,
)

@Serializable
data class McpConfigDto(
    val type: String? = null,
    val command: List<String>? = null,
    val url: String? = null,
    val environment: Map<String, String>? = null,
    val headers: Map<String, String>? = null,
    val enabled: Boolean? = null,
    val timeout: Long? = null,
)

typealias PermissionConfigDto = Map<String, PermissionRuleDto>

@Serializable
sealed class PermissionRuleDto {
    @Serializable
    @SerialName("level")
    data class Level(val value: String? = null) : PermissionRuleDto()

    @Serializable
    @SerialName("patterns")
    data class Patterns(val map: Map<String, String?> = emptyMap()) : PermissionRuleDto()
}

@Serializable
data class ConfigPatchDto(
    val values: Map<String, String?> = emptyMap(),
    val instructions: List<String>? = null,
    val skills: SkillsPatchDto? = null,
    val mcp: Map<String, McpConfigDto?>? = null,
    val agents: Map<String, AgentConfigPatchDto> = emptyMap(),
)

@Serializable
data class AgentConfigPatchDto(
    val clear: List<String> = emptyList(),
    val model: String? = null,
    val variant: String? = null,
    val prompt: String? = null,
    val description: String? = null,
    val mode: String? = null,
    val hidden: Boolean? = null,
    val disable: Boolean? = null,
    val temperature: Double? = null,
    val top_p: Double? = null,
    val steps: Long? = null,
    val permission: PermissionConfigDto? = null,
)

@Serializable
data class ProfileOrganizationDto(
    val id: String,
    val name: String,
    val role: String,
)

@Serializable
data class ProfileBalanceDto(
    val balance: Double,
)

@Serializable
data class ProfileKiloPassDto(
    val currentPeriodBaseCreditsUsd: Double,
    val currentPeriodUsageUsd: Double,
    val currentPeriodBonusCreditsUsd: Double,
    val nextBillingAt: String? = null,
)

@Serializable
data class ProfileDto(
    val email: String,
    val name: String? = null,
    val organizations: List<ProfileOrganizationDto> = emptyList(),
    val balance: ProfileBalanceDto? = null,
    val kiloPass: ProfileKiloPassDto? = null,
    val currentOrgId: String? = null,
)

@Serializable
data class DeviceAuthDto(
    val code: String?,
    val verificationUrl: String,
    val expiresIn: Int = 900,
)

@Serializable
data class KiloAppStateDto(
    val status: KiloAppStatusDto,
    val error: String? = null,
    val errors: List<LoadErrorDto> = emptyList(),
    val progress: LoadProgressDto? = null,
    val warnings: List<ConfigWarningDto> = emptyList(),
    val config: ConfigDto? = null,
    val profile: ProfileDto? = null,
    val migration: LegacyMigrationDetectionDto? = null,
)
