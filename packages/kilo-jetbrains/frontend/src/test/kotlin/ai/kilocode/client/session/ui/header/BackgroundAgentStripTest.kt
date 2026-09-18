package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.background.BackgroundAgent
import ai.kilocode.client.session.background.BackgroundAgentStatus
import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.RepaintManager
import javax.swing.ScrollPaneConstants

class BackgroundAgentStripTest : BasePlatformTestCase() {

    fun `test invisible and collapsed when there are no agents`() {
        val strip = strip()

        strip.update(emptyList())

        assertFalse(strip.isVisible)
        assertFalse(strip.expanded())
    }

    fun `test becomes visible with a row per agent once agents arrive`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, title = "Refactor")))
        click(strip.rowPanel())

        assertTrue(strip.isVisible)
        assertEquals(1, strip.rowCount())
        assertEquals("Refactor", strip.rowTitleText("job1"))
    }

    fun `test untitled agent falls back to a default title`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, title = null)))
        click(strip.rowPanel())

        assertEquals("Background Agent", strip.rowTitleText("job1"))
    }

    fun `test needs input badge follows the waiting flag`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, waiting = true)))
        click(strip.rowPanel())
        assertTrue(strip.rowNeedsInputVisible("job1"))

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, waiting = false)))
        assertFalse(strip.rowNeedsInputVisible("job1"))
    }

    fun `test clicking a row opens its session`() {
        val opened = mutableListOf<Pair<String, String>>()
        val strip = strip(onOpen = { session, title -> opened.add(session to title) })

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, title = "Refactor", session = "ses_child1")))
        click(strip.rowPanel())
        click(strip.agentRowPanel("job1")!!)

        assertEquals(listOf("ses_child1" to "Refactor"), opened)
    }

    fun `test clicking the title icon or status of a row opens its session`() {
        val opened = mutableListOf<String>()
        val strip = strip(onOpen = { session, _ -> opened.add(session) })
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, session = "ses_child1")))
        click(strip.rowPanel())
        val row = strip.agentRowPanel("job1")!!

        // Swing delivers a click only to the innermost listener, and hover tracking puts a listener
        // on every child — so each one must carry the open action, not just the row's padding.
        descendants(row).filter { it !== strip.rowActionButton("job1") }.forEach { click(it) }

        assertEquals(descendants(row).size - 1, opened.size)
        assertTrue(opened.all { it == "ses_child1" })
    }

    fun `test clicking the trailing action does not open the session`() {
        val opened = mutableListOf<String>()
        val dismissed = mutableListOf<Set<String>>()
        val strip = strip(onOpen = { session, _ -> opened.add(session) }, onDismiss = { dismissed.add(it) })
        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))
        click(strip.rowPanel())

        // A real click on the button must not also reach the row's open action: the button already
        // owns mouse listeners, so watch() must not have bound the open-click to it.
        click(strip.rowActionButton("job1")!!)
        assertTrue(opened.isEmpty())

        strip.rowActionButton("job1")!!.doClick()

        assertEquals(listOf(setOf("job1")), dismissed)
        assertTrue(opened.isEmpty())
    }

    private fun descendants(root: Component): List<Component> {
        val found = mutableListOf(root)
        if (root is java.awt.Container) root.components.forEach { found.addAll(descendants(it)) }
        return found
    }

    fun `test running row action stops that agent`() {
        val cancelled = mutableListOf<String>()
        val strip = strip(onCancel = { cancelled.add(it) })

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())
        strip.rowActionButton("job1")!!.doClick()

        assertEquals(listOf("job1"), cancelled)
    }

    fun `test finished row action dismisses only that agent`() {
        val dismissed = mutableListOf<Set<String>>()
        val strip = strip(onDismiss = { dismissed.add(it) })

        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))
        click(strip.rowPanel())
        strip.rowActionButton("job1")!!.doClick()

        assertEquals(listOf(setOf("job1")), dismissed)
    }

    fun `test stop all cancels only the running jobs`() {
        val cancelled = mutableListOf<List<String>>()
        val strip = strip(onCancelAll = { cancelled.add(it) })

        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING),
                agent("job2", BackgroundAgentStatus.COMPLETED),
                agent("job3", BackgroundAgentStatus.RUNNING),
            ),
        )

        assertTrue(strip.stopAllButton().isVisible)
        strip.stopAllButton().doClick()

        assertEquals(listOf(listOf("job1", "job3")), cancelled)
    }

    fun `test clear finished dismisses only the non-running jobs`() {
        val dismissed = mutableListOf<Set<String>>()
        val strip = strip(onDismiss = { dismissed.add(it) })

        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING),
                agent("job2", BackgroundAgentStatus.COMPLETED),
                agent("job3", BackgroundAgentStatus.CANCELLED),
            ),
        )

        assertTrue(strip.clearFinishedButton().isVisible)
        strip.clearFinishedButton().doClick()

        assertEquals(listOf(setOf("job2", "job3")), dismissed)
    }

    fun `test open all opens every visible agent`() {
        val opened = mutableListOf<String>()
        val strip = strip(onOpen = { session, _ -> opened.add(session) })

        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING, session = "ses1"),
                agent("job2", BackgroundAgentStatus.COMPLETED, session = "ses2"),
            ),
        )
        strip.openAllButton().doClick()

        assertEquals(listOf("ses1", "ses2"), opened)
    }

    fun `test action buttons are hidden when readonly`() {
        val strip = strip(readonly = true)

        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING),
                agent("job2", BackgroundAgentStatus.COMPLETED),
            ),
        )
        click(strip.rowPanel())

        assertFalse(strip.stopAllButton().isVisible)
        assertFalse(strip.clearFinishedButton().isVisible)
        assertFalse(strip.rowActionVisible("job1"))
        assertFalse(strip.rowActionVisible("job2"))
        // Reading a transcript is not a mutation — Open all stays available even read-only.
        assertTrue(strip.openAllButton().isVisible)
    }

    fun `test clicking anywhere on the summary row expands the strip`() {
        val strip = strip()
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))

        click(strip.rowComponent())
        assertTrue(strip.expanded())

        click(strip.labelComponent())
        assertFalse(strip.expanded())
    }

    fun `test clicking a trailing action does not toggle the strip`() {
        val strip = strip()
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))

        click(strip.stopAllButton())

        assertFalse(strip.expanded())
    }

    fun `test hovering an agent row paints the block hover fill`() {
        val row = hoverableRow()
        val base = row.background.rgb

        enter(row)

        assertEquals(SessionUiStyle.View.Surface.blockHoverBgColor().rgb, row.background.rgb)
        assertTrue(base != row.background.rgb)

        exit(row, 500, 500)

        assertEquals(base, row.background.rgb)
        assertEquals(SessionUiStyle.Colors.codeBlockBackground().rgb, row.background.rgb)
    }

    fun `test row stays lit while the pointer moves onto a child control`() {
        val row = hoverableRow()

        enter(row)
        // Swing delivers mouseExited to the row when the pointer reaches the trailing action
        // button; the row is still under the pointer, so the fill must survive.
        exit(row, 190, 12)

        assertEquals(SessionUiStyle.View.Surface.blockHoverBgColor().rgb, row.background.rgb)
    }

    fun `test hovering one row leaves the others unlit`() {
        val strip = strip()
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING), agent("job2", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())
        val first = strip.agentRowPanel("job1")!!.also { it.setSize(200, 24) }
        val second = strip.agentRowPanel("job2")!!.also { it.setSize(200, 24) }

        enter(first)

        assertEquals(SessionUiStyle.View.Surface.blockHoverBgColor().rgb, first.background.rgb)
        assertEquals(SessionUiStyle.Colors.codeBlockBackground().rgb, second.background.rgb)
    }

    private fun hoverableRow(): JComponent {
        val strip = strip()
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())
        return strip.agentRowPanel("job1")!!.also { it.setSize(200, 24) }
    }

    private fun enter(component: Component) {
        component.dispatchEvent(
            MouseEvent(component, MouseEvent.MOUSE_ENTERED, System.currentTimeMillis(), 0, 5, 5, 0, false),
        )
    }

    private fun exit(component: Component, x: Int, y: Int) {
        component.dispatchEvent(
            MouseEvent(component, MouseEvent.MOUSE_EXITED, System.currentTimeMillis(), 0, x, y, 0, false),
        )
    }

    fun `test cancelled agent shows a blank glyph sized like the other status icons`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))
        click(strip.rowPanel())
        val done = strip.rowStatusIcon("job1")!!

        strip.update(listOf(agent("job1", BackgroundAgentStatus.CANCELLED)))
        val cancelled = strip.rowStatusIcon("job1")!!

        // No glyph for a cancelled agent, but the slot keeps its width so titles stay aligned.
        assertTrue(cancelled is EmptyIcon)
        assertEquals(done.iconWidth, cancelled.iconWidth)
        assertEquals(done.iconHeight, cancelled.iconHeight)
    }

    fun `test error and completed agents keep their status glyphs`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.ERROR)))
        click(strip.rowPanel())

        assertFalse(strip.rowStatusIcon("job1") is EmptyIcon)
    }

    fun `test body scrolls horizontally without widening the header`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, title = "A".repeat(400))))
        click(strip.rowPanel())
        val scroll = strip.bodyComponent() as JBScrollPane

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED, scroll.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER, scroll.verticalScrollBarPolicy)
        // A very long title must not push the header wider than its container.
        assertEquals(0, scroll.preferredSize.width)
        assertEquals(0, scroll.minimumSize.width)
        assertTrue(scroll.maximumSize.width > 0)
        // Height still tracks the content so the expanded strip is not clipped vertically.
        assertEquals(scroll.preferredSize.height, scroll.maximumSize.height)
        assertTrue(scroll.preferredSize.height > 0)
        // The content itself stays at its full width inside the viewport, so it can be scrolled to.
        assertTrue(scroll.viewport.view.preferredSize.width > JBUI.scale(400))
    }

    fun `test repeated identical updates do not repaint the strip`() {
        val strip = strip()
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())
        val row = strip.agentRowPanel("job1")
        val body = strip.bodyComponent() as JComponent
        val repaint = TrackingRepaintManager(setOf(strip, body))
        val old = RepaintManager.currentManager(strip)

        try {
            RepaintManager.setCurrentManager(repaint)

            // SessionHeaderPanel re-syncs on every HeaderUpdated while tokens stream, so an
            // unchanged list must be a no-op rather than a revalidate/repaint of the whole strip.
            strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))

            assertTrue(repaint.dirty.isEmpty())
            assertTrue(repaint.invalid.isEmpty())
            assertSame(row, strip.agentRowPanel("job1"))
            assertEquals(1, strip.rowCount())
            assertTrue(strip.expanded())
        } finally {
            RepaintManager.setCurrentManager(old)
        }
    }

    private class TrackingRepaintManager(private val watched: Set<JComponent>) : RepaintManager() {
        val dirty = mutableListOf<JComponent>()
        val invalid = mutableListOf<JComponent>()

        override fun addDirtyRegion(c: JComponent, x: Int, y: Int, w: Int, h: Int) {
            if (c in watched) dirty.add(c)
            super.addDirtyRegion(c, x, y, w, h)
        }

        override fun addInvalidComponent(invalidComponent: JComponent) {
            if (invalidComponent in watched) invalid.add(invalidComponent)
            super.addInvalidComponent(invalidComponent)
        }
    }

    fun `test a status change is still applied after an identical update`() {
        val strip = strip()
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))

        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))

        assertEquals("Done", strip.rowStatusText("job1"))
    }

    fun `test finished agents drop below still-active ones`() {
        val strip = strip()
        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING),
                agent("job2", BackgroundAgentStatus.RUNNING),
            ),
        )
        click(strip.rowPanel())
        assertEquals(listOf("job1", "job2"), strip.rowOrder())

        // job1 finished, so BackgroundAgents.order puts the still-running job2 first; the existing
        // rows must be reordered, not left in their original slots.
        strip.update(
            ai.kilocode.client.session.background.BackgroundAgents.order(
                listOf(
                    agent("job1", BackgroundAgentStatus.COMPLETED),
                    agent("job2", BackgroundAgentStatus.RUNNING),
                ),
            ),
        )

        assertEquals(listOf("job2", "job1"), strip.rowOrder())
    }

    fun `test auto collapses once when the last active agent finishes`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())
        assertTrue(strip.expanded())

        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))
        assertFalse(strip.expanded())

        // Re-expanding to dismiss the finished row must not be undone by the next poll tick while
        // still at zero active agents.
        click(strip.rowPanel())
        assertTrue(strip.expanded())
        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))
        assertTrue(strip.expanded())
    }

    private fun strip(
        readonly: Boolean = false,
        onOpen: (String, String) -> Unit = { _, _ -> },
        onCancel: (String) -> Unit = {},
        onCancelAll: (List<String>) -> Unit = {},
        onDismiss: (Set<String>) -> Unit = {},
    ) = BackgroundAgentStrip(readonly, onOpen, onCancel, onCancelAll, onDismiss)

    private fun agent(
        job: String,
        status: BackgroundAgentStatus,
        title: String? = "Agent $job",
        waiting: Boolean = false,
        session: String = "${job}_session",
    ) = BackgroundAgent(job = job, session = session, title = title, status = status, waiting = waiting)

    private fun click(component: Component) {
        component.dispatchEvent(MouseEvent(component, MouseEvent.MOUSE_CLICKED, System.currentTimeMillis(), 0, 1, 1, 1, false))
    }
}
