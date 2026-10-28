package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.HostedSystemEventDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** Projects the provider's structured system feed onto the attached hosted identity. */
internal object HostedSystemEventParser {
    fun parse(session: String, native: String, type: String?, data: String): HostedSystemEventDto? {
        val obj = runCatching { Json.parseToJsonElement(data) as? JsonObject }.getOrNull() ?: return null
        val payload = if ("payload" in obj) obj["payload"] as? JsonObject ?: return null else obj
        val props = payload["properties"] as? JsonObject ?: return null
        val kind = payload.string("type") ?: type ?: return null
        if (kind !in setOf("preparing", "cloud.status", "cloud.sandbox.status")) return null
        val id = props["sessionID"]
        if (id != null && id != JsonNull && props.string("sessionID") != native) return null
        val cloud = props["cloudStatus"] as? JsonObject
        val preparation = props["preparation"] as? JsonObject
        val sandbox = props["sandbox"] as? JsonObject
        val steps = ((preparation?.get("steps") ?: cloud?.get("steps")) as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.filter { it.string("step") != null || it.string("key") != null }
            .orEmpty()
        val step = (preparation?.get("stepSnapshot") as? JsonObject)
            ?: steps.lastOrNull { it.string("status") in setOf("in_progress", "running") }
            ?: steps.lastOrNull { it.string("status") in setOf("completed", "failed") }
        return HostedSystemEventDto(
            sessionID = session,
            kind = kind,
            step = step?.string("step") ?: step?.string("key") ?: preparation?.string("step") ?: cloud?.string("step"),
            action = step?.string("status") ?: preparation?.string("action"),
            message = step?.string("message") ?: step?.string("latestDetail") ?: step?.string("safeError")
                ?: preparation?.string("message") ?: cloud?.string("message"),
            cloudStatus = cloud?.string("type"),
            sandboxStatus = sandbox?.string("state") ?: sandbox?.string("status"),
            sandboxDetail = sandbox?.string("detailCode"),
            observedAt = sandbox?.number("observedAt") ?: props.number("observedAt") ?: 0.0,
        )
    }

    private fun JsonObject.string(name: String): String? =
        (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun JsonObject.number(name: String): Double? =
        (this[name] as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()?.takeIf { it.isFinite() }
}
