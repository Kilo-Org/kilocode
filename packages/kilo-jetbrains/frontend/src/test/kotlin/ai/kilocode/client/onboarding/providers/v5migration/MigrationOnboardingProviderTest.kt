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
        assertEquals("Migrate from v5", need!!.title)
    }

    fun `test detect returns null when hidden`() = runBlocking {
        controller._state.value = MigrationUiState.Hidden
        assertNull(provider.detect())
    }

    fun `test skip delegates to controller`() {
        provider.skip()
        assertEquals(1, controller.skips.size)
    }

    fun `test later delegates to controller`() {
        provider.later()
        assertEquals(1, controller.laters.size)
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
