package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.MessageDto

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
}

/** Tool invocation with lifecycle state. */
class Tool(id: String, val name: String) : Content(id) {
    var state: ToolExecState = ToolExecState.PENDING
    var title: String? = null
}

/** Context compaction marker. */
class Compaction(id: String) : Content(id)

/**
 * Generic fallback for part types not yet given a dedicated class.
 * Preserves the [type] string so unknown content is not silently dropped.
 */
class Generic(id: String, val type: String) : Content(id)

enum class ToolExecState { PENDING, RUNNING, COMPLETED, ERROR }

data class ToolCallRef(
    val messageId: String,
    val callId: String,
)
