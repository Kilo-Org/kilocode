package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class ConfigTargetDto(
    val path: String,
    val displayPath: String,
    val exists: Boolean,
)
