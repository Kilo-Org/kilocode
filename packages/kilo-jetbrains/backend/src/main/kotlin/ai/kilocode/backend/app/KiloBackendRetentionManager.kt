package ai.kilocode.backend.app

import ai.kilocode.jetbrains.api.model.KilocodeRetentionRun200Response
import ai.kilocode.jetbrains.api.model.KilocodeRetentionRunRequest
import ai.kilocode.jetbrains.api.model.KilocodeRetentionStatus200Response
import ai.kilocode.rpc.dto.RetentionPolicyDto
import ai.kilocode.rpc.dto.RetentionProgressDto
import ai.kilocode.rpc.dto.RetentionResultDto
import ai.kilocode.rpc.dto.RetentionStatusDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

class KiloBackendRetentionManager(private val app: KiloBackendAppService) {
    suspend fun status(): RetentionStatusDto {
        app.requireReady()
        val api = app.api ?: throw IllegalStateException("Kilo API client is unavailable")
        return withContext(Dispatchers.IO) { api.kilocodeRetentionStatus(null, null) }.dto()
    }

    suspend fun run(force: Boolean): RetentionStatusDto {
        app.requireReady()
        val api = app.api ?: throw IllegalStateException("Kilo API client is unavailable")
        return withContext(Dispatchers.IO) {
            api.kilocodeRetentionRun(null, null, KilocodeRetentionRunRequest(force))
        }.dto()
    }
}

private fun KilocodeRetentionStatus200Response.dto() = RetentionStatusDto(
    policy = RetentionPolicyDto(policy.enabled, policy.maxAgeDays.int(30)),
    last = last?.let { RetentionResultDto(
        at = it.at.long(), scanned = it.scanned.int(), deleted = it.deleted.int(),
        skippedActive = it.skippedActive.int(), failed = it.failed.int(), durationMs = it.durationMs.long(),
    ) },
    progress = progress?.let { RetentionProgressDto(
        phase = it.phase.value, total = it.total.toInt(), processed = it.processed.toInt(),
        deleted = it.deleted.toInt(), failed = it.failed.toInt(), skippedActive = it.skippedActive.toInt(),
    ) },
)

private fun KilocodeRetentionRun200Response.dto() = RetentionStatusDto(
    policy = RetentionPolicyDto(policy.enabled, policy.maxAgeDays.int(30)),
    last = last?.let { RetentionResultDto(
        at = it.at.long(), scanned = it.scanned.int(), deleted = it.deleted.int(),
        skippedActive = it.skippedActive.int(), failed = it.failed.int(), durationMs = it.durationMs.long(),
    ) },
    progress = progress?.let { RetentionProgressDto(
        phase = it.phase.value, total = it.total.toInt(), processed = it.processed.toInt(),
        deleted = it.deleted.toInt(), failed = it.failed.toInt(), skippedActive = it.skippedActive.toInt(),
    ) },
)

private fun JsonElement.long(fallback: Long = 0): Long = jsonPrimitive.longOrNull ?: fallback
private fun JsonElement.int(fallback: Int = 0): Int =
    jsonPrimitive.longOrNull?.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt() ?: fallback
