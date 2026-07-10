package ai.kilocode.client.ui

import ai.kilocode.client.ui.layout.Stack
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.GridBagLayout
import java.awt.RenderingHints
import javax.swing.JPanel

internal class DiffStatBadge(
    additions: Int,
    deletions: Int,
) : JPanel(GridBagLayout()) {
    private val removed = JBLabel().apply {
        foreground = removedColor()
        font = JBFont.small()
    }
    private val added = JBLabel().apply {
        foreground = addedColor()
        font = JBFont.small()
    }

    init {
        isOpaque = false
        border = JBUI.Borders.empty(0, UiStyle.Gap.sm(), 0, UiStyle.Gap.sm())
        add(
            Stack.horizontal(UiStyle.Gap.sm())
                .next(removed)
                .next(added),
        )
        update(additions, deletions)
    }

    fun update(additions: Int, deletions: Int) {
        removed.text = "-$deletions"
        added.text = "+$additions"
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = backgroundColor()
            g2.fillRoundRect(0, 0, width, height, height, height)
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

private fun removedColor(): Color = JBColor.namedColor(
    "Kilo.DiffStat.removedForeground",
    JBColor(Color(0xdb, 0x58, 0x66), Color(0xff, 0x6b, 0x7a)),
)

private fun addedColor(): Color = JBColor.namedColor(
    "Kilo.DiffStat.addedForeground",
    JBColor(Color(0x1f, 0x9d, 0x66), Color(0x35, 0xd4, 0x9a)),
)
