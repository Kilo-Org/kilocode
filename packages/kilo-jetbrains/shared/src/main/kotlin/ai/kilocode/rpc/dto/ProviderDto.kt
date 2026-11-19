package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class ModelDto(
    val id: String,
    val name: String,
    val inputPrice: Double? = null,
    val outputPrice: Double? = null,
    val contextLength: Long? = null,
    val releaseDate: String? = null,
    val latest: Boolean? = null,
    val attachment: Boolean = false,
    val reasoning: Boolean = false,
    val temperature: Boolean = false,
    val toolCall: Boolean = false,
    val free: Boolean = false,
    val byok: Boolean = false,
    val status: String? = null,
    val recommendedIndex: Double? = null,
    val variants: List<String> = emptyList(),
    val limit: ModelLimitDto? = null,
    val cost: ModelCostDto? = null,
    val capabilities: ModelCapabilitiesDto? = null,
    val options: ModelOptionsDto? = null,
    val autoRouting: ModelAutoRoutingDto? = null,
    val terminalBench: ModelTerminalBenchDto? = null,
    val mayTrainOnYourPrompts: Boolean = false,
)

@Serializable
data class ModelLimitDto(
    val context: Long = 0,
    val input: Long? = null,
    val output: Long = 0,
)

@Serializable
data class ModelCostDto(
    val input: Double,
    val output: Double,
    val cache: ModelCacheCostDto? = null,
)

@Serializable
data class ModelCacheCostDto(
    val read: Double,
    val write: Double,
)

@Serializable
data class ModelCapabilitiesDto(
    val reasoning: Boolean = false,
    val input: ModelInputCapabilitiesDto? = null,
)

@Serializable
data class ModelInputCapabilitiesDto(
    val text: Boolean = false,
    val image: Boolean = false,
    val audio: Boolean = false,
    val video: Boolean = false,
    val pdf: Boolean = false,
)

@Serializable
data class ModelOptionsDto(
    val description: String? = null,
)

@Serializable
data class ModelAutoRoutingDto(
    val models: List<String> = emptyList(),
)

@Serializable
data class ModelTerminalBenchDto(
    val overallScore: Double,
    val avgAttemptCostUsd: Double,
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
