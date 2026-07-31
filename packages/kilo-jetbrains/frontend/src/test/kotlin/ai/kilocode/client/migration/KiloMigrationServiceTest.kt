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
import ai.kilocode.rpc.dto.MigrationCustomModeInfoDto
import ai.kilocode.rpc.dto.MigrationDefaultModelInfoDto
import ai.kilocode.rpc.dto.MigrationMcpServerInfoDto
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
    private val telemetry = mutableListOf<Pair<String, Map<String, String>>>()

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeMigrationRpcApi()
        app = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.DISCONNECTED))
        autocomplete.clear()
        telemetry.clear()
        service = KiloMigrationService(scope, rpc, app, { autocomplete.add(it) }) { event, props -> telemetry.add(event to props) }
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

    fun `test migration shown telemetry includes discovered payload`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()

        val props = telemetry.single { it.first == "Migration Shown" }.second
        assertEquals("true", props["hasData"])
        assertEquals("1", props["providers"])
        assertEquals("anthropic", props["providerTypes"])
        assertEquals("2", props["mcpServers"])
        assertEquals("sse:1,stdio:1", props["mcpTypes"])
        assertEquals("1", props["mcpDisabled"])
        assertEquals("2", props["customModes"])
        assertEquals("1", props["customNativeModes"])
        assertEquals("2", props["sessions"])
        assertEquals("1", props["sessionDirectories"])
        assertEquals("true", props["defaultModel"])
        assertEquals("anthropic", props["defaultModelProvider"])
        assertEquals("claude-3", props["defaultModelId"])
        assertEquals("true", props["settingsLanguage"])
        assertEquals("true", props["settingsAutocomplete"])
        assertEquals("2", props["settingsAllowedCommands"])
        assertEquals("app_state", props["trigger"])
    }

    fun `test ready app state hides migration`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        app.value = KiloAppStateDto(KiloAppStatusDto.READY)
        settle()
        assertEquals(MigrationUiState.Hidden, service.state.value)
        val props = telemetry.single { it.first == "Migration Hidden" }.second
        assertEquals("app_status_READY", props["option"])
        assertEquals("2", props["mcpServers"])
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
        val props = telemetry.single { it.first == "Migration Hidden" }.second
        assertEquals("skip", props["option"])
        assertEquals("2", props["sessions"])
    }

    fun `test later resumes without marking status and hides`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        service.later()
        settle()
        assertEquals(1, rpc.resumeCalls.size)
        assertEquals(0, rpc.skipCalls.size)
        assertEquals(0, rpc.finalizeCalls.size)
        assertEquals(MigrationUiState.Hidden, service.state.value)
        val props = telemetry.single { it.first == "Migration Hidden" }.second
        assertEquals("later", props["option"])
        assertEquals("2", props["mcpServers"])
    }

    fun `test later keeps wizard visible when resume fails`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        rpc.resumeError = IllegalStateException("backend unavailable")
        settle()

        service.later()
        settle()

        val state = service.state.value as MigrationUiState.Needed
        assertEquals(1, rpc.resumeCalls.size)
        assertEquals(MigrationUiPhase.error, state.phase)
        assertEquals("backend unavailable", state.results.single().message)
    }

    fun `test finish with kept source marks completed without cleanup`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        service.finish()
        settle()
        assertEquals(1, rpc.finalizeCalls.size)
        assertEquals(LegacyMigrationStatusDto.completed, rpc.finalizeCalls[0])
        assertEquals(0, rpc.cleanupCalls.size)
        assertEquals(0, rpc.resumeCalls.size)
        assertEquals(MigrationUiState.Hidden, service.state.value)
        val props = telemetry.single { it.first == "Migration Hidden" }.second
        assertEquals("finish_completed", props["option"])
        assertEquals("completed", props["status"])
        assertEquals("false", props["cleanupRequested"])
    }

    fun `test finish after unchecked keep file cleans up legacy settings file`() {
        app.value = KiloAppStateDto(KiloAppStatusDto.MIGRATION_REQUIRED, migration = sampleDetection())
        settle()
        service.start(MigrationUiSelections(providers = listOf("profile1"), keepLegacySettingsFile = false))
        settle()

        service.finish()
        settle()

        assertEquals(1, rpc.finalizeCalls.size)
        assertEquals(LegacyMigrationStatusDto.completed, rpc.finalizeCalls[0])
        assertEquals(1, rpc.cleanupCalls.size)
        assertEquals(0, rpc.resumeCalls.size)
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
        mcpServers = listOf(
            MigrationMcpServerInfoDto("local", "stdio", false),
            MigrationMcpServerInfoDto("remote", "sse", true),
        ),
        customModes = listOf(
            MigrationCustomModeInfoDto("Helper", "helper"),
            MigrationCustomModeInfoDto("Code Custom", "code-custom", "code"),
        ),
        sessions = listOf(
            MigrationSessionInfoDto("ses_1", "One", "/tmp/project", 1L),
            MigrationSessionInfoDto("ses_2", "Two", "/tmp/project", 2L),
        ),
        defaultModel = MigrationDefaultModelInfoDto("anthropic", "claude-3"),
        settings = LegacySettingsDto(
            autoApprovalEnabled = true,
            allowedCommands = listOf("npm test", "git status"),
            deniedCommands = listOf("rm -rf"),
            alwaysAllowReadOnly = true,
            alwaysAllowReadOnlyOutsideWorkspace = null,
            alwaysAllowWrite = false,
            alwaysAllowExecute = true,
            alwaysAllowMcp = true,
            alwaysAllowModeSwitch = false,
            alwaysAllowSubtasks = true,
            language = "en",
            autocomplete = LegacyAutocompleteSettingsDto(
                enableAutoTrigger = true,
                enableSmartInlineTaskKeybinding = false,
                enableChatAutocomplete = true,
            ),
        ),
        hasData = true,
    )
}
