package ai.kilocode.client.session.update

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.rpc.dto.SessionDto

/**
 * Lifecycle events fired by [SessionController] on the EDT.
 *
 * These cover app/workspace state changes and view switching — things
 * outside the [SessionModel] domain. For model mutations (messages,
 * parts, state), listen to [SessionModelEvent] on [SessionModel] directly.
 */
sealed class SessionControllerEvent {

    // App + workspace lifecycle (every state transition)
    data object AppChanged : SessionControllerEvent()
    data object WorkspaceChanged : SessionControllerEvent()

    // Workspace ready (pickers populated)
    data object WorkspaceReady : SessionControllerEvent()

    sealed class ViewChanged : SessionControllerEvent() {
        data object ShowProgress : ViewChanged() {
            override fun toString() = "ViewChanged progress"
        }

        data class ShowRecents(val recents: List<SessionDto>) : ViewChanged() {
            override fun toString() = "ViewChanged recents=${recents.size}"
        }

        data object ShowSession : ViewChanged() {
            override fun toString() = "ViewChanged session"
        }
    }

    sealed class ConnectionChanged : SessionControllerEvent() {
        data object Hide : ConnectionChanged() {
            override fun toString() = "ConnectionChanged hide"
        }

        data object ShowConnecting : ConnectionChanged() {
            override fun toString() = "ConnectionChanged connecting"
        }

        data class ShowError(val summary: String, val detail: String?, val source: String = "app") : ConnectionChanged() {
            override fun toString() = "ConnectionChanged error $source"
        }

        data class ShowWarning(val summary: String, val detail: String?) : ConnectionChanged() {
            override fun toString() = "ConnectionChanged warning"
        }
    }
}

/**
 * Listener for [SessionControllerEvent]s fired by [SessionController].
 * All callbacks are guaranteed to run on the EDT.
 */
fun interface SessionControllerListener {
    fun onEvent(event: SessionControllerEvent)
}
