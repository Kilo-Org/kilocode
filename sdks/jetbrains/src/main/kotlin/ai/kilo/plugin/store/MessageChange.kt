package ai.kilo.plugin.store

import ai.kilo.plugin.model.MessageWithParts
import ai.kilo.plugin.model.Part

/**
 * Unified stream of message changes for UI rendering.
 * ChatUiRenderer subscribes to this single stream for all message-related updates.
 */
sealed class MessageChange {
    abstract val sessionId: String

    /** Initial bulk load of messages for a session */
    data class InitialLoad(
        override val sessionId: String,
        val messages: List<MessageWithParts>
    ) : MessageChange()

    /** A new message was added */
    data class MessageAdded(
        override val sessionId: String,
        val message: MessageWithParts
    ) : MessageChange()

    /** A message was removed */
    data class MessageRemoved(
        override val sessionId: String,
        val messageId: String
    ) : MessageChange()

    /** A part was added to a message */
    data class PartAdded(
        override val sessionId: String,
        val messageId: String,
        val part: Part
    ) : MessageChange()

    /** A part was updated (with optional delta for streaming text) */
    data class PartUpdated(
        override val sessionId: String,
        val messageId: String,
        val part: Part,
        val delta: String?
    ) : MessageChange()

    /** A part was removed from a message */
    data class PartRemoved(
        override val sessionId: String,
        val messageId: String,
        val partId: String
    ) : MessageChange()
}
