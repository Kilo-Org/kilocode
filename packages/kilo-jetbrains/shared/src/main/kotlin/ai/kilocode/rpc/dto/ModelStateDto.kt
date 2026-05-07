package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class ModelSelectionDto(
    val providerID: String,
    val modelID: String,
)

@Serializable
data class ModelStateDto(
    val favorite: List<ModelSelectionDto> = emptyList(),
    val model: Map<String, ModelSelectionDto> = emptyMap(),
    val variant: Map<String, String> = emptyMap(),
    val recent: List<ModelSelectionDto> = emptyList(),
)

@Serializable
data class ModelFavoriteUpdateDto(
    val action: String,
    val providerID: String,
    val modelID: String,
)

@Serializable
data class ModelSelectionUpdateDto(
    val agent: String,
    val providerID: String,
    val modelID: String,
)

@Serializable
data class ModelVariantUpdateDto(
    val key: String,
    val value: String,
)
