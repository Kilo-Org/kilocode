package ai.kilocode.backend.app

import ai.kilocode.backend.migration.LegacyCleanupTargets
import ai.kilocode.backend.migration.LegacyCleanupReport
import ai.kilocode.backend.migration.LegacyMigrationBackend
import ai.kilocode.backend.migration.LegacyMigrationDetection
import ai.kilocode.backend.migration.LegacyMigrationEngine
import ai.kilocode.backend.migration.LegacyMigrationHttpBackend
import ai.kilocode.backend.migration.LegacyMigrationReport
import ai.kilocode.backend.migration.LegacyMigrationSelections
import ai.kilocode.backend.migration.LegacyMigrationSink
import ai.kilocode.backend.migration.LegacyMigrationStatus
import ai.kilocode.backend.migration.LegacyMigrationStore
import okhttp3.OkHttpClient

/**
 * Thin factory/wrapper that creates [LegacyMigrationEngine] instances using the active
 * CLI connection. Does not auto-run migration and does not touch any UI.
 *
 * Instantiate when the CLI connection is ready (port + authenticated client available).
 * The [store] is caller-supplied, allowing test and UI flows to provide different adapters.
 */
class KiloBackendMigrationManager(
    private val client: OkHttpClient,
    private val port: Int,
) {
    private fun base() = "http://127.0.0.1:$port"
    private fun httpBackend(): LegacyMigrationBackend = LegacyMigrationHttpBackend(client, base())

    fun status(store: LegacyMigrationStore): LegacyMigrationStatus? =
        LegacyMigrationEngine(store, httpBackend()).status()

    fun mark(store: LegacyMigrationStore, status: LegacyMigrationStatus) =
        LegacyMigrationEngine(store, httpBackend()).mark(status)

    fun detect(store: LegacyMigrationStore): LegacyMigrationDetection =
        LegacyMigrationEngine(store, httpBackend()).detect()

    fun migrate(
        store: LegacyMigrationStore,
        selections: LegacyMigrationSelections,
        sink: LegacyMigrationSink = LegacyMigrationSink.None,
    ): LegacyMigrationReport =
        LegacyMigrationEngine(store, httpBackend()).migrate(selections, sink)

    fun cleanup(store: LegacyMigrationStore, targets: LegacyCleanupTargets): LegacyCleanupReport =
        LegacyMigrationEngine(store, httpBackend()).cleanup(targets)
}
