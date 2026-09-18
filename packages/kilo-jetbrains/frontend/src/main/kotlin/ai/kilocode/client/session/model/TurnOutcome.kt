package ai.kilocode.client.session.model

enum class Outcome { INTERRUPTED, FAILED, INCOMPLETE }

object TurnOutcome {
    /**
     * Finish reasons that mean the provider ended the response without signalling completion.
     *
     * "length" is excluded: the CLI already writes a visible warning text part for it, so an outcome
     * card would repeat the same message.
     */
    private val bad = setOf("unknown", "other")

    fun incomplete(finish: String?): Outcome? = if (finish in bad) Outcome.INCOMPLETE else null

    /**
     * Maps a `session.turn.close` reason plus assistant finish reason to the outcome the transcript
     * should show. `superseded` is a normal handoff and returns null so the follow-up turn decides.
     */
    fun classify(reason: String, finish: String? = null): Outcome? = when (reason) {
        "interrupted" -> Outcome.INTERRUPTED
        "error" -> Outcome.FAILED
        "completed" -> incomplete(finish)
        else -> null
    }
}
