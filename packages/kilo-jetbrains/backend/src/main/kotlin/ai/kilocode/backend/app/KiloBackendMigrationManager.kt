package ai.kilocode.backend.app

import ai.kilocode.backend.migration.*
import ai.kilocode.backend.rpc.MigrationRpcMapper
import ai.kilocode.backend.settings.settingsClient
import com.intellij.openapi.components.service
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal class KiloBackendMigrationManager {
    private fun engine(store: LegacyMigrationStore) =
        LegacyMigrationEngine(store, LegacyMigrationV2Backend(::settingsClient))

    fun detect(store: LegacyMigrationStore) = engine(store).detect()

    suspend fun migrate(
        store: LegacyMigrationStore,
        selections: LegacyMigrationSelections,
        sink: LegacyMigrationSink,
    ) = engine(store).migrate(selections, sink)

    fun cleanup(store: LegacyMigrationStore, targets: LegacyCleanupTargets) = store.cleanup(targets)

    companion object {
        suspend fun offer(force: Boolean) =
            withContext(Dispatchers.IO) {
                val source = service<KiloBackendLegacyMigrationStoreService>()
                if (!force && source.status() != null) return@withContext null
                KiloBackendMigrationManager()
                    .detect(source.resolveSource(includeFile = force).store)
                    .takeIf { it.hasData }
                    ?.let(MigrationRpcMapper::toDto)
            }
    }
}
