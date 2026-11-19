package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.session.ui.SessionSurface
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.diagram.Art
import ai.kilocode.client.ui.diagram.Painters
import ai.kilocode.client.ui.diagram.Palette
import com.intellij.openapi.application.ApplicationManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import javax.swing.JComponent
import kotlin.math.roundToInt

internal class DiagramPanel(private var palette: Palette) : JComponent() {
    private var art: Art? = null
    private var last = Dimension(0, 0)
    private var faulted = false

    /**
     * Called once, off the paint pass, when the diagram could not be drawn.
     *
     * The owner uses it to go back to showing the source: by the time painting fails the source pane is
     * already hidden, so without this the reader is left looking at a blank surface.
     */
    var onFault: () -> Unit = {}

    @RequiresEdt
    fun art(value: Art) {
        art = value
        faulted = false
        resize()
        repaint()
    }

    @RequiresEdt
    fun palette(value: Palette) {
        palette = value
        repaint()
    }

    /** The rendered diagram as an image, or null while nothing has been drawn yet. */
    @RequiresEdt
    fun image(): BufferedImage? = art?.let { diagramImage(it, palette, background) }

    override fun getPreferredSize() = fitSize()

    override fun getMinimumSize() = fitSize()

    override fun getMaximumSize() = Dimension(Int.MAX_VALUE, fitSize().height)

    override fun setBounds(x: Int, y: Int, width: Int, height: Int) {
        val before = fitSize()
        super.setBounds(x, y, width, height)
        if (before.height != fitSize().height) resize()
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            g2.color = background
            val arc = JBUI.scale(SessionUiStyle.View.BLOCK_ARC)
            g2.fillRoundRect(0, 0, width, height, arc, arc)
        } finally {
            g2.dispose()
        }
        val value = art ?: return
        val scale = scale(value)
        val drew = SessionSurface.clipped(g, width, height) { clipped ->
            paintDiagram(clipped, value, palette, scale, pad(), pad())
        }
        if (drew || faulted) return
        // Swapping the visible component from inside a paint pass is not safe, so hand the fallback to
        // the owner on the next event instead.
        faulted = true
        ApplicationManager.getApplication().invokeLater(onFault)
    }

    private fun resize() {
        val next = fitSize()
        if (last == next) return
        last = next
        revalidate()
    }

    private fun fitSize(): Dimension {
        val value = art ?: return Dimension(0, emptyHeight())
        val size = Painters.of(value).size(value)
        val height = (size.h * scale(value)).roundToInt() + pad() * 2
        return Dimension(0, height.coerceAtLeast(emptyHeight()))
    }

    private fun scale(value: Art): Double {
        val size = Painters.of(value).size(value)
        val avail = (width.takeIf { it > 0 } ?: parent?.width ?: 0) - pad() * 2
        val byWidth = if (avail > 0) minOf(1.0, avail / size.w) else 1.0
        val max = JBUI.scale(SessionUiStyle.View.Diagram.MAX_HEIGHT) - pad() * 2
        val byHeight = if (size.h > 0.0) minOf(1.0, max / size.h) else 1.0
        return minOf(byWidth, byHeight).coerceAtLeast(0.1)
    }

    private fun pad() = JBUI.scale(SessionUiStyle.View.Diagram.PADDING)

    private fun emptyHeight() = JBUI.scale(SessionUiStyle.View.Diagram.EMPTY_HEIGHT)
}
