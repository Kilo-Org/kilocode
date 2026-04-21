package ai.kilocode.client.session.model

/**
 * Change events fired by [SessionModel] on the EDT.
 *
 * Events carry IDs so the UI knows **which** message/part changed.
 * The UI can read full data from [SessionState] directly (safe — same
 * EDT thread). [PartDelta] also carries the delta string so the
 * view can append efficiently without reading the whole text.
 */
sealed class SessionEvent {

    // Message lifecycle
    data class MessageAdded(val id: String) : SessionEvent()
    data class MessageRemoved(val id: String) : SessionEvent()

    // Part changes
    data class PartUpdated(val messageId: String, val partId: String) : SessionEvent()
    data class PartDelta(val messageId: String, val partId: String, val delta: String) : SessionEvent()

    // Session state
    data class StatusChanged(val text: String?) : SessionEvent()
    data class BusyChanged(val busy: Boolean) : SessionEvent()
    data class Error(val message: String) : SessionEvent()

    // Bulk operations
    data object HistoryLoaded : SessionEvent()
    data object Cleared : SessionEvent()

    // App + workspace lifecycle (every state transition)
    data object AppChanged : SessionEvent()
    data object WorkspaceChanged : SessionEvent()

    // Workspace ready (pickers populated)
    data object WorkspaceReady : SessionEvent()
    data class ViewChanged(val show: Boolean) : SessionEvent()
}

/**
 * Listener for [SessionEvent]s fired by [SessionModel].
 * All callbacks are guaranteed to run on the EDT.
 */
fun interface SessionModelListener {
    fun onEvent(event: SessionEvent)
}
