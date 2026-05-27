package ai.kilocode.client.migration

import ai.kilocode.client.testing.FakeMigrationRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LegacyAutocompleteSettingsDto
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.LegacyMigrationEventDto
import ai.kilocode.rpc.dto.LegacyMigrationResultItemDto
import ai.kilocode.rpc.dto.LegacyMigrationStatusDto
import ai.kilocode.rpc.dto.LegacySettingsDto
import ai.kilocode.rpc.dto.MigrationItemCategoryDto
import ai.kilocode.rpc.dto.MigrationItemProgressStatusDto
import ai.kilocode.rpc.dto.MigrationItemStatusDto
import ai.kilocode.rpc.dto.MigrationProviderInfoDto
import ai.kilocode.rpc.dto.MigrationSessionInfoDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking

@Suppress("UnstableApiUsage")
class KiloMigrationServiceTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeMigrationRpcApi
    private lateinit var service: KiloMigrationService
    private lateinit var app: MutableStateFlow<KiloAppStateDto>
    private val autocomplete = mutableListOf<LegacyAutocompleteSettingsDto>()

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeMigrationRpcApi()
        app = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.DISCONNECTED))
        autocomplete.clear()
        service = KiloMigrationService(scope, rpc, app) { autocomplete.add(it) }
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    private fun settle() = runBlocking {
        repeat(3) {
            delay(50)
            UIUtil.dispatchAllInvocationEvents()
        }
    }

    fun `test migration required app state shows needed without polling`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        assertEquals(0, rpc.statusCalls.size)
        assertEquals(0, rpc.detectCalls.size)
        assertTrue("state should be Needed", service.state.value is MigrationUiState.Needed)
    }

    fun `test ready app state hides migration`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        app.value = KiloAppStateDto(KiloAppStatusDto.READY)
        settle()
        assertEquals(MigrationUiState.Hidden, service.state.value)
    }

    fun `test duplicate migration required does not reset running migration`() {
        val detection = sampleDetection()
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = detection)
        settle()
        service.start(MigrationUiSelections(providers = listOf("profile1")))
        settle()
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = detection)
        settle()
        val state = service.state.value as MigrationUiState.Needed
        assertEquals(MigrationUiPhase.migrating, state.phase)
    }

    fun `test skip marks status and hides`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        service.skip()
        settle()
        assertEquals(1, rpc.skipCalls.size)
        assertEquals(MigrationUiState.Hidden, service.state.value)
    }

    fun `test finish calls finalize and hides`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        service.finish()
        settle()
        assertEquals(1, rpc.finalizeCalls.size)
        assertEquals(LegacyMigrationStatusDto.completed, rpc.finalizeCalls[0])
        assertEquals(0, rpc.cleanupCalls.size)
        assertEquals(MigrationUiState.Hidden, service.state.value)
    }

    fun `test finish after unchecked keep file cleans up legacy settings file`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        service.start(MigrationUiSelections(providers = listOf("profile1"), keepLegacySettingsFile = false))
        settle()

        service.finish()
        settle()

        assertEquals(1, rpc.finalizeCalls.size)
        assertEquals(1, rpc.cleanupCalls.size)
        val targets = rpc.cleanupCalls[0]
        assertTrue(targets.providerProfiles)
        assertTrue(targets.mcpSettings)
        assertTrue(targets.customModes)
        assertTrue(targets.globalState)
        assertTrue(targets.taskHistory)
        assertTrue(targets.legacySettingsFile)
    }

    fun `test start emits migrating state and initial pending progress`() = runBlocking {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        delay(100)
        UIUtil.dispatchAllInvocationEvents()

        val selections = MigrationUiSelections(providers = listOf("profile1"))
        service.start(selections)
        delay(50)
        UIUtil.dispatchAllInvocationEvents()

        val state = service.state.value
        assertTrue("should be Needed after start", state is MigrationUiState.Needed)
        val needed = state as MigrationUiState.Needed
        assertEquals(MigrationUiPhase.migrating, needed.phase)
        assertTrue(needed.running)
        assertTrue("should have initial progress entries", needed.progress.isNotEmpty())
    }

    fun `test complete event without errors sets done phase`() = runBlocking {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        delay(100)
        UIUtil.dispatchAllInvocationEvents()

        val selections = MigrationUiSelections(providers = listOf("profile1"))
        service.start(selections)
        delay(50)
        UIUtil.dispatchAllInvocationEvents()

        val items = listOf(LegacyMigrationResultItemDto("profile1", MigrationItemCategoryDto.provider, MigrationItemStatusDto.success))
        rpc.events.emit(LegacyMigrationEventDto.Complete(items))
        delay(100)
        UIUtil.dispatchAllInvocationEvents()

        val state = service.state.value as? MigrationUiState.Needed
        assertNotNull(state)
        assertEquals(MigrationUiPhase.done, state!!.phase)
        assertFalse(state.running)
    }

    fun `test complete event with errors sets error phase`() = runBlocking {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        delay(100)
        UIUtil.dispatchAllInvocationEvents()

        val selections = MigrationUiSelections(providers = listOf("profile1"))
        service.start(selections)
        delay(50)
        UIUtil.dispatchAllInvocationEvents()

        val items = listOf(LegacyMigrationResultItemDto("profile1", MigrationItemCategoryDto.provider, MigrationItemStatusDto.error, "bad key"))
        rpc.events.emit(LegacyMigrationEventDto.Complete(items))
        delay(100)
        UIUtil.dispatchAllInvocationEvents()

        val state = service.state.value as? MigrationUiState.Needed
        assertNotNull(state)
        assertEquals(MigrationUiPhase.error, state!!.phase)
    }

    fun `test complete event without items finalizes pending session progress`() = runBlocking {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection().copy(
            sessions = listOf(MigrationSessionInfoDto("ses_1", "Session", "/tmp", 1L)),
        ))
        delay(100)
        UIUtil.dispatchAllInvocationEvents()

        service.start(MigrationUiSelections(sessions = listOf("ses_1")))
        delay(50)
        UIUtil.dispatchAllInvocationEvents()

        rpc.events.emit(LegacyMigrationEventDto.Complete(emptyList()))
        delay(100)
        UIUtil.dispatchAllInvocationEvents()

        val state = service.state.value as MigrationUiState.Needed
        assertEquals(MigrationUiPhase.done, state.phase)
        assertFalse(state.running)
        assertEquals(MigrationItemProgressStatusDto.success, state.progress.single { it.item == "ses_1" }.status)
    }

    fun `test start persists selected legacy autocomplete settings`() {
        val detection = sampleDetection().copy(
            settings = LegacySettingsDto(
                autoApprovalEnabled = null,
                allowedCommands = null,
                deniedCommands = null,
                alwaysAllowReadOnly = null,
                alwaysAllowReadOnlyOutsideWorkspace = null,
                alwaysAllowWrite = null,
                alwaysAllowExecute = null,
                alwaysAllowMcp = null,
                alwaysAllowModeSwitch = null,
                alwaysAllowSubtasks = null,
                language = null,
                autocomplete = LegacyAutocompleteSettingsDto(
                    enableAutoTrigger = true,
                    enableSmartInlineTaskKeybinding = false,
                    enableChatAutocomplete = true,
                ),
            )
        )
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = detection)
        settle()

        service.start(MigrationUiSelections(settings = MigrationSettingsUiSelections(autocomplete = true)))
        settle()

        assertEquals(1, autocomplete.size)
        assertEquals(true, autocomplete[0].enableAutoTrigger)
        assertEquals(false, autocomplete[0].enableSmartInlineTaskKeybinding)
        assertEquals(true, autocomplete[0].enableChatAutocomplete)
    }

    private fun sampleDetection() = LegacyMigrationDetectionDto(
        providers = listOf(
            MigrationProviderInfoDto("profile1", "anthropic", "claude-3", true, true, "anthropic"),
        ),
        mcpServers = emptyList(),
        customModes = emptyList(),
        sessions = emptyList(),
        defaultModel = null,
        settings = null,
        hasData = true,
    )
}
