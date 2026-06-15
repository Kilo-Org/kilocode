package ai.kilocode.client.testing

import ai.kilocode.rpc.KiloMigrationRpcApi
import ai.kilocode.rpc.dto.LegacyCleanupReportDto
import ai.kilocode.rpc.dto.LegacyCleanupTargetsDto
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.LegacyMigrationEventDto
import ai.kilocode.rpc.dto.LegacyMigrationSelectionsDto
import ai.kilocode.rpc.dto.LegacyMigrationStatusDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * Fake [KiloMigrationRpcApi] for testing.
 *
 * Supply [statusResult] and [detectResult] before calling check.
 * Push events via [events] for migration flows.
 * All suspend methods assert they are NOT called on the EDT.
 */
class FakeMigrationRpcApi : KiloMigrationRpcApi {

    var statusResult: LegacyMigrationStatusDto? = null
    var detectResult: LegacyMigrationDetectionDto = emptyDetection()
    val events = MutableSharedFlow<LegacyMigrationEventDto>(extraBufferCapacity = 64)

    val statusCalls = mutableListOf<Unit>()
    val detectCalls = mutableListOf<Unit>()
    val migrateCalls = mutableListOf<LegacyMigrationSelectionsDto>()
    val skipCalls = mutableListOf<Unit>()
    val finalizeCalls = mutableListOf<LegacyMigrationStatusDto>()
    val cleanupCalls = mutableListOf<LegacyCleanupTargetsDto>()

    override suspend fun status(): LegacyMigrationStatusDto? {
        assertNotEdt("status")
        statusCalls.add(Unit)
        return statusResult
    }

    override suspend fun detect(): LegacyMigrationDetectionDto {
        assertNotEdt("detect")
        detectCalls.add(Unit)
        return detectResult
    }

    override suspend fun migrate(selections: LegacyMigrationSelectionsDto): Flow<LegacyMigrationEventDto> {
        assertNotEdt("migrate")
        migrateCalls.add(selections)
        return events
    }

    override suspend fun skip() {
        assertNotEdt("skip")
        skipCalls.add(Unit)
    }

    override suspend fun finalize(status: LegacyMigrationStatusDto) {
        assertNotEdt("finalize")
        finalizeCalls.add(status)
    }

    override suspend fun cleanup(targets: LegacyCleanupTargetsDto): LegacyCleanupReportDto {
        assertNotEdt("cleanup")
        cleanupCalls.add(targets)
        return LegacyCleanupReportDto(emptyList(), emptyList())
    }

    companion object {
        fun emptyDetection() = LegacyMigrationDetectionDto(
            providers = emptyList(),
            mcpServers = emptyList(),
            customModes = emptyList(),
            sessions = emptyList(),
            defaultModel = null,
            settings = null,
            hasData = false,
        )
    }
}
