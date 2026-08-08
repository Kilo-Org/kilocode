package ai.kilocode.client.actions

import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.SendPromptContext
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class ToggleAutoApproveActionTest : BasePlatformTestCase() {
    fun `test action invokes prompt context`() {
        val ctx = FakeContext(false)
        val action = ToggleAutoApproveAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        action.actionPerformed(event)

        assertTrue(event.presentation.isEnabled)
        assertEquals(1, ctx.toggled)
        assertEquals("Toggle Auto-Approve", action.templatePresentation.text)
        assertEquals(
            "Toggle auto-approve mode for the current Kilo session",
            action.templatePresentation.description,
        )
    }

    fun `test update disables action without prompt context`() {
        val action = ToggleAutoApproveAction()
        val event = event(action, null)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    private fun event(action: ToggleAutoApproveAction, ctx: SendPromptContext?): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        return AnActionEvent.createFromDataContext("", presentation, context(ctx))
    }

    private fun context(ctx: SendPromptContext?): DataContext {
        return DataContext { id ->
            if (PromptDataKeys.SEND.`is`(id)) ctx else null
        }
    }

    private class FakeContext(
        override val isAutoApproveEnabled: Boolean,
    ) : SendPromptContext {
        override val isSendEnabled: Boolean = false
        override val isStopEnabled: Boolean = false
        var toggled = 0

        override fun send() {
        }

        override fun stop() {
        }

        override fun toggleAutoApprove() {
            toggled++
        }
    }
}
