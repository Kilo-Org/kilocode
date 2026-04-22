package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class ModelDto(
    val id: String,
    val name: String,
    val attachment: Boolean = false,
    val reasoning: Boolean = false,
    val temperature: Boolean = false,
    val toolCall: Boolean = false,
    val free: Boolean = false,
    val status: String? = null,
)

@Serializable
data class ProviderDto(
    val id: String,
    val name: String,
    val source: String? = null,
    val models: Map<String, ModelDto> = emptyMap(),
)

@Serializable
data class ProvidersDto(
    val providers: List<ProviderDto>,
    val connected: List<String>,
    val defaults: Map<String, String>,
)
