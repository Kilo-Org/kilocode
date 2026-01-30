package ai.kilo.plugin.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// ==================== Health ====================

@Serializable
data class HealthResponse(
    val healthy: Boolean,
    val version: String
)

// ==================== Session ====================

@Serializable
data class Session(
    val id: String,
    val slug: String,
    val projectID: String,
    val directory: String,
    val title: String,
    val version: String,
    val time: SessionTime,
    val parentID: String? = null,
    val share: SessionShare? = null,
    val summary: SessionSummary? = null,
    val revert: SessionRevert? = null,
    val permission: List<PermissionRule>? = null
)

@Serializable
data class SessionTime(
    val created: Long,
    val updated: Long,
    val compacting: Long? = null,
    val archived: Long? = null
)

@Serializable
data class SessionShare(
    val url: String
)

@Serializable
data class SessionSummary(
    val additions: Int,
    val deletions: Int,
    val files: Int,
    val diffs: List<FileDiff>? = null
)

@Serializable
data class SessionRevert(
    val messageID: String,
    val partID: String? = null,
    val snapshot: String? = null,
    val diff: String? = null
)

/**
 * Session status - discriminated by "type" field.
 * Server sends: { type: "idle" } | { type: "busy" } | { type: "retry", attempt, message, next }
 */
@Serializable
data class SessionStatus(
    val type: String,  // "idle", "busy", "retry"
    val attempt: Int? = null,  // only for retry
    val message: String? = null,  // only for retry
    val next: Long? = null  // only for retry - timestamp for next attempt
)

// ==================== Session Requests ====================

@Serializable
data class CreateSessionRequest(
    val parentID: String? = null,
    val title: String? = null
)

@Serializable
data class UpdateSessionRequest(
    val title: String? = null,
    val time: UpdateSessionTime? = null
)

@Serializable
data class UpdateSessionTime(
    val archived: Long? = null
)

@Serializable
data class ForkSessionRequest(
    val messageID: String? = null
)

@Serializable
data class RevertMessageRequest(
    val messageID: String,
    val restoreFiles: Boolean? = null
)

// ==================== Project ====================

@Serializable
data class Project(
    val id: String,
    val name: String,
    val icon: String? = null,
    val path: ProjectPath
)

@Serializable
data class ProjectPath(
    val root: String,
    val cwd: String,
    val config: String? = null
)

// ==================== Message ====================

/**
 * Message - unified model for both user and assistant messages.
 * Discriminated by "role" field: "user" or "assistant"
 */
@Serializable
data class Message(
    val id: String,
    val sessionID: String,
    val role: String,  // "user" or "assistant"
    val time: MessageTime,
    // User message fields (required when role="user")
    val agent: String? = null,
    val model: ModelRef? = null,
    val system: String? = null,
    val variant: String? = null,
    val tools: Map<String, Boolean>? = null,
    // Assistant message fields (required when role="assistant")
    val parentID: String? = null,
    val modelID: String? = null,
    val providerID: String? = null,
    val mode: String? = null,  // deprecated
    val path: MessagePath? = null,
    val tokens: TokenUsage? = null,
    val cost: Double? = null,
    val finish: String? = null,
    val error: MessageError? = null,
    // Summary: structured object for user, boolean for assistant
    val summary: JsonObject? = null
) {
    val isUser: Boolean get() = role == "user"
    val isAssistant: Boolean get() = role == "assistant"
}

@Serializable
data class MessageTime(
    val created: Long,
    val completed: Long? = null  // only for assistant messages
)

@Serializable
data class MessagePath(
    val cwd: String,
    val root: String
)

@Serializable
data class MessageError(
    val name: String,  // "ProviderAuthError", "UnknownError", "MessageOutputLengthError", "MessageAbortedError", "APIError"
    val message: String? = null,
    val providerID: String? = null,  // for ProviderAuthError
    val statusCode: Int? = null,  // for APIError
    val isRetryable: Boolean? = null,  // for APIError
    val responseHeaders: Map<String, String>? = null,  // for APIError
    val responseBody: String? = null,  // for APIError
    val metadata: Map<String, String>? = null  // for APIError
)

@Serializable
data class MessageWithParts(
    val info: Message,
    val parts: List<Part>
)

// ==================== Model Reference ====================

@Serializable
data class ModelRef(
    val providerID: String,
    val modelID: String
)

// ==================== Token Usage ====================

@Serializable
data class TokenUsage(
    val input: Int = 0,
    val output: Int = 0,
    val reasoning: Int = 0,
    val cache: CacheUsage = CacheUsage()
)

@Serializable
data class CacheUsage(
    val read: Int = 0,
    val write: Int = 0
)

