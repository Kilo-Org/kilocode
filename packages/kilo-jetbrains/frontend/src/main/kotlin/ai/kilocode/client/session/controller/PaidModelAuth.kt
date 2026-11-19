package ai.kilocode.client.session.controller

import ai.kilocode.rpc.dto.MessageErrorDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private const val PAID_MODEL_AUTH_REQUIRED = "PAID_MODEL_AUTH_REQUIRED"
private val json = Json { ignoreUnknownKeys = true }

/**
 * Returns true when [error] signals that the user must sign in to use a paid model.
 *
 * Conditions (all must hold):
 * - error type is "APIError"
 * - statusCode is 401
 * - response body contains `error.code` or `code` equal to "PAID_MODEL_AUTH_REQUIRED"
 *
 * Malformed or missing response body returns false rather than throwing.
 */
internal fun isPaidModelAuthRequired(error: MessageErrorDto?): Boolean {
    if (error == null) return false
    if (error.type != "APIError") return false
    if (error.statusCode != 401) return false
    val body = error.responseBody ?: return false
    return runCatching {
        val obj = json.parseToJsonElement(body).jsonObject
        val nested = obj["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content
        val top = obj["code"]?.jsonPrimitive?.content
        nested == PAID_MODEL_AUTH_REQUIRED || top == PAID_MODEL_AUTH_REQUIRED
    }.getOrNull() == true
}
