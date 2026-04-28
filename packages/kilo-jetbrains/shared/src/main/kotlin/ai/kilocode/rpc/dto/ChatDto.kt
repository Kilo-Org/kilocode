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

// --- Parts ---

@Serializable
data class PartDto(
    val id: String,
    val sessionID: String,
    val messageID: String,
    val type: String,
    val text: String? = null,
    val tool: String? = null,
    val callID: String? = null,
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
    @SerialName("message.part.updated")
    data class PartUpdated(
        val sessionID: String,
        val part: PartDto,
    ) : ChatEventDto()

    @Serializable
    @SerialName("message.part.delta")
    data class PartDelta(
        val sessionID: String,
        val messageID: String,
        val partID: String,
        val field: String,
        val delta: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("message.part.removed")
    data class PartRemoved(
        val sessionID: String,
        val messageID: String,
        val partID: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("session.turn.open")
    data class TurnOpen(
        val sessionID: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("session.turn.close")
    data class TurnClose(
        val sessionID: String,
        val reason: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("session.error")
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

    @Serializable
    @SerialName("permission.asked")
    data class PermissionAsked(
        val sessionID: String,
        val request: PermissionRequestDto,
    ) : ChatEventDto()

    @Serializable
    @SerialName("permission.replied")
    data class PermissionReplied(
        val sessionID: String,
        val requestID: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("question.asked")
    data class QuestionAsked(
        val sessionID: String,
        val request: QuestionRequestDto,
    ) : ChatEventDto()

    @Serializable
    @SerialName("question.replied")
    data class QuestionReplied(
        val sessionID: String,
        val requestID: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("question.rejected")
    data class QuestionRejected(
        val sessionID: String,
        val requestID: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("session.status")
    data class SessionStatusChanged(
        val sessionID: String,
        val status: SessionStatusDto,
    ) : ChatEventDto()

    @Serializable
    @SerialName("session.idle")
    data class SessionIdle(
        val sessionID: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("session.compacted")
    data class SessionCompacted(
        val sessionID: String,
    ) : ChatEventDto()

    @Serializable
    @SerialName("session.diff")
    data class SessionDiffChanged(
        val sessionID: String,
        val diff: List<DiffFileDto> = emptyList(),
    ) : ChatEventDto()

    @Serializable
    @SerialName("todo.updated")
    data class TodoUpdated(
        val sessionID: String,
        val todos: List<TodoDto> = emptyList(),
    ) : ChatEventDto()
}

// --- Permission DTOs ---

@Serializable
data class PermissionRequestDto(
    val id: String,
    val sessionID: String,
    val permission: String,
    val patterns: List<String>,
    val metadata: Map<String, String> = emptyMap(),
    val always: List<String> = emptyList(),
    val tool: ToolRefDto? = null,
)

@Serializable
data class ToolRefDto(
    val messageID: String,
    val callID: String,
)

@Serializable
data class PermissionReplyDto(
    val reply: String,
    val message: String? = null,
)

@Serializable
data class PermissionAlwaysRulesDto(
    val approvedAlways: List<String> = emptyList(),
    val deniedAlways: List<String> = emptyList(),
)

// --- Question DTOs ---

@Serializable
data class QuestionRequestDto(
    val id: String,
    val sessionID: String,
    val questions: List<QuestionInfoDto>,
    val tool: ToolRefDto? = null,
)

@Serializable
data class QuestionInfoDto(
    val question: String,
    val header: String,
    val options: List<QuestionOptionDto> = emptyList(),
    val multiple: Boolean = false,
    val custom: Boolean = true,
)

@Serializable
data class QuestionOptionDto(
    val label: String,
    val description: String,
)

@Serializable
data class QuestionReplyDto(
    val answers: List<List<String>>,
)

// --- Todo DTO ---

@Serializable
data class TodoDto(
    val content: String,
    val status: String,
    val priority: String,
)

// --- Diff DTO ---

@Serializable
data class DiffFileDto(
    val file: String,
    val additions: Int,
    val deletions: Int,
    val patch: String? = null,
)

// --- Config Update ---

@Serializable
data class ConfigUpdateDto(
    val model: String? = null,
    val agent: String? = null,
    val temperature: Double? = null,
)
