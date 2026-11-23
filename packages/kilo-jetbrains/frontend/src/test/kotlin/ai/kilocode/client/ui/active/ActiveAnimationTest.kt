package ai.kilocode.client.ui.active

import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.ui.AnimationIcon
import ai.kilocode.client.ui.LiveBadgeIcon
import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Point
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JViewport
import javax.swing.RepaintManager

class ActiveAnimationTest : BasePlatformTestCase() {
    fun `test one timer repaints each animated row only at its own deadline`() = edtWait {
        val fast = row("fast", 0, 100)
        val slow = row("slow", 20, 150)
        Scene(listOf(fast, slow, row("static", 40), row("offscreen", 80, 50))).use { scene ->
            scene.attach()
            assertEquals(1, scene.timers.pending)
            val regions = dirty(scene.host) {
                scene.timers.advanceBy(99)
                assertEquals(emptyList<Rectangle>(), it)
                scene.timers.advanceBy(1)
                assertEquals(listOf(fast.bounds), it)
                scene.timers.advanceBy(49)
                assertEquals(listOf(fast.bounds), it)
                scene.timers.advanceBy(1)
                assertEquals(listOf(fast.bounds, slow.bounds), it)
                scene.timers.advanceBy(50)
                assertEquals(listOf(fast.bounds, slow.bounds, fast.bounds), it)
                scene.timers.advanceBy(100)
                assertEquals(1, scene.timers.pending)
            }
            assertEquals(listOf(fast.bounds, slow.bounds, fast.bounds, fast.bounds, slow.bounds), regions)
        }
    }

    fun `test timer ticks reuse visible candidates without reading static membership`() = edtWait {
        var reads = 0
        val still = object : ActiveItem {
            override val key = "static"
            override val title = key
            override val icon: Icon
                get() {
                    reads++
                    return EmptyIcon.ICON_16
                }
        }
        val animated = row("animated", 0, 50)
        Scene(listOf(animated, ActiveAnimation.Row(still, Rectangle(0, 20, 100, 20), false))).use { scene ->
            scene.attach()
            val calls = scene.calls
            val baseline = reads
            assertTrue(baseline > 0)
            assertEquals(Rectangle(0, 0, 100, 60), scene.clips.last())
            val regions = dirty(scene.host) {
                repeat(8) {
                    scene.timers.advanceBy(50)
                    assertEquals(1, scene.timers.pending)
                }
            }
            assertEquals(List(8) { animated.bounds }, regions)
            assertEquals("Ticks must not call the visible-row supplier", calls, scene.calls)
            assertEquals("Static rows must leave animation membership until update", baseline, reads)
        }
    }

    fun `test animation does not schedule or enumerate rows before attach`() = edtWait {
        Scene(listOf(row("animated", 0, 100))).use { scene ->
            scene.clock.update()
            assertFalse(scene.host.isShowing)
            assertEquals(0, scene.calls)
            assertEquals(0, scene.timers.pending)
            assertEquals(false, scene.host.getClientProperty(AnimatedIcon.ANIMATION_IN_RENDERER_ALLOWED))
            assertEquals(emptyList<Rectangle>(), dirty(scene.host) { scene.timers.advanceBy(500) })

            scene.attach()
            assertTrue(scene.host.isShowing)
            assertEquals(1, scene.timers.pending)
        }
    }

    fun `test empty and static candidates stop the clock until update finds animation`() = edtWait {
        Scene(emptyList()).use { scene ->
            scene.attach()
            assertEquals(0, scene.timers.pending)
            scene.rows = listOf(row("static", 0))
            scene.clock.update()
            assertEquals(0, scene.timers.pending)
            assertEquals(emptyList<Rectangle>(), dirty(scene.host) { scene.timers.advanceBy(500) })

            scene.rows = listOf(row("animated", 0, 100))
            scene.clock.update()
            assertEquals(1, scene.timers.pending)
            scene.rows = emptyList()
            scene.clock.update()
            assertEquals(0, scene.timers.pending)
            assertEquals(emptyList<Rectangle>(), dirty(scene.host) { scene.timers.advanceBy(500) })
        }
    }

    fun `test candidate that finishes on a tick leaves no outstanding timer`() = edtWait {
        var delay: Int? = 100
        val item = object : ActiveItem by Item() {
            override fun animation(time: Long, actions: Boolean): Int? = delay
        }
        val row = ActiveAnimation.Row(item, Rectangle(0, 0, 100, 20), false)
        Scene(listOf(row)).use { scene ->
            scene.attach()
            delay = null
            assertEquals(listOf(row.bounds), dirty(scene.host) { scene.timers.advanceBy(100) })
            assertEquals(0, scene.timers.pending)
            assertEquals(emptyList<Rectangle>(), dirty(scene.host) { scene.timers.advanceBy(500) })
        }
    }

