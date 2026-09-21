package ai.kilocode.client.session.board

import ai.kilocode.client.ui.UiStyle
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
 * [ai.kilocode.client.session.model.SessionModel.childSessions]).
 */
internal object BoardAvatars {
    /**
     * Keyed by what the icon actually draws — its initial and colour slot — not by participant id.
     * Session ids never repeat, so keying on them would grow this map for the life of the IDE; the
     * glyph space is bounded by (alphanumeric initials x colour slots) and reuses entries instead.
     */
    private val cache = ConcurrentHashMap<Pair<Char, Int>, Icon>()

    /**
     * [id]'s avatar. [order] is the board's participant order; [id]'s 0-based position in it picks a
     * stable colour. `main`, `ALL`, and any id absent from [order] get the neutral fill.
     */
    fun icon(id: String, order: List<String>): Icon {
        val index = if (id == "main" || id == "ALL") -1 else order.indexOf(id)
        val initial = initial(id)
        return cache.computeIfAbsent(initial to index) { AvatarIcon(initial.toString(), index) }
    }

    private fun initial(id: String): Char =
        (id.firstOrNull { it.isLetter() || it.isDigit() } ?: '?').uppercaseChar()

    /**
     * [index] is the participant's colour slot, resolved to a theme colour at paint time rather than
     * captured, so a cached icon still follows a Look and Feel change. A negative slot is neutral.
     */
    private class AvatarIcon(private val text: String, private val index: Int) : Icon {
        override fun getIconWidth() = JBUI.scale(16)
        override fun getIconHeight() = JBUI.scale(16)

        override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
            val g2 = g.create() as Graphics2D
            try {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.translate(x, y)
                g2.color = if (index < 0) UiStyle.Colors.swarmAvatarMain() else UiStyle.Colors.swarmAvatar(index)
                val inset = JBUI.scale(1).toFloat()
                val size = iconWidth - inset * 2
                g2.fill(Ellipse2D.Float(inset, inset, size, size))
                g2.color = UiStyle.Colors.swarmAvatarForeground()
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
