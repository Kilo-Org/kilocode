package ai.kilocode.client.actions

import ai.kilocode.client.session.views.base.DefaultDialogAction
import ai.kilocode.client.session.views.base.DialogDataKeys
import ai.kilocode.client.testing.PluginDescriptor
import ai.kilocode.client.testing.attribute
import ai.kilocode.client.testing.elements
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import org.w3c.dom.Element

class SubmitDialogActionTest : BasePlatformTestCase() {
    fun `test action submits enabled dialog action`() {
        var submitted = false
        val target = Target(true) { submitted = true }
        val action = SubmitDialogAction()

        action.actionPerformed(event(action, target))

        assertTrue(submitted)
    }

    fun `test action does not submit disabled dialog action`() {
        var submitted = false
        val target = Target(false) { submitted = true }
        val action = SubmitDialogAction()

        action.actionPerformed(event(action, target))

        assertFalse(submitted)
    }

    fun `test action maps command enter on macOS`() {
        val shortcut = PluginDescriptor.frontend().elements("keyboard-shortcut")
            .single { (it.parentNode as? Element)?.attribute("id") == "Kilo.SubmitDialog" }

        assertEquals("Mac OS X 10.5+", shortcut.attribute("keymap"))
        assertEquals("meta ENTER", shortcut.attribute("first-keystroke"))
    }

    private fun event(action: SubmitDialogAction, target: DefaultDialogAction): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        val context = DataContext { id -> if (DialogDataKeys.DEFAULT_ACTION.`is`(id)) target else null }
        return AnActionEvent.createFromDataContext("", presentation, context)
    }

    private class Target(
        override val enabled: Boolean,
        private val run: () -> Unit,
    ) : DefaultDialogAction {
        override fun submit() = run()
    }
}
