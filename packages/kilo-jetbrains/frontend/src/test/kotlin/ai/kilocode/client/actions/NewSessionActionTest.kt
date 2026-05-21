package ai.kilocode.client.actions

import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
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

        ActionUtil.updateAction(action, AnActionEvent.createFromDataContext("", presentation) { null })

        assertFalse(presentation.isEnabled)
    }

    private fun event(manager: SessionManager): AnActionEvent {
        val presentation = Presentation().apply {
            copyFrom(NewSessionAction().templatePresentation)
        }
        val context = DataContext { id ->
            if (SessionManager.KEY.`is`(id)) manager else null
        }
        return AnActionEvent.createFromDataContext("", presentation, context)
    }

    private class FakeManager : SessionManager {
        var created = 0
        override fun newSession() {
            created++
        }

        override fun showHistory() {
        }

        override fun openSession(ref: SessionRef) {
        }
    }
}
