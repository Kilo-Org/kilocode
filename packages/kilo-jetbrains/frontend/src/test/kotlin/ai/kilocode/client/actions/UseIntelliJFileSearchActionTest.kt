package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloFileSearchSettingsService
import ai.kilocode.rpc.dto.FileSearchBackendDto
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class UseIntelliJFileSearchActionTest : BasePlatformTestCase() {
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

    fun `test selected reflects settings`() {
        val action = UseIntelliJFileSearchAction()

        assertFalse(action.isSelected(event(action)))

        settings.setBackend(FileSearchBackendDto.INTELLIJ)
        assertTrue(action.isSelected(event(action)))
    }

    fun `test set selected writes backend`() {
        val action = UseIntelliJFileSearchAction()
        val event = event(action)

        action.setSelected(event, true)
        assertEquals(FileSearchBackendDto.INTELLIJ, settings.backend())

        action.setSelected(event, false)
        assertEquals(FileSearchBackendDto.KILO, settings.backend())
    }

    private fun event(action: UseIntelliJFileSearchAction): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        return AnActionEvent.createFromDataContext("", presentation) { null }
    }
}
