package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class NewWorktreeActionTest : BasePlatformTestCase() {
    fun `test toolbar presentation uses short text`() {
        val action = NewWorktreeAction()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER, ui = ActionUiKind.TOOLBAR)

        ActionUtil.updateAction(action, event)

        assertEquals("Worktree", event.presentation.text)
        assertEquals(true, event.presentation.getClientProperty(ActionUtil.SHOW_TEXT_IN_TOOLBAR))
        assertSame(KiloActionIcons.add, event.presentation.icon)
    }

    fun `test non-toolbar presentation keeps full text`() {
        val action = NewWorktreeAction()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER)

        ActionUtil.updateAction(action, event)

        assertEquals("New Worktree", event.presentation.text)
        assertNull(event.presentation.getClientProperty(ActionUtil.SHOW_TEXT_IN_TOOLBAR))
    }

    fun `test action visible on agent manager tab`() {
        val action = NewWorktreeAction()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER)

        ActionUtil.updateAction(action, event)

        assertTrue(event.presentation.isVisible)
    }

    fun `test action hidden on chat tab`() {
        val action = NewWorktreeAction()
        val event = event(action, mode = SidePanelMode.CHAT)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isVisible)
    }

    fun `test action disabled without worktree panel`() {
        val action = NewWorktreeAction()
        val event = event(action, mode = SidePanelMode.AGENT_MANAGER)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    private fun event(
        action: NewWorktreeAction,
        mode: SidePanelMode? = null,
        ui: ActionUiKind = ActionUiKind.NONE,
    ): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val context = DataContext { id ->
            if (SidePanelKeys.MODE.`is`(id)) return@DataContext mode
            null
        }
        return AnActionEvent.createEvent(context, presentation, ActionPlaces.TOOLWINDOW_TITLE, ui, null)
    }
}
