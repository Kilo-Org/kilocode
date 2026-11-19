package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.diagram.Mark
import ai.kilocode.client.ui.diagram.Palette
import ai.kilocode.client.ui.diagram.Rect
import ai.kilocode.client.ui.diagram.Role
import ai.kilocode.client.ui.diagram.Scene
import ai.kilocode.client.ui.diagram.Size
import ai.kilocode.client.ui.diagram.Type
import ai.kilocode.client.util.edtWait
import com.intellij.icons.AllIcons
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.Magnificator
import java.awt.Color
import java.awt.Container
import java.awt.Cursor
import java.awt.Font
import java.awt.Point
import java.awt.datatransfer.DataFlavor
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelEvent
import java.awt.image.BufferedImage
import javax.swing.AbstractButton
import javax.swing.JComponent
import javax.swing.JViewport
import javax.swing.SwingUtilities

class DiagramViewerTest : BasePlatformTestCase() {
    fun `test fit tracks the viewport and needs no scrolling`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)

        assertTrue(scale(viewer) < 1.0)
        val canvas = canvas(viewer)
        assertTrue(canvas.getScrollableTracksViewportWidth())
        assertTrue(canvas.getScrollableTracksViewportHeight())
    }

    fun `test fit upscales a diagram smaller than the viewport`() = edtWait {
        val viewer = viewer(800, 600)
        viewer.art(scene(100.0, 100.0))
        layout(viewer)

        assertTrue("fit should fill the window, not cap at native size", scale(viewer) > 1.0)
    }

    fun `test zooming in leaves fit and lets the scroll pane scroll`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        val fit = scale(viewer)

        viewer.zoomIn()
        layout(viewer)

        assertEquals(fit * 1.25, scale(viewer), 1e-6)
        val canvas = canvas(viewer)
        assertTrue(canvas.preferredSize.width > 0)
        assertFalse(canvas.getScrollableTracksViewportWidth())
    }

    fun `test zoom out then fit restores viewport tracking`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        val fit = scale(viewer)

        viewer.zoomOut()
        assertEquals(fit / 1.25, scale(viewer), 1e-6)

        viewer.fit()
        layout(viewer)

        assertEquals(fit, scale(viewer), 1e-6)
        assertEquals(0, canvas(viewer).preferredSize.width)
    }

    fun `test fit refits after the viewport is resized`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        val narrow = scale(viewer)

        viewer.setSize(800, 600)
        layout(viewer)

        assertTrue(scale(viewer) > narrow)
    }

    fun `test zoom clamps to the supported range`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(400.0, 300.0))
        layout(viewer)

        repeat(30) { viewer.zoomIn() }
        assertEquals(4.0, scale(viewer), 1e-6)

        repeat(60) { viewer.zoomOut() }
        assertEquals(0.1, scale(viewer), 1e-6)
    }

    fun `test canvas exposes a magnificator that scales and reports the anchor`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(400.0, 300.0))
        layout(viewer)
        val canvas = canvas(viewer)
        val magnificator = canvas.getClientProperty(Magnificator.CLIENT_PROPERTY_KEY) as Magnificator
        val before = scale(viewer)

        val at = magnificator.magnify(2.0, Point(30, 40))

        assertEquals(before * 2.0, scale(viewer), 1e-6)
        assertEquals(Point(60, 80), at)
    }

    fun `test control wheel zooms and consumes while a plain wheel scrolls`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        val fit = scale(viewer)

        val plain = wheel(viewer, control = false, rotation = -1)
        viewport(viewer).parent.dispatchEvent(plain)

        assertFalse(plain.isConsumed)
        assertEquals(fit, scale(viewer), 1e-6)

        val zoom = wheel(viewer, control = true, rotation = -1)
        viewport(viewer).parent.dispatchEvent(zoom)

        assertTrue(zoom.isConsumed)
        assertEquals(fit * 1.25, scale(viewer), 1e-6)
    }

    fun `test dragging pans the viewport and clamps at the edges`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        repeat(4) { viewer.zoomIn() }
        layout(viewer)
        val canvas = canvas(viewer)

        canvas.dispatchEvent(mouse(canvas, MouseEvent.MOUSE_PRESSED, 200, 150))
        canvas.dispatchEvent(mouse(canvas, MouseEvent.MOUSE_DRAGGED, 150, 120))

        assertEquals(Point(50, 30), viewport(viewer).viewPosition)

        canvas.dispatchEvent(mouse(canvas, MouseEvent.MOUSE_DRAGGED, 400, 350))
        canvas.dispatchEvent(mouse(canvas, MouseEvent.MOUSE_RELEASED, 400, 350))

        assertEquals(Point(0, 0), viewport(viewer).viewPosition)
    }

    fun `test overlay stacks zoom controls and copy in one column`() = edtWait {
        val viewer = viewer(400, 300)
        layout(viewer)

        val buttons = buttons(viewer)

        assertEquals(
            listOf(
                KiloBundle.message("diagram.zoom.in"),
                KiloBundle.message("diagram.zoom.out"),
                KiloBundle.message("diagram.zoom.fit"),
                KiloBundle.message("diagram.copy"),
            ),
            buttons.map { it.toolTipText },
        )
        assertEquals("the overlay is a single column", 1, buttons.map { it.x }.distinct().size)
        assertTrue(
            "each control sits below the previous one",
            buttons.zipWithNext().all { (above, below) -> below.y >= above.y + above.height },
        )
    }

    fun `test overlay icons keep the standard platform action size`() = edtWait {
        val viewer = viewer(400, 300)

        val zoom = buttons(viewer).first()

        assertEquals(AllIcons.General.ZoomIn.iconWidth, zoom.icon.iconWidth)
        assertEquals(AllIcons.General.ZoomIn.iconHeight, zoom.icon.iconHeight)
        assertTrue("icon-only controls stay square", zoom.preferredSize.width == zoom.preferredSize.height)
        assertTrue("the hit target is larger than the glyph", zoom.preferredSize.width > zoom.icon.iconWidth)
    }

    fun `test copy puts the whole diagram on the clipboard as a picture`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(200.0, 100.0))
        layout(viewer)

        buttons(viewer).single { it.toolTipText == KiloBundle.message("diagram.copy") }.doClick()

        val image = CopyPasteManager.getInstance().contents?.getTransferData(DataFlavor.imageFlavor) as BufferedImage
        // Rendered from the scene at 2x with padding, so zoom and scroll state cannot crop it.
        assertEquals(200 * 2 + PAD * 2, image.width)
        assertEquals(100 * 2 + PAD * 2, image.height)
    }

    fun `test double clicking restores fit`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        val fit = scale(viewer)
        viewer.zoomIn()
        layout(viewer)
        assertTrue(scale(viewer) > fit)
        val canvas = canvas(viewer)

        canvas.dispatchEvent(mouse(canvas, MouseEvent.MOUSE_CLICKED, 100, 100, clicks = 2))
        layout(viewer)

        assertEquals(fit, scale(viewer), 1e-6)
        assertEquals(0, canvas.preferredSize.width)
    }

    fun `test dragging shows the hand cursor until the drag ends`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        repeat(4) { viewer.zoomIn() }
        layout(viewer)
        val canvas = canvas(viewer)

        canvas.dispatchEvent(mouse(canvas, MouseEvent.MOUSE_PRESSED, 200, 150))
        assertEquals(Cursor.HAND_CURSOR, canvas.cursor.type)

        canvas.dispatchEvent(mouse(canvas, MouseEvent.MOUSE_RELEASED, 200, 150))
        assertEquals(Cursor.DEFAULT_CURSOR, canvas.cursor.type)
    }

    fun `test overlay floats above the scroll pane and receives its own clicks`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        val zoom = buttons(viewer).first()

        val at = SwingUtilities.convertPoint(zoom, zoom.width / 2, zoom.height / 2, viewer)

        assertSame("the scroll pane must not cover the controls", zoom, SwingUtilities.getDeepestComponentAt(viewer, at.x, at.y))
        assertFalse("overlapping layers cannot use optimized drawing", viewer.isOptimizedDrawingEnabled)
    }

    fun `test overlay buttons drive the zoom`() = edtWait {
        val viewer = viewer(400, 300)
        viewer.art(scene(2_000.0, 1_000.0))
        layout(viewer)
        val fit = scale(viewer)
        val buttons = buttons(viewer)

        buttons[0].doClick()
        assertEquals(fit * 1.25, scale(viewer), 1e-6)

        buttons[1].doClick()
        assertEquals(fit, scale(viewer), 1e-6)

        buttons[0].doClick()
        buttons[2].doClick()
        assertEquals(fit, scale(viewer), 1e-6)
        assertEquals(0, canvas(viewer).preferredSize.width)
    }

    private fun viewer(width: Int, height: Int) = DiagramViewer(palette()).apply {
        setSize(width, height)
        surface(Color.WHITE)
    }

    private fun layout(viewer: DiagramViewer) {
        viewer.doLayout()
        layout(viewer as Container)
    }

    private fun layout(root: Container) {
        root.doLayout()
        root.components.filterIsInstance<Container>().forEach(::layout)
    }

    private fun viewport(viewer: DiagramViewer): JViewport = descendants(viewer)
        .filterIsInstance<JBScrollPane>()
        .single()
        .viewport

    private fun canvas(viewer: DiagramViewer) = viewport(viewer).view as DiagramCanvas

    private fun scale(viewer: DiagramViewer) = canvas(viewer).scale()

    private fun wheel(viewer: DiagramViewer, control: Boolean, rotation: Int): MouseWheelEvent {
        val scroll = viewport(viewer).parent
        return MouseWheelEvent(
            scroll,
            MouseEvent.MOUSE_WHEEL,
            System.currentTimeMillis(),
            if (control) MouseEvent.CTRL_DOWN_MASK else 0,
            10,
            10,
            0,
            false,
            MouseWheelEvent.WHEEL_UNIT_SCROLL,
            1,
            rotation,
        )
    }

    private fun mouse(target: JComponent, id: Int, x: Int, y: Int, clicks: Int = 1) = MouseEvent(
        target,
        id,
        System.currentTimeMillis(),
        MouseEvent.BUTTON1_DOWN_MASK,
        x,
        y,
        clicks,
        false,
        MouseEvent.BUTTON1,
    )

    private fun buttons(root: Container): List<AbstractButton> {
        val out = mutableListOf<AbstractButton>()
        for (comp in root.components) {
            if (comp is AbstractButton) out.add(comp)
            if (comp is Container) out.addAll(buttons(comp))
        }
        return out
    }

    private fun descendants(root: Container): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        for (comp in root.components) {
            out.add(comp)
            if (comp is Container) out.addAll(descendants(comp))
        }
        return out
    }

    private fun scene(w: Double, h: Double) = Scene(
        Type.Flowchart,
        listOf(Mark.Box(Rect(0.0, 0.0, w, h), 4.0, Role.Surface, Role.Border)),
        Size(w, h),
    )

    private fun palette() = Palette(
        surface = Color.WHITE,
        border = Color.BLACK,
        text = Color.BLACK,
        muted = Color.GRAY,
        accent = Color.BLUE,
        note = Color.YELLOW,
        cluster = Color.LIGHT_GRAY,
        line = Color.DARK_GRAY,
        font = Font(Font.SANS_SERIF, Font.PLAIN, 12),
        bold = Font(Font.SANS_SERIF, Font.BOLD, 12),
    )

    private companion object {
        /** The padding `diagramImage` leaves around a copied diagram, in image pixels. */
        const val PAD = 32
    }
}
