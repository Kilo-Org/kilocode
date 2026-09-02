package ai.kilocode.client.ui

import ai.kilocode.client.ui.layout.Stack
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.GridBagLayout
import java.awt.RenderingHints
import javax.swing.JPanel

internal class DiffStatBadge(
    additions: Int,
    deletions: Int,
    private val variant: Variant = Variant.REGULAR,
    /** Extra trailing padding, as an unscaled [UiStyle.Gap] step. */
    private val inset: Int = 0,
    // When false the badge paints only its text, without the rounded background pill or padding.
    private val fill: Boolean = true,
) : JPanel(GridBagLayout()), DiffBadge {
    constructor(additions: Int, deletions: Int) : this(additions, deletions, Variant.REGULAR, 0)

    internal enum class Variant {
        REGULAR,
        COMPACT;

        fun height() = when (this) {
            REGULAR -> JBUI.scale(16)
            COMPACT -> JBUI.scale(14)
        }

        fun gap() = when (this) {
            REGULAR -> UiStyle.Gap.sm()
            COMPACT -> UiStyle.Gap.xs()
        }

        /** Unscaled horizontal padding step; [JBUI.Borders] scales what it is handed. */
        fun pad() = UiStyle.Gap.SM
    }

    // JBFont rescales itself when the IDE font changes, so assigning it once is enough for the text.
    private val removed = JBLabel().apply {
        foreground = UiStyle.Colors.removedForeground()
        font = JBFont.small()
    }
    private val added = JBLabel().apply {
        foreground = UiStyle.Colors.addedForeground()
        font = JBFont.small()
    }
    private lateinit var row: Stack

    init {
        isOpaque = false
        row = Stack.horizontal(variant.gap()).next(removed).next(added)
        add(row)
        syncScale()
        update(additions, deletions)
    }

    override fun updateUI() {
        super.updateUI()
        // JPanel's constructor runs updateUI() before the fields above exist.
        if (this::row.isInitialized) syncScale()
    }

    /** A layout manager captures its gap once, so re-derive the spacing for the current scale. */
    private fun syncScale() {
        border = if (fill) JBUI.Borders.empty(0, variant.pad(), 0, variant.pad() + inset) else JBUI.Borders.empty()
        row.space = variant.gap()
    }

    override fun getPreferredSize(): Dimension {
        val dim = super.getPreferredSize()
        return Dimension(dim.width, variant.height())
    }

    override fun update(additions: Int, deletions: Int) {
        removed.isVisible = deletions > 0
        added.isVisible = additions > 0
        if (removed.isVisible) removed.text = "-$deletions"
        if (added.isVisible) added.text = "+$additions"
    }

    override fun paintComponent(g: Graphics) {
        if (!fill) {
            super.paintComponent(g)
            return
        }
        val g2 = g.create() as Graphics2D
        try {
            val w = maxOf(0, width - JBUI.scale(inset))
            val h = minOf(height, variant.height())
            val y = (height - h) / 2
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = backgroundColor()
            g2.fillRoundRect(0, y, w, h, h, h)
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    internal fun removedLabelForTest() = removed

    internal fun addedLabelForTest() = added
}

private fun backgroundColor(): Color = JBColor.namedColor(
    "Kilo.DiffStat.background",
    JBColor(Color(0x26, 0x26, 0x26), Color(0x26, 0x26, 0x26)),
)
