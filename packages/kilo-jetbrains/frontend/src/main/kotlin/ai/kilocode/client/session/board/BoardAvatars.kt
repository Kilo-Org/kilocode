package ai.kilocode.client.session.board

import com.intellij.ui.JBColor
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.geom.Ellipse2D
import java.util.concurrent.ConcurrentHashMap
import javax.swing.Icon

/**
 * Deterministic per-participant avatar for the shared agent board: a filled circle with the
 * participant's initial, colored by its position in the board's participant order (`main` first,
 * then child sessions in spawn order — see
 * [ai.kilocode.client.session.model.SessionModel.childSessions]). Mirrors the `AgentAvatarPalette`
 * semantics in `packages/kilo-ui`.
 */
internal object BoardAvatars {
    // Mirrors packages/kilo-ui's AgentAvatarPalette hues; `main` gets a distinct neutral glyph
    // below rather than one of these, so it never collides with a subagent's color.
    private val palette = listOf(
        JBColor(0x3574F0, 0x548AF7),
        JBColor(0x1A9E77, 0x2FBE96),
        JBColor(0xB5651D, 0xD4813A),
        JBColor(0x8957E5, 0xA679F0),
        JBColor(0xC74F4F, 0xE06666),
        JBColor(0x2E8FB8, 0x4CB4DE),
    )
    private val mainColor = JBColor(0x6B7280, 0x9CA3AF)

    private val cache = ConcurrentHashMap<Pair<String, Int>, Icon>()

    /**
     * [id]'s avatar. [order] is the board's participant order; [id]'s 0-based position in it picks
     * a stable color from [palette]. `main`, `ALL`, and any id absent from [order] get [mainColor].
     */
    fun icon(id: String, order: List<String>): Icon {
        val index = if (id == "main" || id == "ALL") -1 else order.indexOf(id)
        return cache.computeIfAbsent(id to index) { AvatarIcon(initial(id), color(index)) }
    }

    private fun color(index: Int): JBColor = if (index < 0) mainColor else palette[index % palette.size]

    private fun initial(id: String): String {
        val letter = id.firstOrNull { it.isLetter() || it.isDigit() } ?: '?'
        return letter.uppercaseChar().toString()
    }

    private class AvatarIcon(private val text: String, private val bg: JBColor) : Icon {
        override fun getIconWidth() = JBUI.scale(16)
        override fun getIconHeight() = JBUI.scale(16)

        override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.translate(x, y)
                g2.color = bg
                val inset = JBUI.scale(1).toFloat()
                val size = iconWidth - inset * 2
                g2.fill(Ellipse2D.Float(inset, inset, size, size))
                g2.color = JBColor.WHITE
                g2.font = JBFont.small().asBold()
                val fm = g2.fontMetrics
                val width = fm.stringWidth(text)
                val base = (iconHeight + fm.ascent - fm.descent) / 2
                g2.drawString(text, (iconWidth - width) / 2, base)
            } finally {
                g2.dispose()
            }
        }
    }
}
