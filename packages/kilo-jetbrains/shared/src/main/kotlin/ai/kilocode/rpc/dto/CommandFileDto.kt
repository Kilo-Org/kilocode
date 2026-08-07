package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class CommandFileDto(
    val name: String,
    val description: String? = null,
    val agent: String? = null,
    val model: String? = null,
    val variant: String? = null,
    val source: String? = null,
    val builtin: Boolean = false,
    val location: String,
    val editable: Boolean = false,
    val content: String? = null,
    val subtask: Boolean? = null,
    val hints: List<String> = emptyList(),
)
