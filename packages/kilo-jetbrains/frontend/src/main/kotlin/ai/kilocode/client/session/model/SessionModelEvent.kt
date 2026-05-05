package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.TodoDto

/**
 * Change events fired by [SessionModel].
 *
 * Events carry the data needed for rendering so UI can update without
 * reading back from the model except for [HistoryLoaded].
 *
 * **Message events** cover individual message and part mutations.
 * **Turn events** ([TurnAdded], [TurnUpdated], [TurnRemoved]) cover the
 * derivative turn-grouping structure that [SessionModel] maintains on top
 * of the flat message list. Turn events fire *after* the message event
 * that caused the regrouping, so by the time a turn event arrives the
 * message is already present in (or absent from) the model.
 */
sealed class SessionModelEvent {
    data class MessageAdded(val info: Message) : SessionModelEvent() {
        override fun toString() = "MessageAdded ${info.info.id}"
    }
    data class MessageUpdated(val info: Message) : SessionModelEvent() {
        override fun toString() = "MessageUpdated ${info.info.id}"
    }
    data class MessageRemoved(val id: String) : SessionModelEvent() {
        override fun toString() = "MessageRemoved $id"
    }
    data class ContentAdded(val messageId: String, val content: Content) : SessionModelEvent() {
        override fun toString() = "ContentAdded $messageId/${content.id}"
    }
    data class ContentUpdated(val messageId: String, val content: Content) : SessionModelEvent() {
        override fun toString() = "ContentUpdated $messageId/${content.id}"
    }
    data class ContentRemoved(val messageId: String, val contentId: String) : SessionModelEvent() {
        override fun toString() = "ContentRemoved $messageId/$contentId"
    }
    data class ContentDelta(val messageId: String, val contentId: String, val delta: String) : SessionModelEvent() {
        override fun toString() = "ContentDelta $messageId/$contentId"
    }
    data class StateChanged(val state: SessionState) : SessionModelEvent() {
        override fun toString() = "StateChanged ${state::class.simpleName}"
    }
    data class DiffUpdated(val diff: List<DiffFileDto>) : SessionModelEvent() {
        override fun toString() = "DiffUpdated files=${diff.size}"
    }
    data class TodosUpdated(val todos: List<TodoDto>) : SessionModelEvent() {
        override fun toString() = "TodosUpdated count=${todos.size}"
    }
    data class Compacted(val count: Int) : SessionModelEvent() {
        override fun toString() = "Compacted count=$count"
    }
    data object HistoryLoaded : SessionModelEvent()
    data object Cleared : SessionModelEvent()

    // ------ Turn grouping events ------

    /**
     * A new conversational turn was created. Fires after [MessageAdded]
     * when a user message starts a new turn, or when a leading assistant
     * message anchors a standalone turn.
     */
    data class TurnAdded(val turn: Turn) : SessionModelEvent() {
        override fun toString() = "TurnAdded ${turn.id} [${turn.messageIds.joinToString(", ")}]"
    }

    /**
     * An existing turn's message list changed (message added to or removed
     * from an existing turn). Fires after the message event that caused the
     * change. The [turn] carries the new, complete message-id list.
     */
    data class TurnUpdated(val turn: Turn) : SessionModelEvent() {
        override fun toString() = "TurnUpdated ${turn.id} [${turn.messageIds.joinToString(", ")}]"
    }

    /**
     * A turn was removed because all its messages are gone or because a
     * user-message anchor was removed and the remaining messages were
     * absorbed into an adjacent turn.
     */
    data class TurnRemoved(val id: String) : SessionModelEvent() {
        override fun toString() = "TurnRemoved $id"
    }

    fun interface Listener {
        fun onEvent(event: SessionModelEvent)
    }
}
