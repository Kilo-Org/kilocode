package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class CloudSessionDto(
    val id: String,
    val title: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val version: Double,
)

@Serializable
data class CloudSessionListDto(
    val sessions: List<CloudSessionDto>,
    val nextCursor: String? = null,
)
