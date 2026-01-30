package ai.kilo.plugin.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Server-Sent Event wrapper
 */
@Serializable
data class ServerEvent(
    val type: String,
    val properties: JsonObject
)

/**
 * Global event wrapper (for /global/event endpoint)
 */
@Serializable
data class GlobalEvent(
    val directory: String,
    val payload: ServerEvent
)

/**
 * Event types enum for type-safe event handling
 */
object EventTypes {
    // Server events
    const val SERVER_CONNECTED = "server.connected"
    const val SERVER_HEARTBEAT = "server.heartbeat"
    const val SERVER_INSTANCE_DISPOSED = "server.instance.disposed"
    const val GLOBAL_DISPOSED = "global.disposed"

    // Session events
    const val SESSION_CREATED = "session.created"
    const val SESSION_UPDATED = "session.updated"
    const val SESSION_DELETED = "session.deleted"
    const val SESSION_DIFF = "session.diff"
    const val SESSION_ERROR = "session.error"
    const val SESSION_IDLE = "session.idle"
    const val SESSION_STATUS = "session.status"
    const val SESSION_COMPACTED = "session.compacted"

    // Message events
    const val MESSAGE_UPDATED = "message.updated"
    const val MESSAGE_REMOVED = "message.removed"
    const val MESSAGE_PART_UPDATED = "message.part.updated"
    const val MESSAGE_PART_REMOVED = "message.part.removed"

    // Permission events
    const val PERMISSION_ASKED = "permission.asked"
    const val PERMISSION_REPLIED = "permission.replied"

    // Question events
    const val QUESTION_ASKED = "question.asked"
    const val QUESTION_REPLIED = "question.replied"
    const val QUESTION_REJECTED = "question.rejected"

    // File events
    const val FILE_EDITED = "file.edited"
    const val FILE_UPDATED = "file.updated"

    // Project events
    const val PROJECT_UPDATED = "project.updated"

    // VCS events
    const val VCS_BRANCH_UPDATED = "vcs.branch.updated"

    // Todo events
    const val TODO_UPDATED = "todo.updated"
}

/**
 * Parsed event data classes
 */
@Serializable
data class SessionCreatedEvent(
    val session: Session
)

@Serializable
data class SessionUpdatedEvent(
    val session: Session
)

@Serializable
data class SessionDeletedEvent(
    val sessionID: String
)

@Serializable
data class SessionStatusEvent(
    val sessionID: String,
    val status: String,
    val retries: Int = 0
)

@Serializable
data class MessageUpdatedEvent(
    val message: Message
)

@Serializable
data class MessageRemovedEvent(
    val sessionID: String,
    val messageID: String
)

@Serializable
data class MessagePartUpdatedEvent(
    val sessionID: String,
    val messageID: String,
    val part: Part,
    val delta: String? = null // For streaming text updates
)

@Serializable
data class MessagePartRemovedEvent(
    val sessionID: String,
    val messageID: String,
    val partID: String
)

@Serializable
data class PermissionAskedEvent(
    val request: PermissionRequest
)

@Serializable
data class PermissionRepliedEvent(
    val requestID: String,
    val reply: String
)

@Serializable
data class QuestionAskedEvent(
    val request: QuestionRequest
)

@Serializable
data class QuestionRepliedEvent(
    val requestID: String,
    val answers: List<String>
)

@Serializable
data class TodoUpdatedEvent(
    val sessionID: String,
    val todos: List<Todo>
)

@Serializable
data class SessionDiffEvent(
    val sessionID: String,
    val diffs: List<FileDiff>
)
