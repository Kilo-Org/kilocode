package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class CommandFileDto(
    val name: String,
    val description: String? = null,
    val source: String? = null,
    val builtin: Boolean = false,
    val location: String,
    val editable: Boolean = false,
    val content: String? = null,
    val hints: List<String> = emptyList(),
)
