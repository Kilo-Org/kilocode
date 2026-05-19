package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Tests for [PlanExitView] and [ViewFactory] routing for plan_exit tool parts.
 */
@Suppress("UnstableApiUsage")
class PlanExitViewTest : BasePlatformTestCase() {

    // ------ ViewFactory routing ------

    fun `test completed plan_exit creates PlanExitView`() {
        val tool = completedPlanExit("p1")
        val view = ViewFactory.create(tool)
        assertTrue("Expected PlanExitView for completed plan_exit", view is PlanExitView)
    }

    fun `test running plan_exit creates ToolView`() {
        val tool = Tool("p2", "plan_exit", toolKind("plan_exit")).also {
            it.state = ToolExecState.RUNNING
        }
        val view = ViewFactory.create(tool)
        assertTrue("Expected ToolView for running plan_exit", view is ToolView)
    }

    fun `test pending plan_exit creates ToolView`() {
        val tool = Tool("p3", "plan_exit", toolKind("plan_exit")).also {
            it.state = ToolExecState.PENDING
        }
        val view = ViewFactory.create(tool)
        assertTrue("Expected ToolView for pending plan_exit", view is ToolView)
    }

    // ------ PlanExitView dumpLabel ------

    fun `test PlanExitView dumpLabel contains Plan is ready`() {
        val view = PlanExitView(completedPlanExit("p4"))
        assertTrue("dumpLabel should contain 'Plan is ready'", view.dumpLabel().contains("Plan is ready"))
    }

    // ------ shouldReplace ------

    fun `test shouldReplace ToolView to PlanExitView when plan_exit completes`() {
        val running = Tool("p5", "plan_exit", toolKind("plan_exit")).also { it.state = ToolExecState.RUNNING }
        val completed = completedPlanExit("p5")
        val view = ToolView(running)
        assertTrue("Should replace ToolView with PlanExitView on completion", ViewFactory.shouldReplace(view, completed))
    }

    fun `test shouldReplace returns false for PlanExitView with still completed plan_exit`() {
        val tool = completedPlanExit("p6")
        val view = PlanExitView(tool)
        assertFalse("PlanExitView should not replace itself", ViewFactory.shouldReplace(view, completedPlanExit("p6")))
    }

    fun `test completed plan_exit uses PlanExitView not ToolView so raw output is not shown`() {
        val tool = Tool("p7", "plan_exit", toolKind("plan_exit")).also {
            it.state = ToolExecState.COMPLETED
            it.output = "Plan is ready at /tmp/PLAN.md. Ending planning turn."
        }
        val view = ViewFactory.create(tool)
        assertTrue("Completed plan_exit must use PlanExitView, not ToolView", view is PlanExitView)
        assertFalse("Completed plan_exit must not use ToolView", view is ToolView)
    }

    // ------ helpers ------

    private fun completedPlanExit(id: String) = Tool(id, "plan_exit", toolKind("plan_exit")).also {
        it.state = ToolExecState.COMPLETED
    }
}
