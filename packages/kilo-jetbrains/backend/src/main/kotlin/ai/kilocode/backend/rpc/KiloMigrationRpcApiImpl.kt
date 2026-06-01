@file:Suppress("UnstableApiUsage")

package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.migration.KiloBackendLegacyMigrationStoreService
import ai.kilocode.backend.migration.LegacyMigrationResultItem
import ai.kilocode.backend.migration.LegacyMigrationSink
import ai.kilocode.backend.migration.LegacyMigrationStatus
import ai.kilocode.backend.migration.MigrationItemCategory
import ai.kilocode.backend.migration.MigrationItemStatus
import ai.kilocode.rpc.KiloMigrationRpcApi
import ai.kilocode.rpc.dto.LegacyCleanupReportDto
import ai.kilocode.rpc.dto.LegacyCleanupTargetsDto
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.LegacyMigrationEventDto
import ai.kilocode.rpc.dto.LegacyMigrationSelectionsDto
import ai.kilocode.rpc.dto.LegacyMigrationStatusDto
import ai.kilocode.backend.app.KiloBackendMigrationManager
import ai.kilocode.log.KiloLog
import com.intellij.openapi.components.service
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.withContext

class KiloMigrationRpcApiImpl : KiloMigrationRpcApi {

    companion object {
        private val LOG = KiloLog.create(KiloMigrationRpcApiImpl::class.java)
    }

    private val app: KiloBackendAppService get() = service()
    private val storeService: KiloBackendLegacyMigrationStoreService get() = service()

    private fun manager(): KiloBackendMigrationManager {
        val http = app.http ?: throw IllegalStateException("Not connected")
        val port = app.port
        return KiloBackendMigrationManager(http, port)
    }

    override suspend fun status(): LegacyMigrationStatusDto? {
        val store = storeService.store()
        val status = withContext(Dispatchers.IO) { store.status() } ?: return null
        LOG.info("Migration RPC status: status=$status")
        return MigrationRpcMapper.toDto(status)
    }

    override suspend fun detect(): LegacyMigrationDetectionDto {
        LOG.info("Migration RPC detect: started")
        val mgr = manager()
        val store = storeService.store()
        val detection = withContext(Dispatchers.IO) { mgr.detect(store) }
        LOG.info("Migration RPC detect: completed hasData=${detection.hasData} providers=${detection.providers.size} mcp=${detection.mcpServers.size} modes=${detection.customModes.size} sessions=${detection.sessions.size}")
        return MigrationRpcMapper.toDto(detection)
    }

    override suspend fun migrate(selections: LegacyMigrationSelectionsDto): Flow<LegacyMigrationEventDto> {
        LOG.info("Migration RPC migrate: starting ${selectionSummary(selections)}")
        val mgr = manager()
        val domainSelections = MigrationRpcMapper.fromDto(selections)
        val store = storeService.store()
        return channelFlow {
            withContext(Dispatchers.IO) {
                val sink = object : LegacyMigrationSink {
                    override fun item(progress: ai.kilocode.backend.migration.LegacyMigrationItemProgress) {
                        LOG.info("Migration RPC item: item=${progress.item} status=${progress.status} message=${progress.message}")
                        trySendBlocking(LegacyMigrationEventDto.Item(MigrationRpcMapper.toDto(progress)))
                    }
                    override fun session(progress: ai.kilocode.backend.migration.LegacyMigrationSessionProgress) {
                        LOG.info("Migration RPC session: phase=${progress.phase} session=${progress.session?.id} error=${progress.error}")
                        trySendBlocking(LegacyMigrationEventDto.Session(MigrationRpcMapper.toDto(progress)))
                    }
                }
                val report = runCatching {
                    mgr.migrate(store, domainSelections, sink)
                }.getOrElse { e ->
                    val msg = e.message ?: "Migration failed"
                    LOG.warn("Migration RPC migrate: failed message=$msg", e)
                    val errItem = LegacyMigrationResultItem(
                        item = "Migration",
                        category = MigrationItemCategory.settings,
                        status = MigrationItemStatus.error,
                        message = msg,
                    )
                    trySendBlocking(LegacyMigrationEventDto.Complete(listOf(MigrationRpcMapper.toDto(errItem))))
                    return@withContext
                }
                LOG.info("Migration RPC migrate: complete items=${report.items.size} errors=${report.items.count { it.status == MigrationItemStatus.error }}")
                trySendBlocking(LegacyMigrationEventDto.Complete(report.items.map(MigrationRpcMapper::toDto)))
            }
        }
    }

    override suspend fun skip() {
        LOG.info("Migration RPC skip: marking skipped")
        val store = storeService.store()
        withContext(Dispatchers.IO) { store.mark(LegacyMigrationStatus.Skipped) }
        app.resumeAfterMigration()
        LOG.info("Migration RPC skip: resumed app load")
    }

    override suspend fun finalize(status: LegacyMigrationStatusDto) {
        LOG.info("Migration RPC finalize: status=$status")
        val store = storeService.store()
        val domain = MigrationRpcMapper.fromDto(status)
        if (domain != LegacyMigrationStatus.Skipped) {
            withContext(Dispatchers.IO) { store.mark(domain) }
        }
        app.resumeAfterMigration()
        LOG.info("Migration RPC finalize: resumed app load")
    }

    override suspend fun cleanup(targets: LegacyCleanupTargetsDto): LegacyCleanupReportDto {
        LOG.info("Migration RPC cleanup: providerProfiles=${targets.providerProfiles} mcp=${targets.mcpSettings} modes=${targets.customModes} state=${targets.globalState} history=${targets.taskHistory} file=${targets.legacySettingsFile}")
        val mgr = manager()
        val store = storeService.store()
        val report = withContext(Dispatchers.IO) { mgr.cleanup(store, MigrationRpcMapper.fromDto(targets)) }
        LOG.info("Migration RPC cleanup: cleaned=${report.cleaned.size} errors=${report.errors.size}")
        return MigrationRpcMapper.toDto(report)
    }

    private fun selectionSummary(selections: LegacyMigrationSelectionsDto): String =
        "providers=${selections.providers.size} mcp=${selections.mcpServers.size} modes=${selections.customModes.size} sessions=${selections.sessions.size} model=${selections.defaultModel} settings=true keepFile=${selections.keepLegacySettingsFile}"
}
