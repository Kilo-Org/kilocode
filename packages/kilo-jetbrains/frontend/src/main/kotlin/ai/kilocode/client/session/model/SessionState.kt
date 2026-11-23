package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.MessageDto

/** Single source of truth for what a session is doing right now. */
sealed class SessionState {
    data object Idle : SessionState()

    data object Loading : SessionState()

    data class Busy(val text: String) : SessionState()

    data class Reverting(val text: String, val kind: Kind, val message: String? = null) : SessionState() {
        enum class Kind { ROLLBACK, REDO }
    }

    data class AwaitingQuestion(val question: Question) : SessionState()

    data class AwaitingPermission(val permission: Permission) : SessionState()

    data class Retry(val message: String, val attempt: Int, val next: Long) : SessionState()

    data class Offline(val message: String, val requestId: String) : SessionState()

    data class Error(
        val message: String,
        val kind: String? = null,
        val retryable: Boolean = false,
        val dismissible: Boolean = true,
    ) : SessionState()

    data class TurnEnded(val outcome: Outcome, val finish: String? = null) : SessionState()

    data class LoginRequired(val message: String) : SessionState()

    fun isBusy(): Boolean = when (this) {
        is Idle, is Loading, is Error, is TurnEnded, is LoginRequired -> false
        else -> true
    }

    /** Preparation can explain stale native progress, but cannot replace a newer turn or user input. */
    fun showsPreparation(failure: HostedSystemEventDto, latest: MessageDto?): Boolean = when (this) {
        is AwaitingQuestion, is AwaitingPermission, is LoginRequired, is Reverting -> false
        else -> when {
            latest == null -> true
            failure.triggerMessageID != null -> latest.id == failure.triggerMessageID
            failure.observedAt <= 0 -> true
            else -> latest.time.created <= failure.observedAt
        }
    }
}
