package ai.kilocode.backend.cli

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A failed CLI response with a short user-facing message and a size-only log summary. */
internal class ResponseFailure(override val message: String, val summary: String) : IllegalStateException(message)

/**
 * Failure for a non-2xx CLI response. [message] stays short enough to show to the user — status,
 * the HTTP reason phrase and the decoded error name — while [summary] carries the response size
 * for the log.
 */
internal fun responseFailure(status: Int, statusText: String?, body: String): ResponseFailure {
    val message = listOfNotNull("HTTP $status", statusText?.takeIf { it.isNotBlank() }, bodyName(body))
    return ResponseFailure(message.joinToString(" "), "HTTP $status: ${bodySummary(body)}")
}

/**
 * Size-only summary for a failure line: the response length and, for a JSON error object,
 * a short identifier `name`.
 */
internal fun bodySummary(body: String): String {
    val name = bodyName(body) ?: return "chars=${body.length}"
    return "$name chars=${body.length}"
}

/** The short identifier `name` of a JSON error object, or null when the body carries none. */
internal fun bodyName(body: String): String? = runCatching {
    val member = (Json.parseToJsonElement(body) as? JsonObject)?.get("name") as? JsonPrimitive
    member?.takeIf { it.isString }?.content
}.getOrNull()?.takeIf(::identifier)

private fun identifier(value: String): Boolean =
    value.length in 1..64 &&
        value.first().isLetter() &&
        value.all { it.isLetterOrDigit() || it == '_' }
