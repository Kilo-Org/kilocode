package ai.kilocode.client.actions

import ai.kilocode.client.session.views.base.DefaultDialogAction
import ai.kilocode.client.session.views.base.DialogDataKeys
import ai.kilocode.client.testing.PluginDescriptor
import ai.kilocode.client.testing.attribute
import ai.kilocode.client.testing.elements
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.util.Disposer
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

    fun `test update follows dialog action enabled state`() {
        val action = SubmitDialogAction()
        val enabled = event(action, Target(true) {})
        val disabled = event(action, Target(false) {})

        action.update(enabled)
        action.update(disabled)

        assertTrue(enabled.presentation.isEnabled)
        assertFalse(disabled.presentation.isEnabled)
    }

    fun `test promoter prioritizes dialog submission and suppresses prompt send`() {
        val action = SubmitDialogAction()
        val send = SendPromptAction()
        val manager = ActionManager.getInstance()
        manager.registerAction(SendPromptAction.ID, send)
        Disposer.register(testRootDisposable) { manager.unregisterAction(SendPromptAction.ID) }
        val context = context(Target(true) {})

        assertEquals(listOf<AnAction>(action), action.promote(listOf(send, action), context))
        assertEquals(listOf<AnAction>(send), action.suppress(listOf(send, action), context))
    }

    fun `test promoter is inactive without an enabled dialog action`() {
        val action = SubmitDialogAction()
        val actions = listOf<AnAction>(action)

        assertTrue(action.promote(actions, context(Target(false) {})).isEmpty())
        assertTrue(action.suppress(actions, context(Target(false) {})).isEmpty())
    }

    fun `test action maps command enter on macOS`() {
        val shortcut = PluginDescriptor.frontend().elements("keyboard-shortcut")
            .single { (it.parentNode as? Element)?.attribute("id") == "Kilo.SubmitDialog" }

        assertEquals("Mac OS X 10.5+", shortcut.attribute("keymap"))
        assertEquals("meta ENTER", shortcut.attribute("first-keystroke"))
    }

    private fun event(action: SubmitDialogAction, target: DefaultDialogAction): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        return AnActionEvent.createFromDataContext("", presentation, context(target))
    }

    private fun context(target: DefaultDialogAction): DataContext =
        DataContext { id -> if (DialogDataKeys.DEFAULT_ACTION.`is`(id)) target else null }

    private class Target(
        override val enabled: Boolean,
        private val run: () -> Unit,
    ) : DefaultDialogAction {
        override fun submit() = run()
    }
}
