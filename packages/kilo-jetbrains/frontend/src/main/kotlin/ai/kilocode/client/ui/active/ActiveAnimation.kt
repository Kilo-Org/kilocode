package ai.kilocode.client.ui.active

import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.ui.AnimatedIcon
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Rectangle
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.HierarchyEvent
import javax.swing.JComponent
import javax.swing.JViewport
import javax.swing.SwingUtilities
import javax.swing.event.ChangeListener

/** One EDT clock per container, asleep unless a visible row has another frame to paint. */
internal class ActiveAnimation(
    private val host: JComponent,
    private val timers: UiTimerSource = UiTimers,
    private val rows: (Rectangle) -> List<Row>,
) {
    data class Row(val item: ActiveItem, val bounds: Rectangle, val actions: Boolean)
    private data class Pending(val row: Row, var due: Long)

    private var pending = emptyList<Pending>()
    private var timer: UiTimer? = null
    private var port: JViewport? = null
    private val scroll = ChangeListener { update() }

    init {
        // Render static snapshots instead of queuing a native delayed job for every icon instance.
        host.putClientProperty(AnimatedIcon.ANIMATION_IN_RENDERER_ALLOWED, false)
        host.addHierarchyListener { event ->
            val flags = (HierarchyEvent.SHOWING_CHANGED or HierarchyEvent.PARENT_CHANGED).toLong()
            if (event.changeFlags and flags != 0L) {
                port?.removeChangeListener(scroll)
                port = if (host.isShowing) {
                    SwingUtilities.getAncestorOfClass(JViewport::class.java, host) as? JViewport
                } else null
                port?.addChangeListener(scroll)
                update()
            }
        }
        host.addComponentListener(object : ComponentAdapter() {
            override fun componentResized(event: ComponentEvent) = update()
        })
    }

    @RequiresEdt
    fun update() {
        timer?.stop()
        timer = null
        val time = timers.now()
        val visible = host.visibleRect
        pending = if (!host.isShowing || visible.isEmpty) emptyList() else rows(visible).mapNotNull { row ->
            if (!row.bounds.intersects(visible)) return@mapNotNull null
            row.item.animation(time, row.actions)?.let { delay -> Pending(row, time + delay.coerceAtLeast(1)) }
        }
        schedule(time)
    }

    @RequiresEdt
    private fun tick() {
        timer = null
        if (!host.isShowing) {
            pending = emptyList()
            return
        }
        val time = timers.now()
        pending = pending.filter { frame ->
            if (frame.due > time) return@filter true
            host.repaint(frame.row.bounds)
            val delay = frame.row.item.animation(time, frame.row.actions) ?: return@filter false
            frame.due = time + delay.coerceAtLeast(1)
            true
        }
        schedule(time)
    }

    @RequiresEdt
    private fun schedule(time: Long) {
        val due = pending.minOfOrNull { it.due } ?: return
        timer = timers.timer((due - time).coerceIn(1, Int.MAX_VALUE.toLong()).toInt(), repeats = false) { tick() }
        timer?.start()
    }
}
