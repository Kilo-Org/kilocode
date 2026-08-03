package ai.kilocode.client.ui

import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.JPanel

internal class DiffBars(
    additions: Int,
    deletions: Int,
) : JPanel() {
    private var additions = additions
    private var deletions = deletions

    init {
        isOpaque = false
    }

    fun update(additions: Int, deletions: Int) {
        if (this.additions == additions && this.deletions == deletions) return
        this.additions = additions
        this.deletions = deletions
        repaint()
    }

    override fun getPreferredSize(): Dimension = JBUI.size(WIDTH, HEIGHT)

    override fun getMinimumSize(): Dimension = preferredSize

    override fun getMaximumSize(): Dimension = preferredSize

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val barHeight = JBUI.scale(HEIGHT)
            val y = maxOf(0, (height - barHeight) / 2)
            blocks().forEachIndexed { index, color ->
                g2.color = color
                g2.fillRoundRect(
                    JBUI.scale(index * STEP),
                    y,
                    JBUI.scale(BAR_WIDTH),
                    barHeight,
                    JBUI.scale(ARC),
                    JBUI.scale(ARC),
                )
            }
        } finally {
            g2.dispose()
        }
        super.paintComponent(g)
    }

    private fun blocks(): List<Color> {
        val total = additions + deletions
        if (total <= 0) return List(COUNT) { UiStyle.Colors.weak() }
        val added = ((additions.toDouble() / total) * COUNT).toInt().coerceIn(0, COUNT)
        val removed = ((deletions.toDouble() / total) * COUNT).toInt().coerceIn(0, COUNT - added)
        val neutral = COUNT - added - removed
        return List(added) { UiStyle.Colors.addedForeground() } +
            List(removed) { UiStyle.Colors.removedForeground() } +
            List(neutral) { UiStyle.Colors.weak() }
    }

    private companion object {
        const val COUNT = 5
        const val BAR_WIDTH = 2
        const val STEP = 4
        const val HEIGHT = 14
        const val WIDTH = 18
        const val ARC = 2
    }
}
