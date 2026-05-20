package ai.kilocode.client.session.ui.header

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.ContextUsage
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.JComponent
import javax.swing.JPanel

internal class ContextBar : JPanel(BorderLayout(UiStyle.Gap.md(), 0)) {
    private val used = JBLabel()
    private val limit = JBLabel()
    private val meter = Meter()

    init {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.sm(), 0, 0, 0)
        add(used, BorderLayout.WEST)
        add(meter, BorderLayout.CENTER)
        add(limit, BorderLayout.EAST)
    }

    fun setUsage(value: ContextUsage?) {
        val data = data(value)
        meter.data = data
        isVisible = data != null
        used.text = data?.used?.let(::num).orEmpty()
        limit.text = data?.limit?.let(::num).orEmpty()
        toolTipText = data?.tip()
        meter.toolTipText = toolTipText
        revalidate()
        repaint()
    }

    fun applyStyle(style: SessionEditorStyle) {
        background = style.editorBackground
        foreground = style.editorForeground
        meter.background = style.editorBackground
        used.font = style.smallUiFont
        used.foreground = style.editorForeground
        limit.font = style.smallUiFont
        limit.foreground = style.editorForeground
    }

    fun foregrounds() = listOf(used.foreground, limit.foreground)

    fun used(): Long? = meter.data?.used

    fun reserved(): Long? = meter.data?.reserved

    fun available(): Long? = meter.data?.available

    fun limit(): Long? = meter.data?.limit

    fun trackColor(): Color = meter.trackColor()

    fun usedColor(): Color = meter.data?.let(meter::usedColor) ?: meter.usedColor()

    fun reservedColor(): Color = meter.reservedColor()

    private fun data(value: ContextUsage?): ContextData? {
        val ctx = value ?: return null
        val max = ctx.limit?.takeIf { it > 0 } ?: return null
        if (ctx.tokens <= 0) return null
        val used = ctx.tokens.coerceAtMost(max)
        val output = ctx.output?.takeIf { it > 0 } ?: 0L
        val reserved = output.coerceAtMost(max - used)
        val available = (max - used - reserved).coerceAtLeast(0)
        return ContextData(used, reserved, available, max, output)
    }

    override fun getMaximumSize(): Dimension = Dimension(Int.MAX_VALUE, preferredSize.height)
}

private data class ContextData(
    val used: Long,
    val reserved: Long,
    val available: Long,
    val limit: Long,
    val output: Long,
) {
    fun tip(): String {
        val lines = mutableListOf(KiloBundle.message("session.header.context.used", num(used), num(limit)))
        if (output > 0) lines.add(KiloBundle.message("session.header.context.reserved", num(output)))
        if (available > 0) lines.add(KiloBundle.message("session.header.context.available", num(available)))
        return lines.joinToString("\n")
    }
}

private class Meter : JComponent() {
    var data: ContextData? = null

    init {
        isOpaque = false
        preferredSize = JBUI.size(80, 4)
        minimumSize = JBUI.size(24, 4)
    }

    override fun paintComponent(g: Graphics) {
        val data = data ?: return
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val h = JBUI.scale(4).coerceAtMost(height).coerceAtLeast(1)
            val y = (height - h) / 2
            val arc = JBUI.scale(4)
            g2.color = trackColor()
            g2.fillRoundRect(0, y, width, h, arc, arc)
            val used = segment(data.used, data.limit)
            val reserved = segment(data.reserved, data.limit)
            fill(g2, 0, y, used, h, usedColor(data), arc)
            fill(g2, used, y, reserved, h, reservedColor(), arc)
        } finally {
            g2.dispose()
        }
    }

    private fun segment(value: Long, limit: Long): Int {
        if (value <= 0 || limit <= 0 || width <= 0) return 0
        return ((value.toDouble() / limit.toDouble()) * width).toInt().coerceIn(0, width)
    }

    private fun fill(g: Graphics2D, x: Int, y: Int, w: Int, h: Int, color: Color, arc: Int) {
        if (w <= 0) return
        g.color = color
        g.fillRoundRect(x, y, w, h, arc, arc)
    }

    fun trackColor(): Color = shade(0.14f)

    fun usedColor(): Color = shade(0.45f)

    fun usedColor(data: ContextData): Color = usedColor()

    fun reservedColor(): Color = shade(0.28f)

    private fun shade(alpha: Float): Color {
        val base = background ?: UiStyle.Colors.editorBackground()
        val grey = if (UiStyle.Colors.bright(base)) Color.BLACK else Color.WHITE
        return UiStyle.Colors.blend(base, grey, alpha)
    }
}
