package ai.kilocode.client.session.model

enum class Outcome { INTERRUPTED, FAILED }

object TurnOutcome {
    /**
     * Maps a `session.turn.close` reason to the outcome the transcript should show. `completed` and
     * `superseded` are normal endings and return null so the session simply falls back to idle.
     */
    fun classify(reason: String): Outcome? = when (reason) {
        "interrupted" -> Outcome.INTERRUPTED
        "error" -> Outcome.FAILED
        else -> null
    }
}
