package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Tests for [ToolView].
 */
@Suppress("UnstableApiUsage")
class ToolViewTest : BasePlatformTestCase() {

    // ---- state icons ------

    fun `test PENDING state shows hourglass icon`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.PENDING))
        assertTrue(view.labelText().contains("\u23F3"))  // ⏳
    }

    fun `test RUNNING state shows play icon`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        assertTrue(view.labelText().contains("\u25B6"))  // ▶
    }

    fun `test COMPLETED state shows checkmark icon`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.COMPLETED))
        assertTrue(view.labelText().contains("\u2713"))  // ✓
    }

    fun `test ERROR state shows cross icon`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.ERROR))
        assertTrue(view.labelText().contains("\u2717"))  // ✗
    }

    // ---- display text ------

    fun `test tool name shown when no title`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        assertTrue(view.labelText().contains("bash"))
    }

    fun `test title shown instead of name when title is set`() {
        val t = Tool("p1", "bash").also { it.state = ToolExecState.RUNNING; it.title = "Install deps" }
        val view = ToolView(t)
        assertTrue(view.labelText().contains("Install deps"))
        assertFalse(view.labelText().contains("bash"))
    }

    fun `test blank title falls back to tool name`() {
        val t = Tool("p1", "bash").also { it.state = ToolExecState.COMPLETED; it.title = "   " }
        val view = ToolView(t)
        assertTrue(view.labelText().contains("bash"))
    }

    // ---- update ------

    fun `test update changes state icon`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        val updated = Tool("p1", "bash").also { it.state = ToolExecState.COMPLETED }
        view.update(updated)
        assertTrue(view.labelText().contains("\u2713"))
        assertFalse(view.labelText().contains("\u25B6"))
    }

    fun `test update changes title`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING, title = "old"))
        val updated = Tool("p1", "bash").also { it.state = ToolExecState.COMPLETED; it.title = "new title" }
        view.update(updated)
        assertTrue(view.labelText().contains("new title"))
    }

    fun `test update with non-Tool content is ignored`() {
        val view = ToolView(tool("p1", "bash", ToolExecState.RUNNING))
        val before = view.labelText()
        view.update(ai.kilocode.client.session.model.Text("p1"))
        assertEquals(before, view.labelText())
    }

    // ---- contentId ------

    fun `test contentId matches Tool id`() {
        val view = ToolView(Tool("part99", "edit").also { it.state = ToolExecState.PENDING })
        assertEquals("part99", view.contentId)
    }

    // ---- helpers ------

    private fun tool(id: String, name: String, state: ToolExecState, title: String? = null): Tool =
        Tool(id, name).also { it.state = state; it.title = title }
}
