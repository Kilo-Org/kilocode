package ai.kilocode.client.session.model

enum class Outcome { INTERRUPTED, FAILED }

enum class OutcomeTone { WARNING, CRITICAL }

object TurnOutcome {
    fun classify(reason: String, provider: Boolean): Pair<Outcome, OutcomeTone>? = when {
        provider -> null
        reason == "interrupted" -> Outcome.INTERRUPTED to OutcomeTone.WARNING
        reason == "error" -> Outcome.FAILED to OutcomeTone.CRITICAL
        else -> null
    }
}
