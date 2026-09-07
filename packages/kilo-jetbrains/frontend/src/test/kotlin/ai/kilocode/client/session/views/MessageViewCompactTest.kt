package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.views.tool.ReadToolView
import ai.kilocode.client.session.views.tool.TaskToolView
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class MessageViewCompactTest : BasePlatformTestCase() {

    override fun setUp() {
        super.setUp()
        unsetCompactSettings()
        KiloPluginSettings.setCompactMode(true)
    }

    override fun tearDown() {
        try {
            unsetCompactSettings()
        } finally {
            super.tearDown()
        }
    }

    fun `test a run of reads collapses into one group with no child renderers`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"), tool("t3", "read"))

        val group = single(view)
        assertEquals(ToolGroupKind.MERGED, group.kind)
        assertEquals(listOf("t1", "t2", "t3"), group.ids())
        assertEquals("collapsed group builds nothing", 0, group.attachedCount())
        // t1 rendered standalone before a second read revealed the run; that instance is retained but
        // detached rather than disposed mid-stream. Every tool after it is never built at all.
        assertNull(view.part("t2"))
        assertNull(view.part("t3"))
        assertNull("the migrated card is detached", view.part("t1")?.parent)
        assertEquals("only the group is a direct child", 1, view.componentCount)
    }

    // MIN_RUN is 2: a group wrapping one card costs a row and a click while hiding nothing.
    fun `test a lone tool stays a standalone card`() {
        val view = assistant()
        add(view, tool("t1", "read"))

        assertTrue(view.groupViews().isEmpty())
        assertTrue(view.part("t1") is ReadToolView)
    }

    fun `test the group forms only once the run reaches the minimum`() {
        val view = assistant()
        add(view, tool("t1", "read"))
        assertTrue(view.groupViews().isEmpty())

        add(view, tool("t2", "read"))
        val group = single(view)
        assertEquals(listOf("t1", "t2"), group.ids())
        // The first tool already had a renderer before the run was known; it is retained, not rebuilt.
        assertNotNull(view.part("t1"))
        assertNull(view.part("t2"))
    }

    fun `test text breaks a run into two groups`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        add(view, text("p1", "some prose"))
        add(view, tool("t3", "read"), tool("t4", "read"))

        assertEquals(2, view.groupViews().size)
        assertEquals(listOf("t1", "t2"), view.groupViews()[0].ids())
        assertEquals(listOf("t3", "t4"), view.groupViews()[1].ids())
        assertEquals(listOf("t1", "t2", "p1", "t3", "t4"), view.partIds())
    }

    fun `test reasoning breaks a run`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        add(view, Reasoning("r1").also { it.content.append("thinking") })
        add(view, tool("t3", "read"), tool("t4", "read"))

        assertEquals(2, view.groupViews().size)
    }

    // Shell dominates real transcripts. When its category is on it must merge with the reads around
    // it, or a bash-heavy session collapses nothing at all.
    fun `test shell merges into the surrounding run`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        add(view, tool("b1", "bash"))
        add(view, tool("t3", "read"), tool("t4", "read"))

        val group = single(view)
        assertEquals(listOf("t1", "t2", "b1", "t3", "t4"), group.ids())
    }

    fun `test a disabled other category breaks the run and renders shell standalone`() {
        KiloPluginSettings.setCompactGroupOther(false)
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        add(view, tool("b1", "bash"))
        add(view, tool("t3", "read"), tool("t4", "read"))

        assertEquals(2, view.groupViews().size)
        assertNotNull("shell renders as its own card once its category is off", view.part("b1"))
    }

    /**
     * Regression for a reported bash-heavy transcript that compact mode left completely uncollapsed:
     * shell was ungroupable *and* broke runs, so the two reads between shell calls each fell below
     * the minimum run and rendered standalone too. Every row must now fold into one card.
     */
    fun `test a shell heavy transcript collapses to a single group`() {
        val view = assistant()
        val names = listOf(
            "bash", "grep", "bash", "bash", "bash", "bash", "bash",
            "read", "bash", "bash", "bash", "bash", "bash", "bash", "bash",
        )
        names.forEachIndexed { index, name -> add(view, tool("t$index", name)) }

        val group = single(view)
        assertEquals(names.size, group.size)
        assertEquals("one card for the whole run", 1, view.componentCount)
    }

    fun `test a disabled category breaks the run and renders standalone`() {
        KiloPluginSettings.setCompactGroupWrites(false)
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        add(view, tool("e1", "edit"))
        add(view, tool("t3", "read"), tool("t4", "read"))

        assertEquals(2, view.groupViews().size)
        assertNotNull("edits render standalone once their category is off", view.part("e1"))
    }

    fun `test reads writes and web merge into one group`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("e1", "edit"), tool("w1", "websearch"))

        val group = single(view)
        assertEquals(ToolGroupKind.MERGED, group.kind)
        assertEquals(listOf("t1", "e1", "w1"), group.ids())
    }

    fun `test subagents split out of a merged run`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "bash"))
        add(view, tool("a1", "task"), tool("a2", "task"))
        add(view, tool("t3", "read"), tool("t4", "read"))

        val groups = view.groupViews()
        assertEquals(3, groups.size)
        assertEquals(ToolGroupKind.MERGED, groups[0].kind)
        assertEquals(ToolGroupKind.SUBAGENT, groups[1].kind)
        assertEquals(ToolGroupKind.MERGED, groups[2].kind)
        assertEquals(listOf("a1", "a2"), groups[1].ids())
    }

    // TaskToolView expands itself when child tools arrive. Inside a collapsed group no renderer
    // exists at all, so that self-expansion cannot drag the group open.
    fun `test a streaming subagent does not open its group`() {
        val view = assistant()
        val first = tool("a1", "task")
        val second = tool("a2", "task")
        add(view, first, second)

        second.childTools = listOf(tool("c1", "read"))
        view.upsertPart(second)

        val group = single(view)
        assertFalse("group stays collapsed while a subagent streams", group.isExpanded())
        assertEquals(0, group.attachedCount())
    }

    fun `test expanding a group builds its children and collapse retains them`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        val group = single(view)

        group.expand()
        val child = view.part("t1")
        assertNotNull(child)
        assertTrue(child is ReadToolView)
        assertEquals(2, group.attachedCount())

        group.collapse()
        assertEquals(0, group.attachedCount())
        group.expand()
        assertSame("re-expansion reuses the renderer", child, view.part("t1"))
    }

    fun `test a subagent child renders as a TaskToolView inside the group`() {
        val view = assistant()
        add(view, tool("a1", "task"), tool("a2", "task"))
        single(view).expand()

        assertTrue(view.part("a1") is TaskToolView)
    }

    fun `test turning compact off restores standalone cards`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"), tool("t3", "read"))
        assertEquals(1, view.groupViews().size)

        KiloPluginSettings.setCompactMode(false)
        assertTrue(view.syncCompact())

        assertTrue(view.groupViews().isEmpty())
        assertEquals(3, view.componentCount)
        for (id in listOf("t1", "t2", "t3")) assertNotNull(id, view.part(id))
    }

    fun `test turning compact back on regroups without rebuilding renderers`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        single(view).expand()
        val child = view.part("t1")

        KiloPluginSettings.setCompactMode(false)
        view.syncCompact()
        assertSame("compact off keeps the renderer", child, view.part("t1"))

        KiloPluginSettings.setCompactMode(true)
        view.syncCompact()
        single(view).expand()
        assertSame("compact on keeps the renderer", child, view.part("t1"))
    }

    fun `test a no-op sync reports no change`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        assertFalse("nothing moved, so nothing to relayout", view.syncCompact())
    }

    fun `test removing a grouped tool shrinks the group and drops it below the minimum`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"), tool("t3", "read"))

        view.removePart("t3")
        assertEquals(listOf("t1", "t2"), single(view).ids())

        view.removePart("t2")
        assertTrue("a one-tool run is no longer a group", view.groupViews().isEmpty())
        assertNotNull(view.part("t1"))
    }

    // Streaming a state change into an already-attached child must reuse that instance, not rebuild
    // it — the group's own update path only forwards to the child and refreshes the header.
    fun `test streaming into an attached grouped child reuses its renderer`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        val group = single(view)
        group.expand()
        val before = view.part("t2")
        assertNotNull(before)

        val tool = tools.getValue("t2")
        tool.state = ToolExecState.COMPLETED
        view.upsertPart(tool)

        assertSame("no rebuild on a plain state update", before, view.part("t2"))
        assertEquals("the run is unchanged", listOf("t1", "t2"), group.ids())
        assertEquals(2, group.attachedCount())
    }

    fun `test user messages never group`() {
        val msg = Message(MessageDto("m1", "ses", "user", MessageTimeDto(0.0)))
        val view = MessageView(msg, openFile = { _, _ -> })
        Disposer.register(testRootDisposable, view)
        add(view, text("p1", "do it"))
        add(view, tool("e1", "edit"), tool("e2", "edit"))

        assertTrue("prompt bubbles and attachments are not a tool run", view.groupViews().isEmpty())
    }

    fun `test a group's error state surfaces in its header`() {
        val view = assistant()
        add(view, tool("t1", "read"), tool("t2", "read"))
        val failing = tools.getValue("t2")
        failing.state = ToolExecState.ERROR
        view.upsertPart(failing)

        val group = single(view)
        assertEquals(
            KiloBundle.message("session.group.tools.running.failed", 2, 1),
            group.caption(),
        )
        assertFalse("a failure does not force the group open", group.isExpanded())
        assertEquals("nor does it build the children", 0, group.attachedCount())
    }

    private val tools = LinkedHashMap<String, Tool>()

    private fun assistant(): MessageView {
        val msg = Message(MessageDto("m1", "ses", "assistant", MessageTimeDto(0.0)))
        return MessageView(msg, openFile = { _, _ -> }).also { Disposer.register(testRootDisposable, it) }
    }

    private fun single(view: MessageView): ToolGroupView {
        val groups = view.groupViews()
        assertEquals("expected exactly one group", 1, groups.size)
        return groups.first()
    }

    private fun add(view: MessageView, vararg items: Content) {
        items.forEach { view.upsertPart(it) }
    }

    private fun text(id: String, value: String) = Text(id).also { it.content.append(value) }

    private fun tool(id: String, name: String): Tool = tools.getOrPut(id) {
        Tool(id, name, toolKind(name)).also { it.state = ToolExecState.RUNNING }
    }
}
