package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

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
)

@Serializable
data class ConfigDto(
    val model: String? = null,
    val smallModel: String? = null,
    val subagentModel: String? = null,
    val subagentVariant: String? = null,
    val agent: Map<String, AgentConfigDto> = emptyMap(),
)

@Serializable
data class ConfigPatchDto(
    val values: Map<String, String?> = emptyMap(),
    val agents: Map<String, AgentConfigPatchDto> = emptyMap(),
)

@Serializable
data class AgentConfigPatchDto(
    val model: String? = null,
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
