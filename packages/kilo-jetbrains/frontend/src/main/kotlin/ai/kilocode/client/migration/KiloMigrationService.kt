@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.migration

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.autocomplete.KiloAutocompleteSettingsService
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloMigrationRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LegacyAutocompleteSettingsDto
import ai.kilocode.rpc.dto.LegacyCleanupTargetsDto
import ai.kilocode.rpc.dto.LegacyMigrationEventDto
import ai.kilocode.rpc.dto.LegacyMigrationResultItemDto
import ai.kilocode.rpc.dto.LegacyMigrationStatusDto
import ai.kilocode.rpc.dto.MigrationItemCategoryDto
import ai.kilocode.rpc.dto.MigrationItemProgressStatusDto
import ai.kilocode.rpc.dto.MigrationItemStatusDto
import ai.kilocode.rpc.dto.MigrationSessionPhaseDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Interface exposed to session UI components.
 */
interface MigrationUiController {
    val state: StateFlow<MigrationUiState>
    fun check()
    fun start(selections: MigrationUiSelections)
    fun skip()
    fun finish()
}

/**
 * App-level service that manages migration wizard state shared across all session UIs.
 *
 * Detects and runs legacy migration via [KiloMigrationRpcApi].
 * All Swing interactions must happen on EDT; service coroutines run off EDT.
 */
