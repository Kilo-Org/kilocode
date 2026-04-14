package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
enum class KiloAppStatusDto {
    DISCONNECTED,
    CONNECTING,
    LOADING,
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
data class KiloAppStateDto(
    val status: KiloAppStatusDto,
    val error: String? = null,
    val errors: List<LoadErrorDto> = emptyList(),
    val progress: LoadProgressDto? = null,
)
