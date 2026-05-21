package ai.kilocode.client.actions

import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.SendPromptContext
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class SendPromptActionTest : BasePlatformTestCase() {
    fun `test action invokes prompt context`() {
        val ctx = FakeContext(true)
        val action = SendPromptAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        action.actionPerformed(event)

        assertTrue(event.presentation.isEnabled)
        assertEquals(1, ctx.sent)
        assertEquals("Send Prompt", action.templatePresentation.text)
        assertEquals("Send the current Kilo prompt", action.templatePresentation.description)
    }

    fun `test update disables action without prompt context`() {
        val action = SendPromptAction()
        val event = event(action, null)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    fun `test update disables action when send unavailable`() {
        val ctx = FakeContext(false)
        val action = SendPromptAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        action.actionPerformed(event)

        assertFalse(event.presentation.isEnabled)
        assertEquals(0, ctx.sent)
    }

    fun `test promote only returns action when prompt can send`() {
        val action = SendPromptAction()
        val enabled = context(FakeContext(true))
        val disabled = context(FakeContext(false))
        val absent = context(null)

        assertEquals(listOf(action), action.promote(listOf(action), enabled))
        assertTrue(action.promote(listOf(action), disabled).isEmpty())
        assertTrue(action.promote(listOf(action), absent).isEmpty())
    }

    private fun event(action: SendPromptAction, ctx: SendPromptContext?): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        return AnActionEvent.createFromDataContext("", presentation, context(ctx))
    }

    private fun context(ctx: SendPromptContext?): DataContext {
        return DataContext { id ->
            if (PromptDataKeys.SEND.`is`(id)) ctx else null
        }
    }

    private class FakeContext(
        override val isSendEnabled: Boolean,
    ) : SendPromptContext {
        override val isStopEnabled: Boolean = false
        var sent = 0

        override fun send() {
            sent++
        }

        override fun stop() {
        }
    }

}
