package ai.kilocode.client.session.ui.header

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Compaction
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.StepFinish
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.TimelineItem
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.ide.IdeTooltip
import com.intellij.ide.IdeTooltipManager
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Point
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import kotlin.math.roundToInt
import javax.swing.JPanel
import javax.swing.SwingUtilities

internal class TimelinePanel : JPanel() {
    companion object {
        private const val WIDTH = 12
        private const val MIN = 8
        private const val PAD = 4
        private const val GAP = 2
        private val HAND = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        private val DEFAULT = Cursor.getPredefinedCursor(Cursor.DEFAULT_CURSOR)
    }

    private var items: List<TimelineItem> = emptyList()
    private var heights: List<Int> = emptyList()
    private var hover = -1
    private var shown: IdeTooltip? = null

    init {
        isOpaque = false
        addMouseMotionListener(object : MouseMotionAdapter() {
            override fun mouseMoved(event: MouseEvent) {
                val idx = index(event)
                toolTipText = items.getOrNull(idx)?.title
                cursor = if (idx >= 0) HAND else DEFAULT
                if (hover == idx) return
                hover = idx
                tip(idx)
                repaint()
            }
        })
        addMouseListener(object : MouseAdapter() {
            override fun mouseExited(event: MouseEvent) {
                toolTipText = null
                cursor = DEFAULT
                if (hover == -1) return
                hover = -1
                tip(-1)
                repaint()
            }
        })
    }

    /**
     * Shows the hovered bar's tooltip immediately, unanimated, directly under the bar.
     *
     * Driven explicitly rather than left to the hover path, because each requirement lives in a
     * different place: Swing's `ToolTipManager.initialDelay` is not consulted at all
     * ([IdeTooltipManager] disables that manager and builds its own tooltip), the delay otherwise
     * comes from `IdeTooltip.getShowDelay()` reading the global `ide.tooltip.initialDelay` registry
     * value, and animation is a parameter of `show` rather than a property of the tooltip. Only
     * `show(now = true, animationEnabled = false)` satisfies all three.
     *
     * The anchor is the bar's bottom edge, not the pointer, so the label does not jump around as
     * the pointer moves within one bar.
     *
     * [toolTipText] is still kept in sync by the caller: it is what the accessibility API reads.
     */
    @RequiresEdt
    private fun tip(index: Int) {
        val manager = IdeTooltipManager.getInstance()
        val title = items.getOrNull(index)?.title
        if (title == null) {
            dismiss(manager)
            return
        }
        // Drop the previous balloon and its registration first, rather than relying on `show` replacing
        // it. `show` does tear the old balloon down — it passes the new tooltip as `tooltipToShow`, and
        // the equality guard that would keep the current one cannot match, because each bar builds a
        // fresh instance. But `setCustomTooltip` also installs a dummy listener on this component and
        // parks the tooltip in a client property, and only a null registration removes them, so a
        // panel disposed while a bar is hovered would otherwise keep both.
        dismiss(manager)
        val anchor = Point(barWidth() * index + barWidth() / 2, barBottom() + UiStyle.Gap.xs())
        val tip = object : IdeTooltip(this, anchor, JBLabel(title), this, title) {
            override fun getShowDelay(): Int = 0

            override fun getInitialReshowDelay(): Int = 0
        }
            // Without this the manager replaces the anchor with the component's own centre for any
            // component under 64px — the bar strip is ~20px tall, so the label would hang from the
            // middle of the bars instead of below them.
            .setToCenterIfSmall(false)
            .setPreferredPosition(Balloon.Position.below)
        // Keep it registered too, so a hover the manager initiates on its own reuses this tooltip
        // instead of building a delayed one from toolTipText.
        manager.setCustomTooltip(this, tip)
        shown = manager.show(tip, true, false)
    }

    /** Clears the registered tooltip and takes any balloon it owns off screen. */
    @RequiresEdt
    private fun dismiss(manager: IdeTooltipManager) {
        manager.setCustomTooltip(this, null)
        shown?.let(manager::hide)
        shown = null
    }

