package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.session.views.tool.ToolView
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class ToolGroupViewTest : BasePlatformTestCase() {

    private val built = mutableListOf<String>()
    private val cache = HashMap<String, PartView>()
    private val tools = LinkedHashMap<String, Tool>()

    override fun tearDown() {
        try {
            cache.values.forEach { Disposer.dispose(it) }
            cache.clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test collapsed group builds no children`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))

        assertFalse(group.isExpanded())
        assertEquals(0, group.attachedCount())
        assertEquals("collapsed group builds nothing", emptyList<String>(), built)
    }

    fun `test first expansion builds each child once and collapse detaches them`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))

        assertTrue(group.expand())
        assertEquals(2, group.attachedCount())
        assertEquals(listOf("a", "b"), built)
        val first = group.attachedView("a")
        assertNotNull(first)

        assertTrue(group.collapse())
        assertFalse(group.isExpanded())
        assertEquals(0, group.attachedCount())

        assertTrue(group.expand())
        assertEquals("re-expansion reuses the instance", 2, built.size)
        assertSame(first, group.attachedView("a"))
    }

    fun `test isExpanded agrees with containment`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))
        assertFalse(group.isExpanded())
        group.expand()
        assertTrue(group.isExpanded())
        group.collapse()
        assertFalse(group.isExpanded())
    }

    fun `test updates while collapsed do not build children`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))

        tools.getValue("a").state = ToolExecState.COMPLETED
        group.note(tools.getValue("a"))
        tools.getValue("b").state = ToolExecState.ERROR
        group.note(tools.getValue("b"))

        assertEquals(emptyList<String>(), built)
        assertEquals(0, group.attachedCount())
    }

    fun `test merged header reports running then done then failure`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))
        assertEquals(KiloBundle.message("session.group.tools.running", 2), group.caption())

        complete("a", "b")
        group.note(tools.getValue("a"))
        group.note(tools.getValue("b"))
        assertEquals(KiloBundle.message("session.group.tools", 2), group.caption())

        tools.getValue("b").state = ToolExecState.ERROR
        group.note(tools.getValue("b"))
        assertEquals(KiloBundle.message("session.group.tools.failed", 2, 1), group.caption())
    }

    fun `test subagent header reports running then finished then failure`() {
        val group = group(ToolGroupKind.SUBAGENT, tool("a", "task"), tool("b", "task"), tool("c", "task"), tool("d", "task"))
        assertEquals(KiloBundle.message("session.group.subagents.running", 4), group.caption())

        complete("a", "b", "c", "d")
        tools.values.forEach { group.note(it) }
        assertEquals(KiloBundle.message("session.group.subagents", 4), group.caption())

        tools.getValue("d").state = ToolExecState.ERROR
        group.note(tools.getValue("d"))
        assertEquals(KiloBundle.message("session.group.subagents.failed", 3, 1), group.caption())
    }

    // The header summarises the run, so only a change to that summary is worth a repaint. One of two
    // tools finishing leaves the group "running"; the last one finishing is what moves the line.
    fun `test only a change to the summary reports a change`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))

        complete("a")
        assertFalse("still running, so the summary is unchanged", group.note(tools.getValue("a")))
        assertFalse("repeating it changes nothing either", group.note(tools.getValue("a")))

        complete("b")
        assertTrue("the run settling changes the summary", group.note(tools.getValue("b")))
        assertFalse(group.note(tools.getValue("b")))
    }

    fun `test a failure shows through while the run is still working`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))
        tools.getValue("b").state = ToolExecState.ERROR

        assertTrue(group.note(tools.getValue("b")))
        assertEquals(KiloBundle.message("session.group.tools.running.failed", 2, 1), group.caption())
    }

    fun `test collapsed group offers no hover preview`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))
        assertNull("building a preview would build the children the group avoids", group.headerPopup())
    }

    fun `test dropping an id shrinks the group`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"), tool("c", "read"))
        assertEquals(3, group.size)
        assertTrue(group.drop("b"))
        assertEquals(2, group.size)
        assertEquals(listOf("a", "c"), group.ids())
        assertFalse("dropping an unknown id is a no-op", group.drop("zz"))
    }

    fun `test a late arrival keeps run order in the expanded body`() {
        val group = group(ToolGroupKind.MERGED, tool("a", "read"), tool("b", "read"))
        group.expand()
        group.note(tool("c", "read"))

        assertEquals(listOf("a", "b", "c"), group.ids())
        assertEquals(3, group.attachedCount())
    }

    private fun complete(vararg ids: String) {
        ids.forEach { tools.getValue(it).state = ToolExecState.COMPLETED }
    }

    private fun tool(id: String, name: String): Tool {
        val item = tools[id] ?: Tool(id, name, toolKind(name)).also {
            it.state = ToolExecState.RUNNING
            tools[id] = it
        }
        return item
    }

    private fun group(kind: ToolGroupKind, vararg items: Tool): ToolGroupView {
        val view = ToolGroupView("group:test:${items.first().id}", kind, ::child)
        Disposer.register(testRootDisposable, view)
        items.forEach { view.note(it) }
        return view
    }

    private fun child(id: String): PartView? {
        cache[id]?.let { return it }
        val tool = tools[id] ?: return null
        built.add(id)
        return renderer(tool).also { cache[id] = it }
    }

    private fun renderer(tool: Tool): PartView = ToolView(tool)
}
