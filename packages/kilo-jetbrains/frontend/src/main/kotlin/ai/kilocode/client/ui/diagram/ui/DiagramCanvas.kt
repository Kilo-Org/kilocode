package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.diagram.Art
import ai.kilocode.client.ui.diagram.Painters
import ai.kilocode.client.ui.diagram.Palette
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.log.KiloLog
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.ui.components.Magnificator
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.Point
import java.awt.Rectangle
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.JComponent
import javax.swing.JViewport
import javax.swing.Scrollable
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Scrollable diagram surface for the diagram viewer.
 *
 * Two states: fit (no explicit factor) tracks the viewport on both axes so the whole diagram is
 * visible without scrollbars, while an explicit factor reports the scaled art as its preferred size
 * so the enclosing scroll pane can scroll it. The fit scale is derived from the **viewport** extent,
 * never from this component's own bounds, so sizing cannot feed back into itself.
 */
internal class DiagramCanvas(private var palette: Palette) : JComponent(), Scrollable {
    private var art: Art? = null
    private var factor: Double? = null

    init {
        // Trackpad pinch: JBViewport reads this off its view and drives it through ZoomingDelegate,
        // which does the scrolling itself from the returned point, so no anchoring here.
        putClientProperty(
            Magnificator.CLIENT_PROPERTY_KEY,
            Magnificator { scale, at ->
                zoom(this.scale() * scale)
                Point((at.x * scale).roundToInt(), (at.y * scale).roundToInt())
            },
        )
    }

