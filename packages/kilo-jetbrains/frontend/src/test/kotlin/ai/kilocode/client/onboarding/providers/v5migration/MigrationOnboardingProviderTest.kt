package ai.kilocode.client.onboarding.providers.v5migration

import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.runBlocking

@Suppress("UnstableApiUsage")
class MigrationOnboardingProviderTest : BasePlatformTestCase() {

    private lateinit var controller: FakeMigrationUiController
    private lateinit var provider: MigrationOnboardingProvider

    override fun setUp() {
        super.setUp()
        controller = FakeMigrationUiController()
        provider = MigrationOnboardingProvider(controller)
    }

    fun `test id is stable and step is blocking`() {
        assertEquals("v5-migration", provider.id)
        assertTrue(provider.blocking)
    }

    fun `test detect returns need when migration is needed`() = runBlocking {
        controller._state.value = MigrationUiState.Needed(detection = sampleDetection())
        val need = provider.detect()
        assertNotNull(need)
        // Short label for the session card bullet and the dialog rail.
        assertEquals("Migrate from Kilo v5", need!!.title)
        // Longer text, shown only in the dedicated dialog UI.
        assertTrue(need.detail.startsWith("We found settings from your previous installation"))
    }

    fun `test detect returns null when hidden`() = runBlocking {
        controller._state.value = MigrationUiState.Hidden
        assertNull(provider.detect())
    }

    fun `test skip delegates to controller`() {
        provider.skip()
        assertEquals(1, controller.skips.size)
    }

    fun `test later delegates to controller and reports success`() = runBlocking {
        assertTrue(provider.later())
        assertEquals(1, controller.laters.size)
    }

    fun `test later reports failure when the controller could not resume`() = runBlocking {
        controller.laterResult = false
        assertFalse(provider.later())
    }

    private fun sampleDetection() = LegacyMigrationDetectionDto(
        providers = emptyList(),
        mcpServers = emptyList(),
        customModes = emptyList(),
        sessions = emptyList(),
        defaultModel = null,
        settings = null,
        hasData = true,
    )
}
