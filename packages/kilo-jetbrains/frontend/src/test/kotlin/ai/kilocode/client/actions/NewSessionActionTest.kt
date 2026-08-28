package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.SidePanelKeys
import ai.kilocode.client.agentManager.SidePanelMode
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUiKind
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class NewSessionActionTest : BasePlatformTestCase() {
    fun `test action invokes manager from data context and has presentation`() {
        val manager = FakeManager()
        val action = NewSessionAction()
        val event = event(manager)

        ActionUtil.updateAction(action, event)
        action.actionPerformed(event)

        assertEquals(1, manager.created)
        assertTrue(event.presentation.isEnabled)
        assertEquals("New Session", action.templatePresentation.text)
        assertEquals("Start a new Kilo session", action.templatePresentation.description)
        assertNotNull(action.templatePresentation.icon)
    }

    fun `test update disables action without manager`() {
        val action = NewSessionAction()
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }

        ActionUtil.updateAction(action, event(action, presentation = presentation))

        assertFalse(presentation.isEnabled)
    }

    fun `test toolbar presentation uses short text`() {
        val manager = FakeManager()
        val action = NewSessionAction()
        val event = event(action, manager = manager, ui = ActionUiKind.TOOLBAR)

        ActionUtil.updateAction(action, event)

        assertEquals("Session", event.presentation.text)
        assertEquals(true, event.presentation.getClientProperty(ActionUtil.SHOW_TEXT_IN_TOOLBAR))
        assertSame(KiloActionIcons.add, event.presentation.icon)
    }

    fun `test non-toolbar presentation keeps full text`() {
        val manager = FakeManager()
        val action = NewSessionAction()
        val event = event(action, manager = manager)

        ActionUtil.updateAction(action, event)

        assertEquals("New Session", event.presentation.text)
        assertNull(event.presentation.getClientProperty(ActionUtil.SHOW_TEXT_IN_TOOLBAR))
    }

    fun `test action hidden on agent manager tab`() {
        val manager = FakeManager()
        val action = NewSessionAction()
        val event = event(action, manager = manager, mode = SidePanelMode.AGENT_MANAGER)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isVisible)
    }

    private fun event(manager: SessionManager): AnActionEvent {
        return event(NewSessionAction(), manager = manager)
    }

    private fun event(
        action: NewSessionAction,
        manager: SessionManager? = null,
        mode: SidePanelMode? = null,
        ui: ActionUiKind = ActionUiKind.NONE,
        presentation: Presentation = Presentation().apply { copyFrom(action.templatePresentation) },
    ): AnActionEvent {
        val context = DataContext { id ->
            if (SessionManager.KEY.`is`(id)) return@DataContext manager
            if (SidePanelKeys.MODE.`is`(id)) return@DataContext mode
            null
        }
        return AnActionEvent.createEvent(context, presentation, ActionPlaces.TOOLWINDOW_TITLE, ui, null)
    }

    private class FakeManager : SessionManager {
        var created = 0
        override fun newSession() {
            created++
        }

        override fun showHistory(back: (() -> Unit)?) {
        }

        override fun openSession(ref: SessionRef) {
        }
    }
}