@Service(Service.Level.APP)
class KiloMigrationService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloMigrationRpcApi?,
    appState: StateFlow<KiloAppStateDto>?,
    private val autocomplete: ((LegacyAutocompleteSettingsDto) -> Unit)?,
) : MigrationUiController {

    /** Platform constructor — resolves RPC lazily. */
    constructor(cs: CoroutineScope) : this(cs, null, service<KiloAppService>().state, null)

    internal constructor(cs: CoroutineScope, rpc: KiloMigrationRpcApi?) : this(cs, rpc, null, null)

    internal constructor(
        cs: CoroutineScope,
        rpc: KiloMigrationRpcApi?,
        appState: StateFlow<KiloAppStateDto>?,
    ) : this(cs, rpc, appState, null)

    companion object {
        private val LOG = KiloLog.create(KiloMigrationService::class.java)

        fun getInstance(): KiloMigrationService = service()
    }

    private val _state = MutableStateFlow<MigrationUiState>(MigrationUiState.Hidden)
    override val state: StateFlow<MigrationUiState> = _state.asStateFlow()

    private val migrating = AtomicBoolean(false)
    private val migrateJob = AtomicReference<Job?>(null)
    private val lastSelections = AtomicReference<MigrationUiSelections?>(null)

    init {
        if (appState != null) {
            cs.launch { appState.collect(::onAppState) }
        }
    }

    // ------ RPC helper ------

    private suspend fun <T> call(block: suspend KiloMigrationRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloMigrationRpcApi.getInstance()) }
    }

    // ------ MigrationUiController ------

    override fun check() = Unit

    /**
     * Start migration for the given user selections.
     */
    override fun start(selections: MigrationUiSelections) {
        val current = _state.value as? MigrationUiState.Needed ?: return
        if (!migrating.compareAndSet(false, true)) {
            LOG.info("Migration wizard: start ignored because migration is already running")
            return
        }
        LOG.info("Migration wizard: user started migration ${selectionSummary(selections)}")
        telemetry("Migration Started", selectionProps(selections))
        lastSelections.set(selections)

        val dto = MigrationSelectionBuilder.toDto(selections)
        val initialProgress = buildInitialProgress(selections, current.detection)
        applyAutocomplete(selections, current.detection)

        _state.value = current.copy(
            phase = MigrationUiPhase.migrating,
            running = true,
            progress = initialProgress,
            sessionProgress = null,
            sessionSummary = SessionMigrationSummary(),
            results = emptyList(),
        )

        val job = cs.launch {
            try {
                val flow = try {
                    call { migrate(dto) }
                } catch (e: Exception) {
                    telemetry("Migration Failed", mapOf("itemCount" to initialProgress.size.toString(), "errorCount" to "1", "stage" to "start"))
                    LOG.warn("migration start failed", e)
                    finishWithError(e.message ?: "Migration failed")
                    return@launch
                }
                flow.collect { event -> handleEvent(event) }
            } finally {
                migrating.set(false)
            }
        }
        migrateJob.set(job)
    }

    /**
     * Skip migration — marks status and hides for all observers.
     */
    override fun skip() {
        LOG.info("Migration wizard: user chose skip")
        val current = _state.value as? MigrationUiState.Needed
        if (current != null) telemetry("Migration Skipped", detectionProps(current.detection))
        cs.launch {
            try {
                call { skip() }
            } catch (e: Exception) {
                LOG.warn("migration skip failed", e)
            }
            _state.value = MigrationUiState.Hidden
        }
    }

    /**
     * Finalize migration — marks completed/completed_with_errors and hides.
     */
    override fun finish() {
        val current = _state.value as? MigrationUiState.Needed ?: run {
            LOG.info("Migration wizard: finish requested while hidden")
            _state.value = MigrationUiState.Hidden
            return
        }
        val hasErrors = current.results.any { it.status == MigrationItemStatusDto.error }
        val status = if (hasErrors) LegacyMigrationStatusDto.completed_with_errors else LegacyMigrationStatusDto.completed
        val selections = lastSelections.get()
        LOG.info("Migration wizard: user finished migration status=$status results=${current.results.size} errors=${current.results.count { it.status == MigrationItemStatusDto.error }}")
        telemetry("Migration Finished", mapOf("status" to status.name, "cleanupRequested" to (selections?.keepLegacySettingsFile == false).toString()))
        cs.launch {
            try {
                call { finalize(status) }
                if (selections?.keepLegacySettingsFile == false) {
                    call { cleanup(cleanupTargets()) }
                }
            } catch (e: Exception) {
                LOG.warn("migration finalize failed", e)
            }
            _state.value = MigrationUiState.Hidden
        }
    }

    // ------ Internal event handling ------

    private fun handleEvent(event: LegacyMigrationEventDto) {
        val current = _state.value as? MigrationUiState.Needed ?: return
        when (event) {
            is LegacyMigrationEventDto.Item -> {
                val p = event.progress
                LOG.info("Migration wizard: item progress item=${p.item} status=${p.status} message=${p.message}")
                val updated = current.progress.map {
                    if (it.item == p.item) it.copy(status = p.status, message = p.message) else it
                }
                _state.value = current.copy(progress = updated)
            }
            is LegacyMigrationEventDto.Session -> {
                val sp = event.progress
                val phase = sp.phase
                LOG.info("Migration wizard: session progress phase=$phase session=${sp.session?.id} error=${sp.error}")

                // Update session summary buckets
                val summary = when (phase) {
                    MigrationSessionPhaseDto.done -> {
                        val item = LegacyMigrationResultItemDto(
                            item = sp.session?.id ?: "",
                            category = ai.kilocode.rpc.dto.MigrationItemCategoryDto.session,
                            status = MigrationItemStatusDto.success,
                        )
                        current.sessionSummary.copy(imported = current.sessionSummary.imported + item)
                    }
                    MigrationSessionPhaseDto.error -> {
                        val item = LegacyMigrationResultItemDto(
                            item = sp.session?.id ?: "",
                            category = ai.kilocode.rpc.dto.MigrationItemCategoryDto.session,
                            status = MigrationItemStatusDto.error,
                            message = sp.error,
                        )
                        current.sessionSummary.copy(errored = current.sessionSummary.errored + item)
                    }
                    else -> current.sessionSummary
                }
                _state.value = current.copy(sessionProgress = sp, sessionSummary = summary)
            }
            is LegacyMigrationEventDto.Complete -> {
                val items = event.items
                val hasErrors = items.any { it.status == MigrationItemStatusDto.error }
                val phase = if (hasErrors) MigrationUiPhase.error else MigrationUiPhase.done
                val progress = if (hasErrors) current.progress else finishSilentProgress(current.progress)
                LOG.info("Migration wizard: migration complete phase=$phase items=${items.size} errors=${items.count { it.status == MigrationItemStatusDto.error }}")
                if (hasErrors) {
                    telemetry("Migration Failed", mapOf("itemCount" to items.size.toString(), "errorCount" to items.count { it.status == MigrationItemStatusDto.error }.toString(), "stage" to "complete"))
                } else {
                    telemetry("Migration Completed", mapOf("itemCount" to items.size.toString(), "sessionImportedCount" to current.sessionSummary.imported.size.toString()))
                }
                _state.value = current.copy(
                    running = false,
                    phase = phase,
                    progress = progress,
                    results = items,
                )
            }
            is LegacyMigrationEventDto.Error -> {
                LOG.warn("Migration wizard: migration error message=${event.message}")
                telemetry("Migration Failed", mapOf("itemCount" to current.progress.size.toString(), "errorCount" to "1", "stage" to "event"))
                finishWithError(event.message)
            }
        }
    }

    private fun onAppState(state: KiloAppStateDto) {
        val migration = state.migration
        if (state.status == KiloAppStatusDto.MIGRATION_REQUIRED && migration != null) {
            val current = _state.value
            if (current is MigrationUiState.Needed && current.detection == migration && current.phase != MigrationUiPhase.selecting) return
            LOG.info("Migration wizard: showing because backend requires migration ${detectionSummary(migration)}")
            telemetry("Migration Shown", detectionProps(migration))
            _state.value = MigrationUiState.Needed(migration)
            return
        }
        if (migrating.get()) return
        if (_state.value !is MigrationUiState.Hidden) {
            LOG.info("Migration wizard: hiding because backend status=${state.status}")
        }
        _state.value = MigrationUiState.Hidden
    }

    private fun finishWithError(msg: String) {
        val current = _state.value as? MigrationUiState.Needed ?: return
        val errItem = LegacyMigrationResultItemDto(
            item = "Migration",
            category = ai.kilocode.rpc.dto.MigrationItemCategoryDto.settings,
            status = MigrationItemStatusDto.error,
            message = msg,
        )
        _state.value = current.copy(
            running = false,
            phase = MigrationUiPhase.error,
            results = listOf(errItem),
        )
    }

    private fun applyAutocomplete(
        selections: MigrationUiSelections,
        detection: ai.kilocode.rpc.dto.LegacyMigrationDetectionDto,
    ) {
        if (!selections.settings.autocomplete) return
        val settings = detection.settings?.autocomplete ?: return
        val apply = autocomplete ?: { KiloAutocompleteSettingsService.getInstance().applyLegacy(it) }
        apply(settings)
    }

    private fun selectionSummary(selections: MigrationUiSelections): String =
        "providers=${selections.providers.size}:${selections.providers.joinToString(",")} mcp=${selections.mcpServers.size}:${selections.mcpServers.joinToString(",")} modes=${selections.customModes.size}:${selections.customModes.joinToString(",")} sessions=${selections.sessions.size} model=${selections.defaultModel} settings=${settingsSummary(selections.settings)} keepFile=${selections.keepLegacySettingsFile}"

    private fun cleanupTargets() = LegacyCleanupTargetsDto(
        providerProfiles = true,
        mcpSettings = true,
        customModes = true,
        globalState = true,
        taskHistory = true,
        legacySettingsFile = true,
    )

    private fun settingsSummary(settings: MigrationSettingsUiSelections): String =
        "commandRules=${settings.autoApproval.commandRules},read=${settings.autoApproval.readPermission},write=${settings.autoApproval.writePermission},execute=${settings.autoApproval.executePermission},mcp=${settings.autoApproval.mcpPermission},task=${settings.autoApproval.taskPermission},language=${settings.language},autocomplete=${settings.autocomplete}"

    private fun detectionSummary(detection: ai.kilocode.rpc.dto.LegacyMigrationDetectionDto): String =
        "providers=${detection.providers.size} mcp=${detection.mcpServers.size} modes=${detection.customModes.size} sessions=${detection.sessions.size} model=${detection.defaultModel != null} settings=${detection.settings != null}"

    private fun detectionProps(detection: ai.kilocode.rpc.dto.LegacyMigrationDetectionDto): Map<String, String> = mapOf(
        "settings" to (detection.settings != null).toString(),
        "providers" to detection.providers.size.toString(),
        "mcpServers" to detection.mcpServers.size.toString(),
        "customModes" to detection.customModes.size.toString(),
        "sessions" to detection.sessions.size.toString(),
        "defaultModel" to (detection.defaultModel != null).toString(),
    )

    private fun selectionProps(selections: MigrationUiSelections): Map<String, String> = mapOf(
        "providers" to selections.providers.size.toString(),
        "mcpServers" to selections.mcpServers.size.toString(),
        "customModes" to selections.customModes.size.toString(),
        "sessions" to selections.sessions.size.toString(),
        "defaultModel" to selections.defaultModel.toString(),
        "keepLegacySettingsFile" to selections.keepLegacySettingsFile.toString(),
    )

    private fun telemetry(event: String, props: Map<String, String>) {
        Telemetry.send(event, props)
    }

    private fun buildInitialProgress(
        selections: MigrationUiSelections,
        detection: ai.kilocode.rpc.dto.LegacyMigrationDetectionDto,
    ): List<MigrationItemUiProgress> {
        val list = mutableListOf<MigrationItemUiProgress>()
        for (id in selections.providers) {
            list.add(MigrationItemUiProgress(id, MigrationItemCategoryDto.provider))
        }
        for (name in selections.mcpServers) {
            list.add(MigrationItemUiProgress(name, MigrationItemCategoryDto.mcpServer))
        }
        for (slug in selections.customModes) {
            val info = detection.customModes.find { it.slug == slug }
            list.add(MigrationItemUiProgress(info?.name ?: slug, MigrationItemCategoryDto.customMode))
        }
        for (id in selections.sessions) {
            list.add(MigrationItemUiProgress(id, MigrationItemCategoryDto.session))
        }
        if (selections.defaultModel) {
            list.add(MigrationItemUiProgress("Default model", MigrationItemCategoryDto.defaultModel))
        }
        // Settings sub-items
        val ap = selections.settings.autoApproval
        if (ap.commandRules) list.add(MigrationItemUiProgress("Command rules", MigrationItemCategoryDto.settings))
        if (ap.readPermission) list.add(MigrationItemUiProgress("Read permission", MigrationItemCategoryDto.settings))
        if (ap.writePermission) list.add(MigrationItemUiProgress("Write permission", MigrationItemCategoryDto.settings))
        if (ap.executePermission) list.add(MigrationItemUiProgress("Execute permission", MigrationItemCategoryDto.settings))
        if (ap.mcpPermission) list.add(MigrationItemUiProgress("MCP permission", MigrationItemCategoryDto.settings))
        if (ap.taskPermission) list.add(MigrationItemUiProgress("Task permission", MigrationItemCategoryDto.settings))
        if (selections.settings.language) list.add(MigrationItemUiProgress("Language preference", MigrationItemCategoryDto.settings))
        if (selections.settings.autocomplete) list.add(MigrationItemUiProgress("Autocomplete settings", MigrationItemCategoryDto.settings))
        return list
    }

    private fun finishSilentProgress(items: List<MigrationItemUiProgress>) = items.map {
        if (it.status == MigrationItemProgressStatusDto.migrating) it.copy(status = MigrationItemProgressStatusDto.success)
        else it
    }
}
