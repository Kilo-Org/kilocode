package ai.kilocode.client.session.model

/** Single source of truth for what a session is doing right now. */
sealed class SessionState {
    data object Idle : SessionState()

    data class Busy(val text: String) : SessionState()

    data class AwaitingQuestion(val question: Question) : SessionState()

    data class AwaitingPermission(val permission: Permission) : SessionState()

    data class Retry(val message: String, val attempt: Int, val next: Long) : SessionState()

    data class Offline(val message: String, val requestId: String) : SessionState()

    data class Error(val message: String, val kind: String? = null) : SessionState()
}