// ==================== Part ====================

/**
 * Message Part - unified model for all part types.
 * Discriminated by "type" field: text, file, tool, reasoning, step-start, step-finish,
 * subtask, agent, compaction, snapshot, patch, retry
 */
@Serializable
data class Part(
    val id: String,
    val sessionID: String,
    val messageID: String,
    val type: String,
    // Text part fields
    val text: String? = null,
    val synthetic: Boolean? = null,
    val ignored: Boolean? = null,
    // File part fields
    val url: String? = null,
    val filename: String? = null,
    val mime: String? = null,
    val source: JsonObject? = null,  // FilePartSource - complex union type
    // Tool part fields
    val tool: String? = null,
    val callID: String? = null,
    val state: JsonObject? = null,  // ToolState - complex union type
    val metadata: JsonObject? = null,
    // Reasoning part fields (text is shared)
    // Step parts fields
    val snapshot: String? = null,
    val reason: String? = null,  // step-finish
    val cost: Double? = null,  // step-finish
    val tokens: TokenUsage? = null,  // step-finish
    // Agent part fields
    val name: String? = null,
    // Subtask part fields
    val prompt: String? = null,
    val description: String? = null,
    val agent: String? = null,
    val model: ModelRef? = null,
    val command: String? = null,
    // Compaction part fields
    val auto: Boolean? = null,
    // Patch part fields
    val hash: String? = null,
    val files: List<String>? = null,
    // Retry part fields
    val attempt: Int? = null,
    val error: JsonObject? = null,
    val time: JsonObject? = null
) {
    val isTextPart: Boolean get() = type == "text"
    val isToolPart: Boolean get() = type == "tool"
    val isReasoningPart: Boolean get() = type == "reasoning"
    val isFilePart: Boolean get() = type == "file"
    val isStepStartPart: Boolean get() = type == "step-start"
    val isStepFinishPart: Boolean get() = type == "step-finish"
    val isAgentPart: Boolean get() = type == "agent"
    val isSubtaskPart: Boolean get() = type == "subtask"
    val isSnapshotPart: Boolean get() = type == "snapshot"
    val isPatchPart: Boolean get() = type == "patch"
    val isRetryPart: Boolean get() = type == "retry"
    val isCompactionPart: Boolean get() = type == "compaction"

    // Tool state helpers
    val toolStatus: String? get() = state?.get("status")?.toString()?.trim('"')
    val toolTitle: String? get() = state?.get("title")?.toString()?.trim('"')
    val toolOutput: String? get() = state?.get("output")?.toString()?.trim('"')
    val toolError: String? get() = state?.get("error")?.toString()?.trim('"')
}

// ==================== Send Message Request ====================

/**
 * Request to send a message/prompt to a session.
 * Minimal version - only parts required.
 */
@Serializable
data class SendMessageRequest(
    val parts: List<TextOnlyPromptPart>
)

/**
 * Request to send a message with optional parameters.
 */
@Serializable
data class SendMessageRequestFull(
    val parts: List<TextOnlyPromptPart>,
    val model: ModelRef? = null,
    val agent: String? = null,
    val variant: String? = null,
    val system: String? = null,
    val noReply: Boolean? = null
)

/**
 * Serializable text-only prompt part for simple text messages.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class TextOnlyPromptPart(
    @EncodeDefault
    val type: String = "text",
    val text: String
)

/**
 * Base interface for prompt parts.
 * We manually serialize these to avoid kotlinx.serialization sealed class discriminator conflicts.
 */
sealed interface PromptPart {
    fun toJson(): JsonElement
}

/**
 * Prompt part for sending messages - text type.
 */
data class TextPromptPart(
    val text: String
) : PromptPart {
    override fun toJson(): JsonElement = buildJsonObject {
        put("type", "text")
        put("text", text)
    }
}

/**
 * Prompt part for sending messages - file type.
 */
data class FilePromptPart(
    val url: String,
    val mime: String,
    val filename: String? = null
) : PromptPart {
    override fun toJson(): JsonElement = buildJsonObject {
        put("type", "file")
        put("url", url)
        put("mime", mime)
        filename?.let { put("filename", it) }
    }
}

/**
 * Build a mixed parts request body manually to avoid serialization issues.
 */
fun buildMixedPartsRequestJson(
    parts: List<PromptPart>,
    model: ModelRef? = null,
    agent: String? = null
): JsonObject = buildJsonObject {
    put("parts", JsonArray(parts.map { it.toJson() }))
    model?.let { m ->
        put("model", buildJsonObject {
            put("providerID", m.providerID)
            put("modelID", m.modelID)
        })
    }
    agent?.let { put("agent", it) }
}

