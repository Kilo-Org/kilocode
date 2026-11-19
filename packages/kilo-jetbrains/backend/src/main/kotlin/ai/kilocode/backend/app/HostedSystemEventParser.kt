package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.HostedSystemEventDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/** Projects the provider's structured system feed onto the attached hosted identity. */
internal object HostedSystemEventParser {
    private val failureCode = Regex("[a-z][a-z0-9_]{0,63}")

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
        val attempt = preparation?.get("attempt") as? JsonObject
        val sandbox = props["sandbox"] as? JsonObject
        val steps = ((preparation?.get("steps") ?: cloud?.get("steps")) as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.filter { it.string("step") != null || it.string("key") != null }
            .orEmpty()
        val step = (preparation?.get("stepSnapshot") as? JsonObject)
            ?: steps.lastOrNull { it.string("status") in setOf("in_progress", "running") }
            ?: steps.lastOrNull { it.string("status") in setOf("completed", "failed") }
        val action = when (attempt?.string("status")) {
            "running" -> "attempt_started"
            "completed" -> "attempt_completed"
            "failed" -> "attempt_failed"
            else -> step?.string("status") ?: preparation?.string("action")
        }
        val errors = sequenceOf(preparation?.string("safeError"), attempt?.string("safeError"),
            step?.string("safeError")).filterNotNull().toList()
        val human = errors.firstOrNull { !it.matches(failureCode) }?.take(300)
        val label = step?.takeIf { it.string("status") == "failed" }?.let {
            it.string("label") ?: it.string("key")
        }
        return HostedSystemEventDto(
            sessionID = session,
            kind = kind,
            step = if (attempt != null) null else step?.string("step") ?: step?.string("key")
                ?: preparation?.string("step") ?: cloud?.string("step"),
            action = action,
            message = (step?.string("latestDetail") ?: preparation?.string("detail")
                ?: step?.string("message") ?: step?.string("label")
                ?: preparation?.string("message")?.takeIf { attempt == null }
                ?: cloud?.string("message"))?.takeUnless { cloud?.string("type") == "error" },
            cloudStatus = cloud?.string("type"),
            sandboxStatus = (sandbox?.string("state") ?: sandbox?.string("status"))
                ?.takeIf { kind == "cloud.sandbox.status" },
            sandboxDetail = sandbox?.string("detailCode")?.takeIf { kind == "cloud.sandbox.status" },
            observedAt = when (kind) {
                "preparing" -> preparation?.number("timestamp") ?: props.number("observedAt")
                "cloud.sandbox.status" -> sandbox?.number("observedAt") ?: props.number("observedAt")
                else -> props.number("observedAt")
            } ?: 0.0,
            attemptID = preparation?.string("attemptId") ?: attempt?.string("id"),
            revision = ((preparation?.get("revision") ?: step?.get("revision") ?: attempt?.get("revision"))
                as? JsonPrimitive)?.longOrNull?.takeIf { it >= 0 },
            failure = errors.firstOrNull { it.matches(failureCode) },
            detail = missingStepDetail(step, preparation) ?: human ?: label?.let { "$it failed" }?.take(300),
            triggerMessageID = (preparation?.string("triggerMessageId") ?: attempt?.string("triggerMessageId"))
                ?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,128}")) },
            stepID = preparation?.string("stepId") ?: step?.string("id"),
            stepKind = step?.string("kind") ?: preparation?.string("kind"),
            output = if (kind == "preparing") {
                val value = if (preparation?.string("action") == "step_output") preparation["output"] else step?.get("outputTail")
                (value as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            } else null,
            outputTruncated = kind == "preparing" &&
                (step?.get("outputTruncated") as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull == true,
        )
    }

    private fun missingStepDetail(step: JsonObject?, preparation: JsonObject?): String? {
        val failed = step?.takeIf { it.string("status") == "failed" }
            ?: preparation?.takeIf { it.string("action") == "step_failed" }
            ?: return null
        val label = failed.string("label") ?: failed.string("key")
        val output = (failed["outputTail"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
            ?.takeIf { it.isNotEmpty() }
        val code = (failed["exitCode"] as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull
        if (output == null && code == null) return null
        val header = label?.let { "$it failed" }
            ?: failed.string("safeError")?.takeUnless { it.matches(failureCode) }?.take(300)
            ?: "Preparation step failed"
        val detail = header + (code?.let { " (exit code $it)" } ?: "")
        return if (output == null) detail else "$detail\n$output"
    }

    private fun JsonObject.string(name: String): String? =
        (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun JsonObject.number(name: String): Double? =
        (this[name] as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()?.takeIf { it.isFinite() }
}
