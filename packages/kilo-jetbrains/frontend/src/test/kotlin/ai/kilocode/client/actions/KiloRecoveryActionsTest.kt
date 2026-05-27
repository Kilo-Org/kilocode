package ai.kilocode.client.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class KiloRecoveryActionsTest : BasePlatformTestCase() {
    fun `test restart action stays enabled for all app states`() {
        val action = RestartKiloAction()
        val event = event(action)

        ActionUtil.updateAction(action, event)

        assertTrue("Restart should force-enable recovery action", event.presentation.isEnabled)
    }

    fun `test reinstall action stays enabled for all app states`() {
        val action = ReinstallKiloAction()
        val event = event(action)

        ActionUtil.updateAction(action, event)

        assertTrue("Reinstall should force-enable recovery action", event.presentation.isEnabled)
    }

    private fun event(action: AnAction): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        presentation.isEnabled = false
        return AnActionEvent.createFromDataContext("", presentation) { null }
    }
}