// ==================== Agent ====================

@Serializable
data class Agent(
    val name: String,
    val mode: String,  // required: "subagent", "primary", "all"
    val description: String? = null,
    val native: Boolean? = null,
    val hidden: Boolean? = null,
    val topP: Double? = null,
    val temperature: Double? = null,
    val color: String? = null,
    val permission: List<PermissionRule>? = null,
    val model: ModelRef? = null,
    val prompt: String? = null,
    val options: JsonObject? = null,
    val steps: Int? = null
)

// ==================== Provider ====================

@Serializable
data class Provider(
    val id: String,
    val name: String,
    val source: String? = null,  // "env", "config", "custom", "api"
    val env: List<String>? = null,
    val key: String? = null,
    val options: JsonObject? = null,
    val models: Map<String, Model> = emptyMap()
)

@Serializable
data class Model(
    val id: String,
    val name: String? = null,
    val providerID: String? = null,
    val family: String? = null,
    val capabilities: ModelCapabilities? = null,
    val cost: ModelCost? = null,
    val limit: ModelLimit? = null,
    val status: String? = null,  // "alpha", "beta", "deprecated", "active"
    val options: JsonObject? = null,
    val headers: Map<String, String>? = null,
    val release_date: String? = null
)

@Serializable
data class ModelCapabilities(
    val temperature: Boolean? = null,
    val reasoning: Boolean? = null,
    val attachment: Boolean? = null,
    val toolcall: Boolean? = null,
    val input: ModelIO? = null,
    val output: ModelIO? = null,
    val interleaved: JsonElement? = null  // can be boolean or { field: string }
)

@Serializable
data class ModelIO(
    val text: Boolean? = null,
    val audio: Boolean? = null,
    val image: Boolean? = null,
    val video: Boolean? = null,
    val pdf: Boolean? = null
)

@Serializable
data class ModelCost(
    val input: Double? = null,
    val output: Double? = null,
    val cache: CostCache? = null
)

@Serializable
data class CostCache(
    val read: Double? = null,
    val write: Double? = null
)

@Serializable
data class ModelLimit(
    val context: Int? = null,
    val input: Int? = null,
    val output: Int? = null
)

@Serializable
data class ProviderListResponse(
    val all: List<Provider>,
    val default: Map<String, String> = emptyMap(),
    val connected: List<String> = emptyList()
)

// ==================== Command ====================

@Serializable
data class Command(
    val name: String,
    val description: String? = null,
    val agent: String? = null,
    val model: String? = null,
    val mcp: Boolean? = null,
    val subtask: Boolean? = null,
    val hints: List<String>? = null
)

// ==================== File Diff ====================

@Serializable
data class FileDiff(
    val file: String,  // was "path" - renamed to match server
    val before: String,
    val after: String,
    val additions: Int,
    val deletions: Int
)

// ==================== Todo ====================

@Serializable
data class Todo(
    val id: String,
    val content: String? = null,
    val status: String? = null,
    val priority: String? = null
)

// ==================== Permission ====================

@Serializable
data class PermissionRule(
    val permission: String,
    val pattern: String,
    val action: String  // "allow", "deny", "ask"
)

@Serializable
data class PermissionRequest(
    val id: String,
    val sessionID: String,
    val permission: String,
    val patterns: List<String>,
    val metadata: JsonObject,  // now required
    val always: List<String>,
    val tool: ToolReference? = null
)

@Serializable
data class PermissionReplyRequest(
    val reply: String,  // "once", "always", "reject"
    val message: String? = null
)

// ==================== Question ====================

@Serializable
data class QuestionInfo(
    val question: String,
    val header: String,
    val options: List<QuestionOption> = emptyList(),
    val multiple: Boolean? = null,
    val custom: Boolean? = null
)

@Serializable
data class QuestionRequest(
    val id: String,
    val sessionID: String,
    val questions: List<QuestionInfo>,  // was single "question" - now array
    val tool: ToolReference? = null
)

@Serializable
data class QuestionOption(
    val label: String,
    val description: String? = null
)

@Serializable
data class QuestionReplyRequest(
    val answers: List<List<String>>  // array of arrays - each question can have multiple answers
)

// ==================== Tool Reference ====================

/**
 * Reference to a tool call - used in permission and question requests
 */
@Serializable
data class ToolReference(
    val messageID: String,
    val callID: String
)

// ==================== VCS ====================

@Serializable
data class VcsInfo(
    val branch: String? = null
)

// ==================== Path ====================

@Serializable
data class PathInfo(
    val home: String,
    val state: String,
    val config: String,
    val worktree: String? = null,
    val directory: String
)
