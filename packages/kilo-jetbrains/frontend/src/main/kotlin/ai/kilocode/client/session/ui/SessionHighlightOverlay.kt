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
 * Marks the step a header-timeline jump landed on with a vertical guide line in the transcript's
 * left padding, so the destination stays findable once the viewport has moved.
 *
 * Lives on the session overlay layer because the guide has to sit above the transcript without
 * joining transcript layout — a border or inset on a transcript view would reflow the cards inside
 * it, and the marked step can be taller than the viewport.
 *
 * The guide is a wayfinding cue, not state: the next scroll or click clears it.
 *
 * @param area the transcript viewport, used to clip the guide so a step taller than the viewport
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
    fun show(step: JComponent) {
        target = step
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

    /** The outlined step view, or null when no outline is showing. Test and diagnostic accessor. */
    @RequiresEdt
    fun outlined(): JComponent? = target

    /** Step rectangle in this overlay's coordinates, or an empty rect when there is nothing to draw. */
    @RequiresEdt
    fun outline(): Rectangle {
        val step = target ?: return Rectangle()
        // Descending from the scroll pane is what makes the coordinate conversion meaningful: it
        // drops a step detached by a transcript rebuild, and one left over from a body swap to the
        // blank or progress panel.
        if (!step.isVisible || !SwingUtilities.isDescendingFrom(step, area)) return Rectangle()
        return SwingUtilities.convertRectangle(step, Rectangle(step.size), this)
    }

    /** Transcript viewport rectangle in this overlay's coordinates. */
    @RequiresEdt
    fun clip(): Rectangle {
        val host = area.parent ?: return Rectangle()
        val pt = SwingUtilities.convertPoint(host, area.location, this)
        return Rectangle(pt.x, pt.y, area.width, area.height)
    }

    /**
     * X of the guide, in overlay coordinates: half of the transcript's left inset in from the step's
     * own left edge, so the line sits in the gutter beside the content.
     *
     * Measured from the step rather than from the transcript panel's `insets`, which are empty:
     * [ai.kilocode.client.session.ui.SessionLayout] applies that inset itself and also centers
     * content in a readable lane, so the panel's left edge is nowhere near the content's.
     */
    @RequiresEdt
    fun guide(): Int? {
        val rect = outline()
        if (rect.isEmpty) return null
        return rect.x - JBUI.scale(SessionUiStyle.SessionLayout.INNER_HORIZONTAL) / 2
    }

    override fun paintComponent(g: Graphics) {
        super.paintComponent(g)
        val rect = outline()
        if (rect.isEmpty) return
        val clip = clip()
        if (clip.isEmpty) return
        val x = guide() ?: return
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            // Clip instead of shortening the line: trimming it to the viewport would read as the
            // step ending there, for a step taller than the viewport.
            g2.clip(clip)
            g2.color = SessionUiStyle.View.Highlight.lineColor()
            val width = SessionUiStyle.View.Highlight.width()
            // Rounded caps so a short step reads as a marker rather than a clipped bar.
            g2.fillRoundRect(x - width / 2, rect.y, width, rect.height, width, width)
        } finally {
            g2.dispose()
        }
    }

    override fun dispose() {
        clear()
    }
}
