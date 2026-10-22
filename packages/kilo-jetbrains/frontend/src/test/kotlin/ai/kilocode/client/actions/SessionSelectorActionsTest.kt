package ai.kilocode.client.actions

import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.mode.ModePicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.prompt.PromptDataKeys
import ai.kilocode.client.session.ui.prompt.PromptSelectors
import ai.kilocode.rpc.dto.ModelSelectionDto
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class SessionSelectorActionsTest : BasePlatformTestCase() {

    fun `test cycle mode action advances the mode picker`() {
        val ctx = FakeSelectors()
        ctx.mode.setItems(listOf(ModePicker.Item("ask", "Ask"), ModePicker.Item("code", "Code")), "ask")
        val action = CycleModeAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        assertTrue(event.presentation.isEnabled)
        action.actionPerformed(event)

        assertEquals("code", ctx.mode.selectedForTest()?.id)
        assertEquals("Cycle Mode", action.templatePresentation.text)
        assertEquals("Switch to the next Kilo mode", action.templatePresentation.description)
    }

    fun `test cycle mode action disabled with a single mode`() {
        val ctx = FakeSelectors()
        ctx.mode.setItems(listOf(ModePicker.Item("ask", "Ask")), "ask")
        val action = CycleModeAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    fun `test cycle model action advances the model picker`() {
        val ctx = FakeSelectors()
        ctx.model.favorites = { listOf(ModelSelectionDto("openai", "a"), ModelSelectionDto("openai", "b")) }
        ctx.model.setItems(
            listOf(
                ModelPicker.Item("a", "A", "openai", "OpenAI"),
                ModelPicker.Item("b", "B", "openai", "OpenAI"),
            ),
            "openai/a",
        )
        val action = CycleModelAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        assertTrue(event.presentation.isEnabled)
        action.actionPerformed(event)

        assertEquals("openai/b", ctx.model.selectionKeyForTest())
    }

    fun `test cycle model action disabled without favorites or recommended models`() {
        val ctx = FakeSelectors()
        ctx.model.setItems(listOf(ModelPicker.Item("a", "A", "openai", "OpenAI")), "openai/a")
        val action = CycleModelAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    fun `test cycle reasoning action advances the reasoning picker`() {
        val ctx = FakeSelectors()
        ctx.reasoning.setItems(listOf(ReasoningPicker.Item("low", "Low"), ReasoningPicker.Item("high", "High")), "low")
        val action = CycleReasoningAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        assertTrue(event.presentation.isEnabled)
        action.actionPerformed(event)

        assertEquals("high", ctx.reasoning.selectedForTest()?.id)
    }

    fun `test cycle reasoning action disabled when hidden`() {
        val ctx = FakeSelectors()
        val action = CycleReasoningAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    fun `test reset model action clears the override when resettable`() {
        val ctx = FakeSelectors().apply { resettable = true }
        val action = ResetModelAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        assertTrue(event.presentation.isEnabled)
        action.actionPerformed(event)

        assertEquals(1, ctx.resetCount)
    }

    fun `test reset model action disabled without an override`() {
        val ctx = FakeSelectors()
        val action = ResetModelAction()
        val event = event(action, ctx)

        ActionUtil.updateAction(action, event)
        action.actionPerformed(event)

        assertFalse(event.presentation.isEnabled)
        assertEquals(0, ctx.resetCount)
    }

    fun `test update disables actions without a selectors context`() {
        val action = CycleModeAction()
        val event = event(action, null)

        ActionUtil.updateAction(action, event)

        assertFalse(event.presentation.isEnabled)
    }

    fun `test promote wins over other actions when enabled`() {
        val ctx = FakeSelectors()
        ctx.mode.setItems(listOf(ModePicker.Item("ask", "Ask"), ModePicker.Item("code", "Code")), "ask")
        val action = CycleModeAction()
        val other = NoopAction()
        val dataContext = context(ctx)

        val promoted = action.promote(listOf(other, action), dataContext)

        assertEquals(listOf(action), promoted)
    }

    fun `test promote yields nothing when disabled`() {
        val ctx = FakeSelectors()
        val action = CycleReasoningAction()
        val other = NoopAction()
        val dataContext = context(ctx)

        val promoted = action.promote(listOf(other, action), dataContext)

        assertEquals(emptyList<AnAction>(), promoted)
    }

    private fun event(action: AnAction, ctx: PromptSelectors?): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        return AnActionEvent.createFromDataContext("", presentation, context(ctx))
    }

    private fun context(ctx: PromptSelectors?): DataContext {
        return DataContext { id ->
            if (PromptDataKeys.SELECTORS.`is`(id)) ctx else null
        }
    }

    private class NoopAction : AnAction() {
        override fun actionPerformed(e: AnActionEvent) {}
    }

    private class FakeSelectors : PromptSelectors {
        override val mode = ModePicker()
        override val model = ModelPicker()
        override val reasoning = ReasoningPicker()
        override var resettable: Boolean = false
        var resetCount = 0

        override fun resetModel() {
            resetCount++
        }
    }
}
