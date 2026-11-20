package ai.kilocode.backend.app

import ai.kilocode.backend.cli.KiloProps
import ai.kilocode.backend.settings.plugin
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import ai.kilocode.rpc.dto.RetentionPolicyDto
import ai.kilocode.rpc.dto.RetentionProgressDto
import ai.kilocode.rpc.dto.RetentionResultDto
import ai.kilocode.rpc.dto.RetentionStatusDto
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

/** Machine-wide retention is server-owned: a client cannot tell whether another process owns a session. */
class KiloBackendRetentionManager(private val app: KiloBackendAppService) {
    internal fun endpoint(client: V2Client = app.client()): RetentionEndpoint {
        app.requireReady()
        return RetentionEndpoint(client, KiloProps.pin.retentionVersion)
    }

    suspend fun status() = endpoint().status()
    suspend fun run(force: Boolean) = endpoint().run(force)
}

internal class RetentionEndpoint(private val client: V2Client, private val verifiedVersion: String?) {
    suspend fun status(): RetentionStatusDto = try {
        val output = client.plugin("kilocode.retention", "status").jsonObject
        // The status shape alone makes no promise about deletion racing a newly active tree. A release
        // is eligible only after its server-side guard has been verified and its exact pin recorded.
        val verified = verifiedVersion != null && client.plugin("kilocode.handshake", "get").jsonObject.let {
            it.getValue("product").jsonPrimitive.content == "kilo" && it.getValue("version").jsonPrimitive.content == verifiedVersion
        }
        output.status(verified)
    } catch (e: V2HttpException) {
        val type = runCatching { Json.parseToJsonElement(e.body).jsonObject["type"]?.jsonPrimitive?.content }.getOrNull()
        if (e.status != 400 || type !in setOf("rpc.unavailable", "rpc.method_not_found")) throw e
        RetentionStatusDto(supported = false)
    }

    suspend fun run(force: Boolean): RetentionStatusDto {
        val status = status()
        check(status.supported) { "The server does not support safe machine-wide session retention" }
        if (!status.policy.enabled) return status
        return client.plugin("kilocode.retention", "run", input = buildJsonObject { put("force", force) }).jsonObject.status(true)
    }
}

private fun JsonObject.status(verified: Boolean): RetentionStatusDto {
    val policy = getValue("policy").jsonObject
    val enabled = policy.getValue("enabled").jsonPrimitive
    require(!enabled.isString)
    val days = policy.getValue("maxAgeDays").jsonPrimitive.int.also { require(it >= 1) }
    return RetentionStatusDto(
        policy = RetentionPolicyDto(enabled.boolean, days),
        last = get("last")?.jsonObject?.let {
            RetentionResultDto(it.getValue("at").jsonPrimitive.long, it.count("scanned"), it.count("deleted"),
                it.count("skippedActive"), it.count("failed"), it.getValue("durationMs").jsonPrimitive.long)
        },
        progress = get("progress")?.jsonObject?.let {
            RetentionProgressDto(it.getValue("phase").jsonPrimitive.content, it.count("total"), it.count("processed"),
                it.count("deleted"), it.count("failed"), it.count("skippedActive"))
        },
        supported = verified,
    )
}

private fun JsonObject.count(key: String) = getValue(key).jsonPrimitive.int.also { require(it >= 0) }
