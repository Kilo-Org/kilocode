package ai.kilocode.rpc.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// --- Messages ---

@Serializable
data class MessageDto(
    val id: String,
    val sessionID: String,
    val role: String,
    val time: MessageTimeDto,
    val agent: String? = null,
    val providerID: String? = null,
    val modelID: String? = null,
    val parentID: String? = null,
    val cost: Double? = null,
    val tokens: TokensDto? = null,
    val error: MessageErrorDto? = null,
)

@Serializable
data class MessageTimeDto(
    val created: Double,
    val completed: Double? = null,
)

@Serializable
data class TokensDto(
    val input: Long,
    val output: Long,
    val reasoning: Long,
    val cacheRead: Long,
    val cacheWrite: Long,
)

@Serializable
data class MessageErrorDto(
    val type: String,
    val message: String? = null,
)

@Serializable
data class MessageWithPartsDto(
    val info: MessageDto,
    val parts: List<PartDto>,
)

// --- Parts (simplified for basic chat) ---

@Serializable
data class PartDto(
    val id: String,
    val sessionID: String,
    val messageID: String,
    val type: String,
    val text: String? = null,
    val tool: String? = null,
    val state: String? = null,
    val title: String? = null,
)

// --- Prompt Input ---

@Serializable
data class PromptDto(
    val parts: List<PromptPartDto>,
    val providerID: String? = null,
    val modelID: String? = null,
    val agent: String? = null,
)

@Serializable
data class PromptPartDto(
    val type: String,
    val text: String,
)

// --- Streaming Events ---

@Serializable
sealed class ChatEventDto {

    @Serializable
    @SerialName("message.updated")
    data class MessageUpdated(
        val sessionID: String,
        val info: MessageDto,
    ) : ChatEventDto()

    @Serializable
    @SerialName("part.updated")
    data class PartUpdated(
        val sessionID: String,
        val part: PartDto,
    ) : ChatEventDto()

    @Serializable
    @SerialName("part.delta")
    data class PartDelta(
        val sessionID: String,
        val messageID: String,
        val partID: String,
        val field: String,
        val delta: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("turn.open")
    data class TurnOpen(
        val sessionID: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("turn.close")
    data class TurnClose(
        val sessionID: String,
        val reason: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("error")
    data class Error(
        val sessionID: String?,
        val error: MessageErrorDto? = null,
    ) : ChatEventDto()

    @Serializable
    @SerialName("message.removed")
    data class MessageRemoved(
        val sessionID: String,
        val messageID: String,
    ) : ChatEventDto()
}

// --- Config Update ---

@Serializable
data class ConfigUpdateDto(
    val model: String? = null,
    val agent: String? = null,
    val temperature: Double? = null,
)
