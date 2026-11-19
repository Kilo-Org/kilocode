package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class LogConfigDto(
    val level: String? = null,
    val contentMode: String? = null,
    val previewMax: Int? = null,
)
