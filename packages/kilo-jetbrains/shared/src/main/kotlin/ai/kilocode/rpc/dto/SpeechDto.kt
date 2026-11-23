package ai.kilocode.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
data class SpeechModelDto(
    val id: String,
    val name: String,
)

@Serializable
data class SpeechRequestDto(
    val data: ByteArray,
    val model: String,
    val format: String = "wav",
    val prompt: String? = null,
)

@Serializable
data class SpeechResultDto(
    val text: String,
)
