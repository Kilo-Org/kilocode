package ai.kilocode.client.session

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent

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
    data class ViewChanged(val show: Boolean) : SessionControllerEvent() {
        override fun toString() = if (show) "ViewChanged show" else "ViewChanged hide"
    }
}

/**
 * Listener for [SessionControllerEvent]s fired by [SessionController].
 * All callbacks are guaranteed to run on the EDT.
 */
fun interface SessionControllerListener {
    fun onEvent(event: SessionControllerEvent)
}
