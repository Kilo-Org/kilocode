package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.tool.ToolView
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class PlanExitViewTest : BasePlatformTestCase() {
    fun `test completed plan exit renders ready transcript text and path`() {
        val tool = tool(ToolExecState.COMPLETED).apply {
            metadata = mapOf("plan" to ".kilo/plans/x.md")
        }

        val view = PlanExitView(tool) {}

        assertEquals("Plan is ready [.kilo/plans/x.md](.kilo/plans/x.md)", view.markdown())
    }

    fun `test view factory replaces running tool with plan exit view when completed`() {
        val running = tool(ToolExecState.RUNNING)
        val existing = ViewFactory.create(running, {}) {}
        assertTrue(existing is ToolView)

        val done = tool(ToolExecState.COMPLETED).apply {
            metadata = mapOf("plan" to ".kilo/plans/x.md")
        }

        assertTrue(ViewFactory.shouldReplace(existing, done))
        assertTrue(ViewFactory.create(done, {}) {} is PlanExitView)
    }

    fun `test clicking plan link opens href`() {
        val opened = mutableListOf<String>()
        val tool = tool(ToolExecState.COMPLETED).apply {
            metadata = mapOf("plan" to ".kilo/plans/my%20plan.md")
        }

        val view = PlanExitView(tool) { opened.add(it) }
        view.simulateLink(".kilo/plans/my%20plan.md")

        assertEquals(listOf(".kilo/plans/my%20plan.md"), opened)
    }

    private fun tool(state: ToolExecState) = Tool("prt_plan", "plan_exit", toolKind("plan_exit")).apply {
        this.state = state
        output = "Plan is ready at .kilo/plans/x.md. Ending planning turn."
    }
}
