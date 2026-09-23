package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.AgentAvatar
import ai.kilocode.client.session.background.BackgroundAgent
import ai.kilocode.client.session.background.BackgroundAgentStatus
import ai.kilocode.client.session.background.BackgroundAgents
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.HoverArea
import ai.kilocode.client.ui.UiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.event.MouseEvent
import java.awt.image.BufferedImage
import javax.accessibility.AccessibleAction
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.RepaintManager
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities

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

    private fun compactControls(strip: BackgroundAgentStrip): List<HoverArea> =
        descendants(strip.rowComponent()).filterIsInstance<HoverArea>()

    private fun compactAgents(strip: BackgroundAgentStrip): List<HoverArea> = compactControls(strip).filter {
        it.accessibleContext.accessibleName?.startsWith("Open background agent ") == true
    }

    private fun aggregate(strip: BackgroundAgentStrip, panel: JComponent): Component {
        var component: Component = strip.labelComponent()
        while (component.parent !== panel) component = component.parent
        return component
    }

    private fun fixed(component: JComponent, width: Int) {
        component.minimumSize = JBUI.size(0, 24)
        component.preferredSize = JBUI.size(width, 24)
        component.maximumSize = JBUI.size(width, 24)
    }

    private fun action(area: HoverArea): AccessibleAction = area.accessibleContext.accessibleAction

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

    fun `test collapsed preview shows a fitting prefix and overflow expands the strip`() {
        val opened = mutableListOf<String>()
        val strip = strip(onOpen = { session, _ -> opened.add(session) })
        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING, title = "Analyze APIs", session = "ses1"),
                agent("job2", BackgroundAgentStatus.RUNNING, title = "Inspect APIs", session = "ses2"),
                agent("job3", BackgroundAgentStatus.COMPLETED, title = "Write tests", session = "ses3"),
            ),
        )
        val agents = compactAgents(strip)
        val more = compactControls(strip).single { it !in agents }
        agents.forEach { fixed(it, 80) }
        val label = more.content as JBLabel
        label.text = "+2 more"
        val panel = agents.first().parent as JComponent
        panel.setSize(agents.first().preferredSize.width + UiStyle.Gap.sm() + more.preferredSize.width, panel.preferredSize.height)

        layoutTree(panel)

        assertTrue(agents[0].isVisible)
        assertFalse(agents[1].isVisible)
        assertFalse(agents[2].isVisible)
        assertTrue(more.isVisible)
        assertEquals("+2 more", label.text)
        assertEquals("Show 2 more background agents", more.accessibleContext.accessibleName)

        assertTrue(action(agents[0]).doAccessibleAction(0))
        assertEquals(listOf("ses1"), opened)
        assertFalse(strip.expanded())

        assertTrue(action(more).doAccessibleAction(0))
        assertTrue(strip.expanded())
        assertEquals("2 of 3 background agents running", (strip.labelComponent() as JBLabel).text)
        assertTrue(aggregate(strip, panel).isVisible)
        assertTrue(agents.none { it.isVisible })
        assertFalse(more.isVisible)

        click(strip.labelComponent())
        assertFalse(strip.expanded())
        assertTrue(agents[0].isVisible)
        assertTrue(more.isVisible)
    }

    fun `test collapsed preview uses all-fit and aggregate fallback without replacing controls`() {
        val strip = strip()
        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING, title = "One"),
                agent("job2", BackgroundAgentStatus.RUNNING, title = "Two"),
                agent("job3", BackgroundAgentStatus.COMPLETED, title = "Three"),
            ),
        )
        val agents = compactAgents(strip)
        val more = compactControls(strip).single { it !in agents }
        agents.forEach { fixed(it, 60) }
        val panel = agents.first().parent as JComponent
        val aggregate = aggregate(strip, panel)
        val natural = agents.sumOf { it.preferredSize.width } + UiStyle.Gap.sm() * (agents.size - 1)
        panel.setSize(natural, panel.preferredSize.height)

        layoutTree(panel)

        assertTrue(agents.all { it.isVisible })
        assertFalse(more.isVisible)
        assertFalse(aggregate.isVisible)
        val preferred = panel.preferredSize

        (more.content as JBLabel).text = "+2 more"
        panel.setSize(more.preferredSize.width, panel.preferredSize.height)
        layoutTree(panel)

        assertTrue(aggregate.isVisible)
        assertTrue(agents.none { it.isVisible })
        assertFalse(more.isVisible)
        assertEquals(preferred, panel.preferredSize)

        panel.setSize(natural, panel.preferredSize.height)
        layoutTree(panel)
        assertTrue(agents.all { it.isVisible })
        assertEquals(agents, compactAgents(strip))
    }

    fun `test compact preview retains controls while following active-first order`() {
        val strip = strip()
        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING, title = "First"),
                agent("job2", BackgroundAgentStatus.RUNNING, title = "Second"),
            ),
        )
        val before = compactAgents(strip)

        strip.update(
            listOf(
                agent("job2", BackgroundAgentStatus.RUNNING, title = "Second"),
                agent("job1", BackgroundAgentStatus.COMPLETED, title = "First finished"),
            ),
        )
        val after = compactAgents(strip)

        assertSame(before[1], after[0])
        assertSame(before[0], after[1])
        assertEquals("Open background agent First finished", after[1].accessibleContext.accessibleName)
    }

    fun `test compact preview never displaces east actions`() {
        val strip = strip()
        strip.update((1..6).map { agent("job$it", BackgroundAgentStatus.RUNNING, title = "Agent ${"x".repeat(40)}") })
        val row = strip.rowComponent()
        row.setSize(400, row.preferredSize.height)

        layoutTree(row)

        val action = strip.openAllButton()
        val right = SwingUtilities.convertPoint(action, action.width, 0, row).x
        val panel = compactAgents(strip).first().parent as JComponent
        val edge = SwingUtilities.convertPoint(panel, panel.width, 0, row).x
        val actionX = SwingUtilities.convertPoint(action, 0, 0, row).x
        assertTrue(right <= row.width)
        assertTrue(edge <= actionX)
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

    fun `test cancelled agent shows no status glyph and reclaims its slot`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.CANCELLED)))
        click(strip.rowPanel())

        assertNull(strip.rowStatusIcon("job1"))
        assertFalse(strip.rowStatusGlyphVisible("job1"))
    }

    fun `test error and completed agents keep their status glyphs`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.ERROR)))
        click(strip.rowPanel())

        assertFalse(strip.rowStatusIcon("job1") is EmptyIcon)
    }

    fun `test running agent hides the redundant terminal status glyph`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())

        assertFalse(strip.rowStatusGlyphVisible("job1"))

        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))

        assertTrue(strip.rowStatusGlyphVisible("job1"))
    }

    fun `test different agents get different generated avatars`() {
        val strip = strip()

        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING, session = "ses_a"),
                agent("job2", BackgroundAgentStatus.RUNNING, session = "ses_b"),
            ),
        )
        click(strip.rowPanel())

        assertNotSame(strip.rowAvatarIcon("job1"), strip.rowAvatarIcon("job2"))
    }

    fun `test avatar swaps from running to static when the agent finishes, then stays retained`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())
        val running = strip.rowAvatarIcon("job1")

        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))
        val done = strip.rowAvatarIcon("job1")
        assertNotSame(running, done)

        // Re-applying the same terminal status reuses the retained static icon.
        strip.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED)))
        assertSame(done, strip.rowAvatarIcon("job1"))
    }

    fun `test waiting for input keeps the agent avatar animated, not a blank glyph`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, waiting = true)))
        click(strip.rowPanel())

        assertFalse(strip.rowAvatarIcon("job1") is EmptyIcon)
    }

    fun `test a custom avatar color resolver changes the generated identity`() {
        val id = "ses_child"
        val colored = strip(avatarColor = { 3 })
        colored.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED, session = id)))
        click(colored.rowPanel())

        val hashed = strip()
        hashed.update(listOf(agent("job1", BackgroundAgentStatus.COMPLETED, session = id)))
        click(hashed.rowPanel())

        assertPixelsEqual(AgentAvatar.static(id, 3), colored.rowAvatarIcon("job1")!!)
        assertFalse(pixels(hashed.rowAvatarIcon("job1")!!).contentEquals(pixels(colored.rowAvatarIcon("job1")!!)))
    }

    fun `test body scrolls vertically and tracks the viewport width instead of widening the header`() {
        val strip = strip()

        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, title = "A".repeat(400))))
        click(strip.rowPanel())
        val scroll = strip.bodyComponent() as JBScrollPane

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, scroll.horizontalScrollBarPolicy)
        assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, scroll.verticalScrollBarPolicy)
        assertTrue(scroll.viewport.view is javax.swing.Scrollable)
        assertTrue((scroll.viewport.view as javax.swing.Scrollable).getScrollableTracksViewportWidth())
        assertEquals(0, scroll.preferredSize.width)
        assertEquals(0, scroll.minimumSize.width)

        // A very long title must not push the row (or the header) wider than the viewport gives it.
        // (Its unconstrained *preferred* width still reports the full title — that is ordinary Swing
        // behavior for an unclipped label — so this only asserts the actual, laid-out width.)
        val body = scroll.viewport.view as JComponent
        body.setSize(JBUI.scale(400), body.preferredSize.height)
        body.doLayout()
        val row = strip.agentRowPanel("job1")!!
        assertEquals(body.width - body.insets.left - body.insets.right, row.width)
    }

    fun `test a long title does not push the trailing action past the row's east edge`() {
        val strip = strip()
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING, title = "A".repeat(400))))
        click(strip.rowPanel())

        val body = (strip.bodyComponent() as JBScrollPane).viewport.view as JComponent
        body.setSize(JBUI.scale(400), body.preferredSize.height)
        layoutTree(body)
        val row = strip.agentRowPanel("job1")!!
        val action = strip.rowActionButton("job1")!!
        val actionRight = javax.swing.SwingUtilities.convertPoint(action, action.width, 0, row).x

        assertTrue(actionRight <= row.width)
        assertTrue(actionRight > row.width - JBUI.scale(60))
    }

    fun `test icon, title, and action are vertically centered on the row`() {
        val strip = strip()
        strip.update(listOf(agent("job1", BackgroundAgentStatus.RUNNING)))
        click(strip.rowPanel())

        val body = (strip.bodyComponent() as JBScrollPane).viewport.view as JComponent
        body.setSize(JBUI.scale(400), body.preferredSize.height)
        layoutTree(body)
        val row = strip.agentRowPanel("job1")!!

        val avatarCenterY = componentCenterY(strip.rowAvatarComponent("job1")!!, row)
        val actionCenterY = componentCenterY(strip.rowActionButton("job1")!!, row)
        val rowCenterY = row.height / 2

        assertTrue(Math.abs(rowCenterY - avatarCenterY) <= 1)
        assertTrue(Math.abs(rowCenterY - actionCenterY) <= 1)
    }

    fun `test five rows fit before the strip scrolls, a sixth does not`() {
        val strip = strip()
        strip.update((1..6).map { agent("job$it", BackgroundAgentStatus.RUNNING) })
        click(strip.rowPanel())

        // `JViewport.preferredSize` does not consult `Scrollable`; only `JScrollPane`'s own layout
        // (`ScrollPaneLayout`) does, which is what actually caps the expanded strip's height.
        val scroll = strip.bodyComponent() as JBScrollPane
        val viewportHeight = scroll.preferredSize.height
        val body = scroll.viewport.view as JComponent
        body.setSize(body.preferredSize.width, body.preferredSize.height)
        body.doLayout()

        val fifthBottom = strip.agentRowPanel("job5")!!.let { it.y + it.height }
        val sixth = strip.agentRowPanel("job6")!!

        // The fifth row fits entirely within the capped viewport height; the sixth row's bottom
        // edge extends past it (a few pixels of it may still peek into the shared bottom padding),
        // so it is not fully visible without scrolling.
        assertTrue(fifthBottom <= viewportHeight)
        assertTrue(sixth.y + sixth.height > viewportHeight)
        assertTrue(body.preferredSize.height > viewportHeight)
    }

    private fun componentCenterY(component: Component, ancestor: JComponent): Int =
        javax.swing.SwingUtilities.convertPoint(component, component.width / 2, component.height / 2, ancestor).y

    /**
     * `Container.doLayout()` only positions direct children; it does not cascade into their own
     * layout managers the way `validate()` would. Geometry assertions that reach past the immediate
     * child (e.g. a row's own avatar/action inside its `BorderLayout`) need every level laid out
     * top-down, since each level's layout depends on the size its parent just assigned it.
     */
    private fun layoutTree(component: Component) {
        if (component !is java.awt.Container) return
        component.doLayout()
        component.components.forEach { layoutTree(it) }
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
        assertTrue(laidOutY(strip, "job1") < laidOutY(strip, "job2"))

        // job1 finished, so BackgroundAgents.order puts the still-running job2 first; the existing
        // rows must move, not keep their original slots.
        strip.update(
            BackgroundAgents.order(
                listOf(
                    agent("job1", BackgroundAgentStatus.COMPLETED),
                    agent("job2", BackgroundAgentStatus.RUNNING),
                ),
            ),
        )

        assertTrue(laidOutY(strip, "job2") < laidOutY(strip, "job1"))
    }

    /**
     * Real laid-out position of a row. Asserting against the layout output rather than the AWT
     * component array matters here: [ai.kilocode.client.ui.layout.Stack] lays out from its own entry
     * list, so the component array can disagree with what the user actually sees.
     */
    private fun laidOutY(strip: BackgroundAgentStrip, job: String): Int {
        val body = (strip.bodyComponent() as JBScrollPane).viewport.view as JComponent
        body.setSize(JBUI.scale(400), body.preferredSize.height)
        body.doLayout()
        return strip.agentRowPanel(job)!!.y
    }

    fun `test stopping agents does not collapse the expanded strip`() {
        val cancelled = mutableListOf<String>()
        val cancelledAll = mutableListOf<List<String>>()
        val strip = strip(onCancel = cancelled::add, onCancelAll = cancelledAll::add)

        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.RUNNING),
                agent("job2", BackgroundAgentStatus.RUNNING),
            ),
        )
        click(strip.rowPanel())
        assertTrue(strip.expanded())

        strip.rowActionButton("job1")!!.doClick()
        assertEquals(listOf("job1"), cancelled)
        assertTrue(strip.expanded())
        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.CANCELLED),
                agent("job2", BackgroundAgentStatus.RUNNING),
            ),
        )
        assertTrue(strip.expanded())

        strip.stopAllButton().doClick()
        assertEquals(listOf(listOf("job2")), cancelledAll)
        assertTrue(strip.expanded())
        strip.update(
            listOf(
                agent("job1", BackgroundAgentStatus.CANCELLED),
                agent("job2", BackgroundAgentStatus.CANCELLED),
            ),
        )
        assertTrue(strip.expanded())
    }

    private fun strip(
        readonly: Boolean = false,
        onOpen: (String, String) -> Unit = { _, _ -> },
        onCancel: (String) -> Unit = {},
        onCancelAll: (List<String>) -> Unit = {},
        onDismiss: (Set<String>) -> Unit = {},
        avatarColor: (String) -> Int? = { null },
    ) = BackgroundAgentStrip(readonly, onOpen, onCancel, onCancelAll, onDismiss, avatarColor)

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

    private fun assertPixelsEqual(expected: Icon, actual: Icon) {
        assertTrue(pixels(expected).contentEquals(pixels(actual)))
    }

    private fun pixels(icon: Icon): IntArray {
        val image = BufferedImage(icon.iconWidth, icon.iconHeight, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            icon.paintIcon(null, g, 0, 0)
        } finally {
            g.dispose()
        }
        return image.getRGB(0, 0, image.width, image.height, null, 0, image.width)
    }
}
