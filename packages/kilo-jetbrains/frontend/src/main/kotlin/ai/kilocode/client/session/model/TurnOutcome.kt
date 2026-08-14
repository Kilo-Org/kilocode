package ai.kilocode.client.session.model

enum class Outcome { INTERRUPTED, FAILED }

enum class OutcomeTone { WARNING, CRITICAL }

object TurnOutcome {
    fun classify(reason: String): Pair<Outcome, OutcomeTone>? = when (reason) {
        "interrupted" -> Outcome.INTERRUPTED to OutcomeTone.WARNING
        "error" -> Outcome.FAILED to OutcomeTone.CRITICAL
        else -> null
    }
}
