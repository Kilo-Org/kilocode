package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class TelemetryCaptureDto(
    val event: String,
    val properties: Map<String, String> = emptyMap(),
)
