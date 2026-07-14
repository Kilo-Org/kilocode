package ai.kilocode.client.app

import ai.kilocode.rpc.dto.FileSearchBackendDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class KiloFileSearchSettingsServiceTest : BasePlatformTestCase() {
    private lateinit var settings: KiloFileSearchSettingsService

    override fun setUp() {
        super.setUp()
        settings = KiloFileSearchSettingsService.getInstance()
        settings.loadState(KiloFileSearchSettingsService.State())
    }

    override fun tearDown() {
        try {
            settings.loadState(KiloFileSearchSettingsService.State())
        } finally {
            super.tearDown()
        }
    }

    fun `test default backend is Kilo`() {
        assertEquals(FileSearchBackendDto.KILO, settings.backend())
        assertFalse(settings.useIntellij())
    }

    fun `test setting IntelliJ persists state`() {
        settings.setBackend(FileSearchBackendDto.INTELLIJ)

        assertEquals("intellij", settings.state.backend)
        assertEquals(FileSearchBackendDto.INTELLIJ, settings.backend())
        assertTrue(settings.useIntellij())
    }

    fun `test invalid backend falls back to Kilo`() {
        settings.loadState(KiloFileSearchSettingsService.State("unknown"))

        assertEquals(FileSearchBackendDto.KILO, settings.backend())
        assertFalse(settings.useIntellij())
    }

    fun `test setUseIntellij toggles backend`() {
        settings.setUseIntellij(true)
        assertEquals(FileSearchBackendDto.INTELLIJ, settings.backend())

        settings.setUseIntellij(false)
        assertEquals(FileSearchBackendDto.KILO, settings.backend())
    }
}
