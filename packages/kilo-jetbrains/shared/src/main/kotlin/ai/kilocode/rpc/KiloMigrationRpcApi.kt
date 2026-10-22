@file:Suppress("UnstableApiUsage")

package ai.kilocode.rpc

import ai.kilocode.rpc.dto.LegacyCleanupReportDto
import ai.kilocode.rpc.dto.LegacyCleanupTargetsDto
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.LegacyMigrationEventDto
import ai.kilocode.rpc.dto.LegacyMigrationSelectionsDto
import ai.kilocode.rpc.dto.LegacyMigrationStatusDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * App-level RPC API for legacy migration operations.
 *
 * All operations are app-scoped. The backend implementation delegates to
 * [ai.kilocode.backend.app.KiloBackendMigrationManager] using the active CLI connection.
 */
@Rpc
interface KiloMigrationRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloMigrationRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<KiloMigrationRpcApi>())
    }

    /** Return the persisted migration status, or null if not yet set. */
    suspend fun status(): LegacyMigrationStatusDto?

    /** Clear the persisted migration status so migration can be offered again. */
    suspend fun resetStatus(): Boolean

    /** Detect legacy data and return a summary of what can be migrated. */
    suspend fun detect(): LegacyMigrationDetectionDto

    /** Run migration for the given selections, streaming progress events. */
    suspend fun migrate(selections: LegacyMigrationSelectionsDto): Flow<LegacyMigrationEventDto>

    /** Mark migration as skipped. */
    suspend fun skip()

    /** Resume app load without marking migration as completed. */
    suspend fun resume()

    /** Mark migration as completed or completed with errors. */
    suspend fun finalize(status: LegacyMigrationStatusDto)

    /** Clean up legacy data after migration. Deleting the legacy settings file marks migration completed. */
    suspend fun cleanup(targets: LegacyCleanupTargetsDto): LegacyCleanupReportDto
}
