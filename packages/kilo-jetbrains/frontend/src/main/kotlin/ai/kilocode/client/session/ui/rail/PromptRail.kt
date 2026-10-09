package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.util.ui.JBUI
import java.awt.AlphaComposite
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import java.awt.event.MouseWheelEvent
import java.awt.event.MouseWheelListener
import javax.swing.JComponent
import javax.swing.SwingUtilities
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Paints the prompt navigator ticks and dispatches hover/click/wheel input for them. Lives on the
 * session overlay layer (see [ai.kilocode.client.ui.LayeredOverlayPanel]); [PromptRailController] owns
 * its bounds, model and popup wiring.
 *
 * [contains] only reports true within the vertical span the ticks actually occupy — above and below
 * that band, in narrow layouts where the rail sits over the scrollbar column, events fall through to
 * the scrollbar underneath.
 */
internal class PromptRail : JComponent() {
    private var entries: List<PromptRailEntry> = emptyList()
    private var items: List<PromptRailItem> = emptyList()
    private var active: Int? = null
    private var hover = -1
    private var open = -1
    private var available = true

    var centered = false

    var onHover: ((PromptRailEntry?) -> Unit)? = null
    var onSelect: ((PromptRailEntry) -> Unit)? = null

    var onWheel: (() -> Unit)? = null

    /**
     * Where a mouse wheel event over the rail is redirected. The rail sits on the overlay layer, not
     * inside the scroll pane, so a wheel event delivered to it would otherwise never reach the
     * transcript — [PromptRailController] points this at the scroll pane once it is built.
     */
    var wheelTarget: JComponent? = null

    /**
     * Scrollbar the rail is drawn over, or null when it sits in its own gutter.
     *
     * In the narrow layout the rail covers the scrollbar. It claims the whole band for hover, so without
     * this the bar would never see a press and its thumb could not be dragged. A press that misses every
     * tick is handed over instead; Swing then routes the rest of that drag to the bar on its own, so one
     * reachable row between ticks is enough to start a drag.
     */
    var barTarget: JComponent? = null

    init {
        isOpaque = false
        addMouseListener(object : MouseAdapter() {
            override fun mouseExited(e: MouseEvent) = setHover(-1)
            override fun mousePressed(e: MouseEvent) = press(e)
            override fun mouseReleased(e: MouseEvent) = press(e)
            override fun mouseClicked(e: MouseEvent) {
                val idx = indexAt(e.y)
                if (idx < 0) return press(e)
                onSelect?.invoke(entries[idx])
            }
        })
        addMouseMotionListener(object : MouseMotionAdapter() {
            override fun mouseMoved(e: MouseEvent) {
                if (e.modifiersEx and BUTTON_MASK != 0) return
                setHover(indexAt(e.y))
            }

            // Mid-drag the bar owns the gesture, so keep handing it the movement.
            override fun mouseDragged(e: MouseEvent) = press(e)
        })
        addMouseWheelListener(MouseWheelListener { e -> forward(e) })
    }

    /** True while a popup for this rail's tick at [index] is showing, so that tick stays full size. */
    fun setOpen(index: Int) {
        if (open == index) return
        open = index
        repaint()
    }

    fun setAvailable(value: Boolean) {
        if (available == value) return
        available = value
        syncVisible()
    }

    /** Replaces the rail's data. Repaints only when something visible actually changed. */
    fun update(items: List<PromptRailItem>, entries: List<PromptRailEntry>, active: Int?) {
        val changed = this.items != items || this.entries != entries || this.active != active
        this.items = items
        this.entries = entries
        this.active = active
        syncVisible()
        if (!changed) return
        revalidate()
        repaint()
    }

    fun entries(): List<PromptRailEntry> = entries

    fun items(): List<PromptRailItem> = items

    fun active(): Int? = active

    fun available(): Boolean = available

    /** Center y, in this component's own coordinates, of tick [index] — used to place the popup. */
    fun tickCenterY(index: Int): Int {
        val geo = geometry() ?: return height / 2
        return geo.top + index * geo.step + geo.step / 2
    }

    /**
     * Claims the whole tick band, so hovering anywhere along the rail opens the navigator.
     *
     * Presses are split finer than this. The band grows with the prompt count — a hundred prompts covers
     * a 600px viewport outright — and in the narrow layout the rail is drawn over the scrollbar, so
     * claiming every press here left the thumb undraggable. [press] forwards presses that did not land
     * on a tick to the scrollbar instead; see [barTarget].
     */
    override fun contains(x: Int, y: Int): Boolean {
        val geo = geometry() ?: return false
        if (y < geo.top || y >= geo.top + geo.step * entries.size) return false
        return x in 0 until width
    }

    override fun paintComponent(g: Graphics) {
        val geo = geometry() ?: return
        val g2 = g.create() as Graphics2D
        try {
            if (hover < 0 && open < 0) g2.composite = AlphaComposite.SrcOver.derive(0.5f)
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            for (i in entries.indices) {
                paintEntry(g2, geo, i)
            }
        } finally {
            g2.dispose()
        }
    }