    fun `test hiding cancels animation and showing restarts it without explicit update`() = edtWait {
        val row = row("animated", 0, 100)
        Scene(listOf(row)).use { scene ->
            scene.attach()
            scene.host.isVisible = false
            assertFalse(scene.host.isShowing)
            assertEquals(0, scene.timers.pending)
            assertEquals(emptyList<Rectangle>(), dirty(scene.host) { scene.timers.advanceBy(300) })

            scene.host.isVisible = true
            assertTrue(scene.host.isShowing)
            assertEquals(1, scene.timers.pending)
            assertEquals(listOf(row.bounds), dirty(scene.host) { scene.timers.advanceBy(100) })
        }
    }

    fun `test removing the real host peer cancels animation and reattach restarts it`() = edtWait {
        val row = row("animated", 0, 100)
        Scene(listOf(row)).use { scene ->
            scene.attach()
            scene.root.removeNotify()
            assertFalse(scene.host.isDisplayable)
            assertEquals(0, scene.timers.pending)
            assertEquals(emptyList<Rectangle>(), dirty(scene.host) { scene.timers.advanceBy(300) })

            scene.attach()
            assertEquals(1, scene.timers.pending)
            assertEquals(listOf(row.bounds), dirty(scene.host) { scene.timers.advanceBy(100) })
        }
    }

    fun `test viewport scroll starts and stops animation as rows enter and leave the clip`() = edtWait {
        val row = row("animated", 100, 100)
        Scene(listOf(row("static", 0), row)).use { scene ->
            scene.attach()
            assertEquals(0, scene.timers.pending)

            scene.port.viewPosition = Point(0, 100)
            assertEquals(Rectangle(0, 100, 100, 60), scene.clips.last())
            assertEquals(1, scene.timers.pending)
            assertEquals(listOf(row.bounds), dirty(scene.host) { scene.timers.advanceBy(100) })

            scene.port.viewPosition = Point(0, 0)
            assertEquals(0, scene.timers.pending)
            assertEquals(emptyList<Rectangle>(), dirty(scene.host) { scene.timers.advanceBy(100) })

            scene.port.viewPosition = Point(0, 100)
            assertEquals(1, scene.timers.pending)
            assertEquals(listOf(row.bounds), dirty(scene.host) { scene.timers.advanceBy(100) })
        }
    }

    fun `test repeated updates retain absolute frame deadlines without starving repaint`() = edtWait {
        val row = row("animated", 0, 100)
        Scene(listOf(row)).use { scene ->
            scene.attach()
            val regions = dirty(scene.host) {
                repeat(4) {
                    scene.timers.advanceBy(20)
                    scene.clock.update()
                    assertEquals(1, scene.timers.pending)
                }
                scene.timers.advanceBy(19)
                scene.clock.update()
                assertEquals(emptyList<Rectangle>(), it)
                scene.timers.advanceBy(1)
                assertEquals(listOf(row.bounds), it)
                repeat(5) {
                    scene.timers.advanceBy(20)
                    scene.clock.update()
                    assertEquals(1, scene.timers.pending)
                }
            }
            assertEquals(listOf(row.bounds, row.bounds), regions)
        }
    }

    fun `test a delayed tick paints once and skips elapsed frames instead of catching up`() = edtWait {
        val row = row("animated", 0, 100)
        Scene(listOf(row)).use { scene ->
            scene.attach()
            val regions = dirty(scene.host) {
                scene.timers.advanceBy(1_050)
                assertEquals(listOf(row.bounds), it)
                scene.timers.runDue()
                assertEquals(listOf(row.bounds), it)
                assertEquals(1, scene.timers.pending)
                scene.timers.advanceBy(49)
                assertEquals(listOf(row.bounds), it)
                scene.timers.advanceBy(1)
            }
            assertEquals(listOf(row.bounds, row.bounds), regions)
        }
    }

    fun `test default item animation follows cycle icons in every visible position and live badge`() = edtWait {
        val cycle = cycle(100)
        for (icon in listOf(cycle, LiveBadgeIcon(cycle, UIUtil.getLabelForeground()))) {
            val badge = ActiveBadge("badge", icon = icon)
            for (item in listOf(
                Item(icon = icon),
                Item(leading = listOf(badge)),
                Item(badges = listOf(badge)),
                Item(secondaryBadges = listOf(badge)),
                Item(cells = listOf(ActiveCell("cell", "Cell", icon = icon))),
            )) {
                assertEquals(100, item.animation(0, true))
                assertEquals(1, item.animation(99, true))
                assertEquals(100, item.animation(100, true))
            }
        }
    }

