package ai.kilocode.client.actions

import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.SendPromptContext
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class StopSessionActionTest : BasePlatformTestCase() {
    fun `test action invokes prompt context`() {
        val ctx = FakeContext(true)
        val action = StopSessionAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        action.actionPerformed(event)

        assertTrue(event.presentation.isEnabled)
        assertEquals(1, ctx.stopped)
        assertEquals("Stop Session", action.templatePresentation.text)
        assertEquals("Stop the current Kilo session", action.templatePresentation.description)
    }

    fun `test update disables action without prompt context`() {
        val action = StopSessionAction()
        val event = event(action, null)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    fun `test update disables action when stop unavailable`() {
        val ctx = FakeContext(false)
        val action = StopSessionAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        action.actionPerformed(event)

        assertFalse(event.presentation.isEnabled)
        assertEquals(0, ctx.stopped)
    }

    private fun event(action: StopSessionAction, ctx: SendPromptContext?): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        return AnActionEvent.createFromDataContext("", presentation, context(ctx))
    }

    private fun context(ctx: SendPromptContext?): DataContext {
        return DataContext { id ->
            if (PromptDataKeys.SEND.`is`(id)) ctx else null
        }
    }

    private class FakeContext(
        override val isStopEnabled: Boolean,
    ) : SendPromptContext {
        override val isSendEnabled: Boolean = false
        var stopped = 0

        override fun send() {
        }

        override fun stop() {
            stopped++
        }
    }
}
