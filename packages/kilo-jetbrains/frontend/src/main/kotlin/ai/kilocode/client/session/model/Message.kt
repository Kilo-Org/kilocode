package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.PartTimeDto
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TokensDto

data class SessionHeaderSnapshot(
    val visible: Boolean,
    val title: String,
    val cost: Double?,
    val context: ContextUsage?,
    val tokens: TokensDto?,
    val timeline: List<TimelineItem>,
    val todos: TodoSummary,
    val canCompact: Boolean,
)

data class ContextUsage(
    val tokens: Long,
    val percentage: Int?,
    val limit: Long?,
    val output: Long?,
)

data class TimelineItem(
    val id: String,
    val part: Content,
    val title: String,
    val weight: Int,
    val durationMs: Long?,
    val active: Boolean,
)

data class TodoSummary(
    val total: Int,
    val completed: Int,
    val items: List<TodoDto>,
)

data class ModelLimitItem(
    val context: Long = 0,
    val input: Long? = null,
    val output: Long = 0,
)

/** A single message with its typed contents. */
class Message(
    val info: MessageDto,
) {
    val parts = LinkedHashMap<String, Content>()
}

/** Typed content within a message. */
sealed class Content(val id: String)

/** Streamed text content from the assistant. */
class Text(id: String) : Content(id) {
    val content = StringBuilder()
}

/** Model reasoning / chain-of-thought. */
class Reasoning(id: String) : Content(id) {
    val content = StringBuilder()
    var done: Boolean = true
}

/** Tool invocation with lifecycle state. */
class Tool(id: String, val name: String, var kind: ToolKind) : Content(id) {
    var state: ToolExecState = ToolExecState.PENDING
    var title: String? = null
    var input: Map<String, String> = emptyMap()
    var metadata: Map<String, String> = emptyMap()
    var output: String? = null
    var error: String? = null
    var time: PartTimeDto? = null
}

/** Context compaction marker. */
class Compaction(id: String) : Content(id)

/** Assistant step completion marker used by the session header timeline. */
class StepFinish(id: String) : Content(id) {
    var reason: String? = null
    var cost: Double? = null
    var tokens: TokensDto? = null
}

/**
 * Generic fallback for part types not yet given a dedicated class.
 * Preserves the [type] string so unknown content is not silently dropped.
 */
class Generic(id: String, val type: String) : Content(id)

enum class ToolExecState { PENDING, RUNNING, COMPLETED, ERROR }

enum class ToolKind { READ, WRITE, GENERIC }

private val READ_TOOLS = setOf("read", "glob", "grep", "find", "ls", "diagnostics", "warpgrep")
private val WRITE_TOOLS = setOf("edit", "write", "patch", "multi_edit", "multiedit", "apply_patch")

fun toolKind(name: String?): ToolKind = when (name?.lowercase()) {
    in READ_TOOLS -> ToolKind.READ
    in WRITE_TOOLS -> ToolKind.WRITE
    else -> ToolKind.GENERIC
}

data class ToolCallRef(
    val messageId: String,
    val callId: String,
)