    @RequiresEdt
    fun art(value: Art) {
        art = value
        revalidate()
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

    /**
     * Sets an explicit scale, or restores fit when [value] is null.
     *
     * [at] is a point in **viewport** coordinates that should stay put across the zoom.
     */
    @RequiresEdt
    fun zoom(value: Double?, at: Point? = null) {
        val before = scale()
        factor = value?.coerceIn(MIN, maxOf(MAX, fitScale() * FIT_ZOOM))
        // Size the view up front so the viewport clamps the anchored position against the new bounds.
        if (factor != null) size = preferredSize
        revalidate()
        repaint()
        if (at != null) anchor(at, before, scale())
    }

    @RequiresEdt
    fun fit() {
        zoom(null)
    }

    @RequiresEdt
    fun scale(): Double = factor ?: fitScale()

    override fun getPreferredSize(): Dimension {
        if (factor == null) return Dimension(0, 0)
        val value = art ?: return Dimension(0, 0)
        val size = Painters.of(value).size(value)
        val scale = scale()
        return Dimension(
            (size.w * scale).roundToInt() + pad() * 2,
            (size.h * scale).roundToInt() + pad() * 2,
        )
    }

    override fun paintComponent(g: Graphics) {
        background?.let {
            g.color = it
            g.fillRect(0, 0, width, height)
        }
        val value = art ?: return
        val size = Painters.of(value).size(value)
        val scale = scale()
        val x = ((width - size.w * scale) / 2).roundToInt().coerceAtLeast(pad())
        val y = ((height - size.h * scale) / 2).roundToInt().coerceAtLeast(pad())
        paintDiagram(g, value, palette, scale, x, y)
    }

    override fun getPreferredScrollableViewportSize(): Dimension = preferredSize

    override fun getScrollableUnitIncrement(visibleRect: Rectangle, orientation: Int, direction: Int) = step()

    override fun getScrollableBlockIncrement(visibleRect: Rectangle, orientation: Int, direction: Int) = step()

    override fun getScrollableTracksViewportWidth(): Boolean = tracks { extent -> preferredSize.width <= extent.width }

    override fun getScrollableTracksViewportHeight(): Boolean = tracks { extent -> preferredSize.height <= extent.height }

    private fun tracks(fits: (Dimension) -> Boolean): Boolean {
        if (factor == null) return true
        val viewport = parent as? JViewport ?: return false
        return fits(viewport.extentSize)
    }

    private fun anchor(at: Point, before: Double, after: Double) {
        if (before <= 0.0) return
        val viewport = parent as? JViewport ?: return
        val ratio = after / before
        val pos = viewport.viewPosition
        val x = ((pos.x + at.x) * ratio - at.x).roundToInt()
        val y = ((pos.y + at.y) * ratio - at.y).roundToInt()
        viewport.viewPosition = clamped(viewport, Point(x, y))
    }

    private fun fitScale(): Double {
        val value = art ?: return 1.0
        val size = Painters.of(value).size(value)
        if (size.w <= 0.0 || size.h <= 0.0) return 1.0
        val extent = (parent as? JViewport)?.extentSize ?: Dimension(width, height)
        val w = (extent.width - pad() * 2).coerceAtLeast(1)
        val h = (extent.height - pad() * 2).coerceAtLeast(1)
        return minOf(w / size.w, h / size.h).coerceAtLeast(MIN)
    }

    private fun pad() = JBUI.scale(SessionUiStyle.View.Diagram.PADDING)

    private fun step() = JBUI.scale(SessionUiStyle.SessionLayout.SCROLL_INCREMENT)

    private companion object {
        const val MIN = 0.1
        const val MAX = 4.0
        const val FIT_ZOOM = 4.0
    }
}

/**
 * Renders [art] into an image for the clipboard, padded and filled with [background].
 *
 * Painted from the scene rather than grabbed off the component, so the result is the whole diagram at
 * a fixed [SHOT] scale regardless of the current zoom, scroll position or viewport size. The
 * background is filled because the palette follows the IDE theme: a transparent PNG of a dark theme
 * diagram would be unreadable once pasted onto white.
 *
 * Returns null when there is nothing to draw or the allocation fails, and callers fall back to copying
 * the diagram source as text.
 */
internal fun diagramImage(art: Art, palette: Palette, background: Color?): BufferedImage? {
    val size = Painters.of(art).size(art)
    val scale = shot(size)
    val pad = SessionUiStyle.View.Diagram.PADDING * scale
    val w = (size.w * scale + pad * 2).roundToInt().coerceAtLeast(1)
    val h = (size.h * scale + pad * 2).roundToInt().coerceAtLeast(1)
    // A plain image on purpose: ImageUtil.createImage would add the IDE's HiDPI scale on top of the
    // shot scale, making the picture depend on the display it was copied from.
    val image = try {
        BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
    } catch (err: OutOfMemoryError) {
        // Bounded by shot() above, so this is a last resort against an IDE that is already short on
        // heap rather than the expected path for a large diagram.
        LOG.error("kind=diagram image=failed width=$w height=$h", err)
        return null
    }
    val g = image.createGraphics()
    try {
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
        g.color = background ?: UiStyle.Colors.editorBackground()
        g.fillRect(0, 0, w, h)
        paintDiagram(g, art, palette, scale, pad.roundToInt(), pad.roundToInt())
    } finally {
        g.dispose()
    }
    return image
}

/**
 * Scale for a clipboard image: [SHOT] unless that would allocate an unreasonable picture.
 *
 * The engine's [ai.kilocode.client.ui.diagram.Limits] cap the model, not the geometry it lays out, so a
 * legal diagram that is both deep and wide can span tens of thousands of units. At [SHOT] that is a
 * multi-gigabyte raster, allocated on the EDT the moment someone presses copy, so the scale gives way
 * before the allocation does and a huge diagram is copied smaller instead of taking the IDE down.
 */
private fun shot(size: Size): Double {
    if (size.w <= 0.0 || size.h <= 0.0) return SHOT
    val side = minOf(SIDE / size.w, SIDE / size.h)
    val area = sqrt(PIXELS / (size.w * size.h))
    // No lower bound: the area term is scale invariant, so however large the diagram gets the result
    // lands on the pixel budget, and the dimensions are floored at one pixel by the caller. A floor here
    // would raise the scale back above the budget it was picked to respect.
    return minOf(SHOT, side, area)
}

/** Clipboard images render larger than the screen so they stay crisp when pasted. */
private const val SHOT = 2.0

/** Longest side, in pixels, of a clipboard image. */
private const val SIDE = 8_000.0

/** Pixel budget for a clipboard image; 8M pixels is ~32MB as `TYPE_INT_RGB`. */
private const val PIXELS = 8_000_000.0

private val LOG = KiloLog.create(DiagramCanvas::class.java)

/** Keeps a viewport position inside the scrollable range of its view. */
internal fun clamped(viewport: JViewport, at: Point): Point {
    val view = viewport.view ?: return at
    val x = (view.width - viewport.extentSize.width).coerceAtLeast(0)
    val y = (view.height - viewport.extentSize.height).coerceAtLeast(0)
    return Point(at.x.coerceIn(0, x), at.y.coerceIn(0, y))
}

/**
 * Paints [art] scaled by [scale] with its top-left corner at ([x], [y]), reporting whether it drew.
 *
 * A painter that throws must not escape into the enclosing paint pass, where it would take the rest of
 * the transcript's painting with it and repeat on every repaint. The failure is logged once and
 * reported so the caller can put the diagram source back on screen instead.
 */
internal fun paintDiagram(g: Graphics, art: Art, palette: Palette, scale: Double, x: Int, y: Int): Boolean {
    val g2 = g.create() as Graphics2D
    try {
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
        g2.translate(x, y)
        g2.scale(scale, scale)
        Painters.of(art).paint(g2, art, palette)
        return true
    } catch (err: ProcessCanceledException) {
        throw err
    } catch (err: Throwable) {
        if (reported.compareAndSet(false, true)) LOG.error("kind=diagram paint=failed scale=$scale", err)
        return false
    } finally {
        g2.dispose()
    }
}

/** Paint runs per frame, so the same broken art must not fill the log. */
private val reported = AtomicBoolean(false)
