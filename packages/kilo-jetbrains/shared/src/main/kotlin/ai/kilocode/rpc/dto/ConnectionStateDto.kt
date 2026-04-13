package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
enum class ConnectionStatusDto {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    ERROR,
}

@Serializable
data class ConnectionStateDto(
    val status: ConnectionStatusDto,
    val error: String? = null,
)
