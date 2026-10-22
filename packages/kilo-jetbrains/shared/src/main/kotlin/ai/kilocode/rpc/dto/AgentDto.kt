package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class AgentDto(
    val name: String,
    val displayName: String? = null,
    val description: String? = null,
    val mode: String,
    val native: Boolean? = null,
    val hidden: Boolean? = null,
    val color: String? = null,
    val deprecated: Boolean? = null,
)

@Serializable
data class AgentsDto(
    val agents: List<AgentDto>,
    val all: List<AgentDto>,
    val default: String,
)
