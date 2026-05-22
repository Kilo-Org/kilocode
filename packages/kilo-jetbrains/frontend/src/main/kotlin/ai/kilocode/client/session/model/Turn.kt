package ai.kilocode.client.session.model

/**
 * A conversational turn: one user message (the "anchor") and the
 * consecutive assistant messages that follow it, up to the next user message.
 *
 * When no user message precedes the first assistant message(s) the turn uses
 * the first assistant message id as its own anchor.
 *
 * Maintained by [SessionModel]. Listeners receive [SessionModelEvent.TurnAdded],
 * [SessionModelEvent.TurnUpdated], and [SessionModelEvent.TurnRemoved] whenever
 * the grouping changes.
 */
class Turn(val id: String) {
    private val _ids = mutableListOf<String>()

    val messageIds: List<String> get() = _ids.toList()

    internal fun add(id: String) {
        _ids.add(id)
    }

    internal fun setAll(ids: List<String>) {
        _ids.clear()
        _ids.addAll(ids)
    }

    override fun toString() = "Turn#$id [${_ids.joinToString(", ")}]"

    override fun equals(other: Any?): Boolean {
        if (other !is Turn) return false
        return id == other.id && _ids == other._ids
    }

    override fun hashCode() = 31 * id.hashCode() + _ids.hashCode()
}
