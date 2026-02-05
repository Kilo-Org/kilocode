package ai.kilo.plugin.store

import ai.kilo.plugin.model.*

/**
 * Sealed class hierarchy for fine-grained UI events.
 * These events enable incremental UI updates without full rebuilds.
 *
 * Each event carries the index where the change occurred, enabling
 * UI components to update specific positions without re-rendering entire lists.
 */
sealed class StoreEvent {

    // ==================== Message Events ====================

    /**
     * A new message was inserted into the session's message list.
     */
    data class MessageInserted(
        val sessionId: String,
        val message: Message,
        val index: Int
    ) : StoreEvent()

    /**
     * An existing message was updated (metadata, completion status, etc.).
     */
    data class MessageUpdated(
        val sessionId: String,
        val message: Message,
        val index: Int
    ) : StoreEvent()

    /**
     * A message was removed from the session.
     */
    data class MessageRemoved(
        val sessionId: String,
        val messageId: String,
        val index: Int
    ) : StoreEvent()

    // ==================== Part Events ====================

    /**
     * A new part was inserted into a message's part list.
     */
    data class PartInserted(
        val sessionId: String,
        val messageId: String,
        val part: Part,
        val index: Int
    ) : StoreEvent()

    /**
     * An existing part was updated (text content, tool state, etc.).
     */
    data class PartUpdated(
        val sessionId: String,
        val messageId: String,
        val part: Part,
        val index: Int,
        val delta: String? = null
    ) : StoreEvent()

    /**
     * A part was removed from a message.
     */
    data class PartRemoved(
        val sessionId: String,
        val messageId: String,
        val partId: String,
        val index: Int
    ) : StoreEvent()

    // ==================== Permission Events ====================

    /**
     * A new permission request was inserted.
     */
    data class PermissionInserted(
        val sessionId: String,
        val request: PermissionRequest,
        val index: Int
    ) : StoreEvent()

    /**
     * A permission request was removed (after being replied to).
     */
    data class PermissionRemoved(
        val sessionId: String,
        val requestId: String,
        val index: Int
    ) : StoreEvent()

    // ==================== Question Events ====================

    /**
     * A new question request was inserted.
     */
    data class QuestionInserted(
        val sessionId: String,
        val request: QuestionRequest,
        val index: Int
    ) : StoreEvent()

    /**
     * A question request was removed (after being replied to or rejected).
     */
    data class QuestionRemoved(
        val sessionId: String,
        val requestId: String,
        val index: Int
    ) : StoreEvent()

    // ==================== Session Events ====================

    /**
     * A new session was created.
     */
    data class SessionCreated(
        val session: Session,
        val index: Int
    ) : StoreEvent()

    /**
     * A session's metadata was updated.
     */
    data class SessionUpdated(
        val session: Session,
        val index: Int
    ) : StoreEvent()

    /**
     * A session was deleted.
     */
    data class SessionDeleted(
        val sessionId: String,
        val index: Int
    ) : StoreEvent()

    /**
     * A session's status changed (idle, busy, retry).
     */
    data class SessionStatusChanged(
        val sessionId: String,
        val status: SessionStatus
    ) : StoreEvent()

    /**
     * Session diffs were updated.
     */
    data class SessionDiffUpdated(
        val sessionId: String,
        val diffs: List<FileDiff>
    ) : StoreEvent()

    // ==================== Todo Events ====================

    /**
     * Todos for a session were updated.
     */
    data class TodosUpdated(
        val sessionId: String,
        val todos: List<Todo>
    ) : StoreEvent()

    // ==================== VCS Events ====================

    /**
     * VCS branch was updated.
     */
    data class VcsBranchUpdated(
        val branch: String
    ) : StoreEvent()

    // ==================== Bulk Events ====================

    /**
     * Bulk load of messages for a session (initial load).
     * Use this when loading a session for the first time.
     */
    data class MessagesLoaded(
        val sessionId: String,
        val messages: List<Message>
    ) : StoreEvent()

    /**
     * Bulk load of parts for a message (initial load).
     */
    data class PartsLoaded(
        val sessionId: String,
        val messageId: String,
        val parts: List<Part>
    ) : StoreEvent()

    /**
     * Sessions list was loaded/refreshed.
     */
    data class SessionsLoaded(
        val sessions: List<Session>
    ) : StoreEvent()
}