    /** A panel disposed while a bar is hovered must not leave its tooltip registered. */
    override fun removeNotify() {
        super.removeNotify()
        if (SwingUtilities.isEventDispatchThread()) dismiss(IdeTooltipManager.getInstance())
    }

    /** Bottom of the whole bar strip: the label hangs off that edge, not off the hovered bar. */
    private fun barBottom(): Int = height.takeIf { it > 0 } ?: preferredSize.height

    fun setItems(items: List<TimelineItem>): Boolean {
        val appended = items.size > this.items.size
        val max = items.maxOfOrNull { it.weight }?.coerceAtLeast(1) ?: 1
        this.items = items
        heights = items.map { height(it.weight, max) }
        val show = items.isNotEmpty()
        if (isVisible != show) isVisible = show
        revalidate()
        repaint()
        return appended
    }

    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)
        val g2 = g.create() as Graphics2D
        val w = JBUI.scale(WIDTH)
        val gap = JBUI.scale(GAP)
        val grow = JBUI.scale(1)
        val tall = height.takeIf { it > 0 } ?: preferredSize.height
        try {
            for (idx in items.indices) {
                val over = idx == hover
                val h = heights[idx] + if (over) grow else 0
                val wide = w + if (over) grow * 2 else 0
                val x = grow + idx * (w + gap) - if (over) grow else 0
                val y = (tall - h).coerceAtLeast(0)
                g2.color = color(items[idx])
                g2.fillRect(x, y, wide, h)
            }
        } finally {
            g2.dispose()
        }
    }

    /** Timeline item under [event], or null when the pointer is between bars. */
    fun itemAt(event: MouseEvent): TimelineItem? = items.getOrNull(index(event))

    private fun index(event: MouseEvent): Int {
        val w = JBUI.scale(WIDTH)
        val gap = JBUI.scale(GAP)
        val grow = JBUI.scale(1)
        val tall = height.takeIf { it > 0 } ?: preferredSize.height
        for (idx in items.indices) {
            val h = heights[idx]
            val x = grow + idx * (w + gap)
            val y = (tall - h).coerceAtLeast(0)
            val inside = event.x >= x && event.x < x + w && event.y >= y && event.y < y + h
            if (inside) return idx
        }
        return -1
    }

    override fun getPreferredSize(): Dimension = Dimension(width(), height())

    override fun getMinimumSize(): Dimension = Dimension(0, height())

    override fun getMaximumSize(): Dimension = Dimension(Int.MAX_VALUE, height())

    fun count() = items.size

    fun parts(): List<Content> = items.map { it.part }

    fun active(index: Int) = items[index].active

    fun barHeight(index: Int) = heights[index]

    fun barWidth() = JBUI.scale(WIDTH + GAP)

    fun hovered() = hover

    private fun height(weight: Int, max: Int): Int {
        val fill = MIN + (weight.toDouble() / max.toDouble()) * (MIN * 3 - MIN - PAD)
        return JBUI.scale(fill.roundToInt())
    }

    private fun height(): Int {
        val max = heights.maxOrNull() ?: return 0
        return max + JBUI.scale(PAD)
    }

    private fun width(): Int {
        if (items.isEmpty()) return 0
        return items.size * JBUI.scale(WIDTH) + (items.size - 1) * JBUI.scale(GAP) + JBUI.scale(2)
    }

    private fun color(item: TimelineItem): Color {
        val part = item.part
        if (part is Tool && part.state == ToolExecState.ERROR) return SessionUiStyle.Timeline.ERROR
        if (part is Text) return SessionUiStyle.Timeline.TEXT
        if (part is Reasoning) return SessionUiStyle.Timeline.TEXT
        if (part is Compaction) return SessionUiStyle.Timeline.STEP
        if (part is StepFinish) return SessionUiStyle.Timeline.SUCCESS
        if (part !is Tool) return SessionUiStyle.Timeline.STEP
        if (part.kind == ToolKind.READ) return SessionUiStyle.Timeline.READ
        if (part.kind == ToolKind.WRITE) return SessionUiStyle.Timeline.WRITE
        return SessionUiStyle.Timeline.TOOL
    }
}