    override fun getPreferredSize() = java.awt.Dimension(JBUI.scale(SessionUiStyle.PromptRail.TICK_HOVER), 0)

    private fun paintEntry(g2: Graphics2D, geo: Geometry, index: Int) {
        val entry = entries[index]
        val y = geo.top + index * geo.step + geo.step / 2
        val over = index == hover || index == open
        val isActive = entry is PromptRailEntry.Prompt && entry.index == active
        val queued = entry is PromptRailEntry.Prompt && items.getOrNull(entry.index)?.queued == true
        val length = when {
            over -> JBUI.scale(SessionUiStyle.PromptRail.TICK_HOVER)
            isActive -> JBUI.scale(SessionUiStyle.PromptRail.TICK_ACTIVE)
            else -> JBUI.scale(SessionUiStyle.PromptRail.TICK_REST)
        }
        val thickness = JBUI.scale(SessionUiStyle.PromptRail.TICK_THICKNESS)
        val x = if (centered) (width - length) / 2 else width - length
        g2.color = when {
            queued -> SessionUiStyle.PromptRail.queuedColor()
            over || isActive -> SessionUiStyle.PromptRail.activeColor()
            else -> SessionUiStyle.PromptRail.restColor()
        }
        if (entry is PromptRailEntry.Overflow) {
            paintDashed(g2, x, y - thickness / 2, length, thickness)
            return
        }
        g2.fillRect(x, y - thickness / 2, length, thickness)
    }

    private fun paintDashed(g2: Graphics2D, x: Int, y: Int, length: Int, thickness: Int) {
        val dash = JBUI.scale(2)
        var pos = x
        val end = x + length
        while (pos < end) {
            val w = min(dash, end - pos)
            g2.fillRect(pos, y, w, thickness)
            pos += dash * 2
        }
    }

    private fun setHover(index: Int) {
        if (hover == index) return
        hover = index
        onHover?.invoke(entries.getOrNull(index))
        repaint()
    }

    /**
     * Tick whose own rows cover [y], or -1 for the gap between two ticks.
     *
     * The grab band around a tick is widened past its painted thickness so a tick stays easy to hit, but
     * it deliberately stops short of the full step: the remainder is what leaves the scrollbar beneath
     * the rail reachable. See [contains].
     */
    private fun indexAt(y: Int): Int {
        val geo = geometry() ?: return -1
        if (entries.isEmpty()) return -1
        val idx = (y - geo.top) / geo.step
        if (idx !in entries.indices) return -1
        val center = geo.top + idx * geo.step + geo.step / 2
        val grab = max(JBUI.scale(SessionUiStyle.PromptRail.TICK_THICKNESS), geo.step / 2 - JBUI.scale(2))
        if (abs(y - center) > grab) return -1
        return idx
    }

    /**
     * Hands a press, drag or release that did not land on a tick to the scrollbar under the rail.
     *
     * Only meaningful in the narrow layout, where [barTarget] is set because the rail covers the bar. A
     * press on a tick is the rail's own and is left alone.
     */
    private fun press(e: MouseEvent) {
        // barTarget is only set while the bar is visible and sized under the rail, so no further
        // liveness check is needed here.
        val target = barTarget ?: return
        if (e.id == MouseEvent.MOUSE_PRESSED && indexAt(e.y) >= 0) return
        target.dispatchEvent(SwingUtilities.convertMouseEvent(this, e, target))
    }

    private fun forward(e: MouseWheelEvent) {
        onWheel?.invoke()
        val target = wheelTarget ?: return
        target.dispatchEvent(SwingUtilities.convertMouseEvent(this, e, target))
    }

    private fun syncVisible() {
        val show = available && entries.size >= 2
        if (isVisible != show) isVisible = show
    }

    private fun geometry(): Geometry? {
        if (entries.isEmpty() || height <= 0) return null
        val pad = JBUI.scale(SessionUiStyle.PromptRail.RAIL_INSET) / 2
        val usable = max(0, height - 2 * pad)
        val minStep = JBUI.scale(SessionUiStyle.PromptRail.STEP_MIN)
        val maxStep = JBUI.scale(SessionUiStyle.PromptRail.STEP_MAX)
        val ideal = if (entries.isEmpty()) minStep else usable / entries.size
        val step = ideal.coerceIn(minStep, maxStep)
        val total = step * entries.size
        val top = (height - total) / 2
        return Geometry(top, step)
    }

    private data class Geometry(val top: Int, val step: Int)

    private companion object {
        const val BUTTON_MASK = MouseEvent.BUTTON1_DOWN_MASK or
            MouseEvent.BUTTON2_DOWN_MASK or MouseEvent.BUTTON3_DOWN_MASK
    }
}
