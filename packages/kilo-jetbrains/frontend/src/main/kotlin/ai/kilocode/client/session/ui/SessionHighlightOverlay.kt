package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.AWTEvent
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Rectangle
import java.awt.RenderingHints
import java.awt.Toolkit
import java.awt.event.AWTEventListener
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * Outlines the turn a header-timeline jump landed on, so the destination stays findable once the
 * viewport has moved. Lives on the session overlay layer because the outline has to sit above the
 * transcript cards without joining transcript layout — a border on
 * [ai.kilocode.client.session.views.TurnView] would reflow every card inside it, and a turn can be
 * taller than the viewport.
 *
 * The outline is a wayfinding cue, not state: the next scroll or click clears it.
 *
 * @param area the transcript viewport, used to clip the outline so a turn taller than the viewport
 *   does not paint over the header or the prompt.
 */
internal class SessionHighlightOverlay(
    private val area: JComponent,
    parent: Disposable,
) : JComponent(), Disposable {
    private var target: JComponent? = null

    init {
        isVisible = false

        // A click anywhere dismisses the outline. Press rather than click, and a global listener
        // rather than a listener on the transcript, because transcript children consume their own
        // mouse events and Swing does not bubble them to an ancestor. Press also orders correctly
        // against another timeline bar click: press clears, the later click re-shows.
        val listener = AWTEventListener { event ->
            val mouse = event as? MouseEvent ?: return@AWTEventListener
            if (mouse.id == MouseEvent.MOUSE_PRESSED) clear()
        }
        Toolkit.getDefaultToolkit().addAWTEventListener(listener, AWTEvent.MOUSE_EVENT_MASK)
        Disposer.register(parent, this)
        Disposer.register(this) {
            Toolkit.getDefaultToolkit().removeAWTEventListener(listener)
        }
    }

    /** The outline is a decoration; the transcript underneath it stays clickable. */
    override fun contains(x: Int, y: Int): Boolean = false

    @RequiresEdt
    fun show(turn: JComponent) {
        target = turn
        isVisible = true
        repaint()
    }

    @RequiresEdt
    fun clear() {
        if (target == null && !isVisible) return
        target = null
        isVisible = false
        repaint()
    }

    /** The outlined turn, or null when no outline is showing. Test and diagnostic accessor. */
    @RequiresEdt
    fun outlined(): JComponent? = target

    /** Turn rectangle in this overlay's coordinates, or an empty rect when there is nothing to draw. */
    @RequiresEdt
    fun outline(): Rectangle {
        val turn = target ?: return Rectangle()
        // Descending from the scroll pane is what makes the coordinate conversion meaningful: it
        // drops a turn detached by a transcript rebuild, and one left over from a body swap to the
        // blank or progress panel.
        if (!turn.isVisible || !SwingUtilities.isDescendingFrom(turn, area)) return Rectangle()
        return SwingUtilities.convertRectangle(turn, Rectangle(turn.size), this)
    }

    /** Transcript viewport rectangle in this overlay's coordinates. */
    @RequiresEdt
    fun clip(): Rectangle {
        val host = area.parent ?: return Rectangle()
        val pt = SwingUtilities.convertPoint(host, area.location, this)
        return Rectangle(pt.x, pt.y, area.width, area.height)
    }

    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)
        val rect = outline()
        if (rect.isEmpty) return
        val clip = clip()
        if (clip.isEmpty) return
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            // Clip instead of intersecting the rect: an intersection would draw a false top or
            // bottom edge along the viewport boundary for a turn taller than the viewport.
            g2.clip(clip)
            g2.color = SessionUiStyle.View.Highlight.outlineColor()
            val arc = JBUI.scale(SessionUiStyle.View.BLOCK_ARC)
            val width = SessionUiStyle.View.Highlight.width()
            for (step in 0 until width) {
                g2.drawRoundRect(
                    rect.x + step,
                    rect.y + step,
                    rect.width - 1 - step * 2,
                    rect.height - 1 - step * 2,
                    arc,
                    arc,
                )
            }
        } finally {
            g2.dispose()
        }
    }

    override fun dispose() {
        clear()
    }
}
