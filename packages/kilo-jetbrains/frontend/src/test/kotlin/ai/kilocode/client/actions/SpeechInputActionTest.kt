package ai.kilocode.client.actions

import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.SpeechInputContext
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class SpeechInputActionTest : BasePlatformTestCase() {
    fun `test action invokes prompt context on each stroke`() {
        val ctx = FakeContext(true)
        val action = SpeechInputAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        action.actionPerformed(event)
        action.actionPerformed(event)

        assertTrue(event.presentation.isEnabled)
        assertEquals(2, ctx.toggles)
        assertEquals("Toggle Voice Input", action.templatePresentation.text)
        assertEquals("Start or stop recording a dictated prompt", action.templatePresentation.description)
    }

    fun `test action is disabled outside an available speech prompt`() {
        val action = SpeechInputAction()
        val absent = event(action, null)
        val disabled = event(action, FakeContext(false))

        ActionUtil.updateAction(action, absent)
        ActionUtil.updateAction(action, disabled)
        action.actionPerformed(disabled)

        assertFalse(absent.presentation.isEnabled)
        assertFalse(disabled.presentation.isEnabled)
    }

    fun `test action wins shortcut conflicts only in speech prompt`() {
        val action = SpeechInputAction()
        val other = object : DumbAwareAction() {
            override fun actionPerformed(e: AnActionEvent) = Unit
        }
        val manager = ActionManager.getInstance()
        val id = "Kilo.Test.SpeechInputConflict"
        manager.registerAction(id, other)
        Disposer.register(testRootDisposable) { manager.unregisterAction(id) }
        val checkin = manager.getAction(IdeActions.ACTION_CHECKIN_PROJECT) ?: object : DumbAwareAction() {
            override fun actionPerformed(e: AnActionEvent) = Unit
        }.also {
            manager.registerAction(IdeActions.ACTION_CHECKIN_PROJECT, it)
            Disposer.register(testRootDisposable) { manager.unregisterAction(IdeActions.ACTION_CHECKIN_PROJECT) }
        }
        val enabled = context(FakeContext(true))
        val disabled = context(FakeContext(false))

        assertEquals(listOf(action), action.promote(listOf(other, checkin, action), enabled))
        assertTrue(action.promote(listOf(other, checkin), enabled).isEmpty())
        assertEquals(listOf(checkin), action.suppress(listOf(other, checkin, action), enabled))
        assertTrue(action.promote(listOf(other, checkin, action), disabled).isEmpty())
        assertTrue(action.suppress(listOf(other, checkin, action), disabled).isEmpty())
    }

    fun `test frontend descriptor registers configurable control K shortcut`() {
        val xml = javaClass.classLoader.getResourceAsStream("kilo.jetbrains.frontend.xml")
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: error("missing frontend descriptor")
        val start = xml.substringAfter("<action id=\"Kilo.SpeechInput\"").substringBefore("</action>")

        assertTrue(start.contains("class=\"ai.kilocode.client.actions.SpeechInputAction\""))
        assertTrue(start.contains("keymap=\"\$default\""))
        assertTrue(start.contains("first-keystroke=\"control K\""))
    }

    private fun event(action: SpeechInputAction, ctx: SpeechInputContext?): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        return AnActionEvent(null, context(ctx), "", presentation, ActionManager.getInstance(), 0)
    }

    private fun context(ctx: SpeechInputContext?): DataContext = DataContext { id ->
        if (PromptDataKeys.SPEECH.`is`(id)) ctx else null
    }

    private class FakeContext(
        override val isSpeechEnabled: Boolean,
    ) : SpeechInputContext {
        var toggles = 0

        override fun toggleSpeech() {
            toggles++
        }
    }
}
