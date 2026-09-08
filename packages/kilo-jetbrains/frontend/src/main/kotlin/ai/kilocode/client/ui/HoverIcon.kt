package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton

class HoverIcon(private val fill: Boolean = false) : JButton() {
    private var over = false
    private var probe: JButton? = null

    /**
     * Makes an icon-only button a square of the height the look-and-feel would give it as a button,
     * so it lines up with labelled siblings in the same cluster instead of looking shorter. Taking
     * the height from the LAF rather than a fixed token keeps the two in step wherever the LAF
     * applies its own button minimum (Darcula raises both to the same floor).
     */
    var match = false
        set(value) {
            if (field == value) return
            field = value
            revalidate()
        }

    init {
        iconButton(this)
        addMouseListener(object : MouseAdapter() {
            override fun mouseEntered(e: MouseEvent) {
                sync(true)
            }

            override fun mouseExited(e: MouseEvent) {
                sync(false)
            }
        })
    }

    // Icon-only buttons are square: a 24x24 hit target for the usual 16px icon, growing with the icon
    // so a larger one keeps the same padding inside the hover pill. Labelled buttons size to their
    // content plus their (symmetric) border, which already gives equal padding on every side.
    override fun getPreferredSize(): Dimension {
        if (!text.isNullOrEmpty()) return super.getPreferredSize()
        if (match) {
            val side = labelledHeight()
            return Dimension(side, side)
        }
        val icon = icon ?: return JBUI.size(MIN, MIN)
        val side = maxOf(JBUI.scale(MIN), icon.iconWidth + JBUI.scale(PAD), icon.iconHeight + JBUI.scale(PAD))
        return Dimension(side, side)
    }

    // Button UIs commonly special-case null/empty text and size purely from the icon, skipping the
    // font-metrics contribution a labelled sibling gets from its non-empty text. That makes an
    // icon-only button's height track the icon instead of the shared labelled-button height whenever
    // the LAF's font metrics are taller than the icon. Measuring through a non-empty placeholder
    // forces the text layout path a labelled button uses, so both stay level everywhere.
    //
    // The probe carries no icon on purpose. Height would otherwise follow whichever is taller, this
    // button's icon or the text, and icon-only actions rarely carry the same icon size as the
    // labelled sibling they sit next to — a 13px icon beside a 12px one drifts a pixel taller on
    // LAFs whose font is shorter than either. Measuring text alone yields the insets+font-metrics
    // baseline every labelled sibling shares, independent of icon size on both sides.
    //
    // The placeholder goes on a detached probe rather than on this button: setText fires property
    // changes and calls revalidate()/repaint(), and doing that from a size query would invalidate
    // this control and its ancestors on every layout pass, re-queueing validation while the header
    // is showing. The probe never joins a hierarchy, so its own invalidation reaches nothing.
    private fun labelledHeight(): Int {
        val button = probe ?: JButton(" ").also {
            iconButton(it)
            probe = it
        }
        button.font = font
        button.border = border
        button.margin = margin
        return button.preferredSize.height
    }

    // Dropped so the probe is rebuilt under the incoming LAF instead of measuring with the old one.
    override fun updateUI() {
        super.updateUI()
        probe = null
    }

    override fun getMinimumSize(): Dimension = preferredSize

    override fun getMaximumSize(): Dimension = preferredSize

    override fun paintComponent(g: Graphics) {
        if (isEnabled && (over || fill)) paintHover(g)
        super.paintComponent(g)
    }

    private fun paintHover(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val base = UiStyle.Colors.bg()
            val hover = UiStyle.Colors.actionHoverBackground()
            g2.color = when {
                over && fill -> UiStyle.Colors.blend(base, hover, hover.alpha / 255f)
                over -> hover
                else -> base
            }
            val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
            g2.fillRoundRect(0, 0, width, height, arc, arc)
            if (fill) {
                g2.color = UiStyle.Colors.contentBorder()
                g2.drawRoundRect(0, 0, width - 1, height - 1, arc, arc)
            }
        } finally {
            g2.dispose()
        }
    }

    private fun sync(value: Boolean) {
        if (over == value) return
        over = value
        repaint()
    }

    private companion object {
        const val MIN = 24
        const val PAD = 8
    }
}

fun iconButton(button: JButton) {
    button.isFocusable = false
    button.setRequestFocusEnabled(false)
    button.isContentAreaFilled = false
    button.isBorderPainted = false
    button.isOpaque = false
    button.border = JBUI.Borders.empty()
}
