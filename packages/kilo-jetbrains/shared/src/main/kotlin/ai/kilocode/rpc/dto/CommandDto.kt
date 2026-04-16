package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class CommandDto(
    val name: String,
    val description: String? = null,
    val source: String? = null,
    val hints: List<String> = emptyList(),
)
