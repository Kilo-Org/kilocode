package ai.kilocode.backend.app

import ai.kilocode.rpc.dto.RetentionPolicyDto
import ai.kilocode.rpc.dto.RetentionStatusDto

/** Machine-wide retention is server-owned: a client cannot tell whether another process owns a session. */
class KiloBackendRetentionManager(private val app: KiloBackendAppService) {
    fun status(): RetentionStatusDto {
        val config = app.appState.value.config?.retention
        return RetentionStatusDto(
            policy = RetentionPolicyDto(config?.enabled == true, config?.maxAgeDays ?: 30),
            supported = false,
        )
    }

    fun run(@Suppress("UNUSED_PARAMETER") force: Boolean): RetentionStatusDto =
        throw UnsupportedOperationException("The connected Kilo server does not support machine-wide session retention")
}
