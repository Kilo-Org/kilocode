package ai.kilocode.backend.cli

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Size-only summary for a failure line: the response length and, for a JSON error object,
 * a short identifier `name`.
 */
internal fun bodySummary(body: String): String {
    val name = runCatching {
        val member = (Json.parseToJsonElement(body) as? JsonObject)?.get("name") as? JsonPrimitive
        member?.takeIf { it.isString }?.content
    }.getOrNull()?.takeIf(::identifier)
    return if (name != null) "$name chars=${body.length}" else "chars=${body.length}"
}

private fun identifier(value: String): Boolean =
    value.length in 1..64 &&
        value.first().isLetter() &&
        value.all { it.isLetterOrDigit() || it == '_' }