    fun `test item animation selects the soonest visible icon deadline`() = edtWait {
        val item = Item(
            icon = cycle(100),
            leading = listOf(ActiveBadge("leading", icon = cycle(40))),
            badges = listOf(ActiveBadge("badge", icon = cycle(80))),
            secondaryBadges = listOf(ActiveBadge("secondary", icon = cycle(60))),
            cells = listOf(ActiveCell("cell", "Cell", icon = cycle(20))),
        )
        assertEquals(20, item.animation(0, true))
        assertEquals(40, item.animation(0, false))
        assertEquals(1, item.animation(19, true))
        assertEquals(21, item.animation(19, false))
    }

    fun `test hidden actions do not animate but always visible cells do unless disabled`() = edtWait {
        val item = Item(cells = listOf(
            ActiveCell("hidden", "Hidden", icon = cycle(25)),
            ActiveCell("always", "Always", alwaysVisible = true, icon = cycle(100)),
        ))
        assertEquals(25, item.animation(0, true))
        assertEquals(100, item.animation(0, false))
        assertNull(item.copy(cells = item.cells.take(1)).animation(0, false))
        assertNull(item.copy(disabled = true).animation(0, true))
    }

    fun `test progress hides animated badges and cells but preserves the leading icon`() = edtWait {
        val badge = ActiveBadge("hidden", icon = cycle(25))
        for (progress in listOf("", "Working")) {
            val item = Item(
                leading = listOf(badge),
                badges = listOf(badge),
                secondaryBadges = listOf(badge),
                cells = listOf(ActiveCell("hidden", "Hidden", alwaysVisible = true, icon = cycle(25))),
                progress = progress,
            )
            assertNull(item.animation(0, true))
            assertNull(item.animation(0, false))
            assertEquals(100, item.copy(icon = cycle(100)).animation(0, true))
            assertEquals(1, item.copy(icon = cycle(100)).animation(99, false))
        }
    }

    fun `test custom item opt out prevents animation even with a cycle icon`() = edtWait {
        val item = object : ActiveItem by Item(icon = cycle(100)) {
            override fun animation(time: Long, actions: Boolean): Int? = null
        }
        assertNull(item.animation(0, true))
        Scene(listOf(ActiveAnimation.Row(item, Rectangle(0, 0, 100, 20), true))).use { scene ->
            scene.attach()
            assertEquals(0, scene.timers.pending)
            assertEquals(emptyList<Rectangle>(), dirty(scene.host) { scene.timers.advanceBy(500) })
        }
    }

    private fun cycle(delay: Int) = AnimationIcon.Cycle(delay, EmptyIcon.create(16), EmptyIcon.create(12))

    private fun row(key: String, y: Int, delay: Int? = null) = ActiveAnimation.Row(
        Item(key = key, icon = delay?.let(::cycle) ?: EmptyIcon.ICON_16),
        Rectangle(0, y, 100, 20),
        false,
    )

    private fun dirty(target: JComponent, block: (List<Rectangle>) -> Unit): List<Rectangle> {
        val regions = mutableListOf<Rectangle>()
        val previous = RepaintManager.currentManager(target)
        RepaintManager.setCurrentManager(object : RepaintManager() {
            override fun addDirtyRegion(c: JComponent, x: Int, y: Int, w: Int, h: Int) {
                if (c === target && w > 0 && h > 0) regions += Rectangle(x, y, w, h)
            }
        })
        try {
            block(regions)
        } finally {
            RepaintManager.setCurrentManager(previous)
        }
        return regions
    }

    private data class Item(
        override val key: String = "row",
        override val icon: Icon? = null,
        override val leading: List<ActiveBadge> = emptyList(),
        override val badges: List<ActiveBadge> = emptyList(),
        override val secondaryBadges: List<ActiveBadge> = emptyList(),
        override val cells: List<ActiveCell> = emptyList(),
        override val disabled: Boolean = false,
        override val progress: String? = null,
    ) : ActiveItem {
        override val title = key
    }

    private class Scene(var rows: List<ActiveAnimation.Row>) : AutoCloseable {
        val root = JPanel(null).apply { setSize(100, 60) }
        val port = JViewport().apply { setBounds(0, 0, 100, 60) }
        val host = JPanel(null).apply {
            preferredSize = JBUI.size(100, 200)
            setSize(100, 200)
        }
        val timers = TestUiTimers()
        val clips = mutableListOf<Rectangle>()
        var calls = 0
        val clock: ActiveAnimation

        init {
            root.add(port)
            port.view = host
            clock = ActiveAnimation(host, timers) { clip ->
                calls++
                clips += Rectangle(clip)
                rows
            }
        }

        fun attach() {
            root.addNotify()
            port.doLayout()
            UIUtil.dispatchAllInvocationEvents()
        }

        override fun close() {
            if (root.isDisplayable) root.removeNotify()
            UIUtil.dispatchAllInvocationEvents()
        }
    }
}
