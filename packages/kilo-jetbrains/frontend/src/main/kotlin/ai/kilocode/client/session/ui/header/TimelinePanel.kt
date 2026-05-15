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
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import kotlin.math.roundToInt
import javax.swing.JPanel

internal class TimelinePanel : JPanel() {
    companion object {
        private const val WIDTH = 12
        private const val MIN = 8
        private const val PAD = 4
        private const val GAP = 2
    }

    private var items: List<TimelineItem> = emptyList()
    private var heights: List<Int> = emptyList()
    private var hover = -1

    init {
        isOpaque = false
        addMouseMotionListener(object : MouseMotionAdapter() {
            override fun mouseMoved(event: MouseEvent) {
                val idx = index(event)
                toolTipText = items.getOrNull(idx)?.title
                if (hover == idx) return
                hover = idx
                repaint()
            }
        })
        addMouseListener(object : MouseAdapter() {
            override fun mouseExited(event: MouseEvent) {
                toolTipText = null
                if (hover == -1) return
                hover = -1
                repaint()
            }
        })
    }

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
