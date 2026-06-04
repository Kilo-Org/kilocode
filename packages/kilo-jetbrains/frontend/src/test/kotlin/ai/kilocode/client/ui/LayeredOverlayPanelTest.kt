package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JLayeredPane

@Suppress("UnstableApiUsage")
class LayeredOverlayPanelTest : BasePlatformTestCase() {

    fun `test root owns content overlay and blocker layers`() {
        val root = LayeredOverlayPanel()

        assertEquals(3, root.componentCount)
        assertSame(root.content, root.components.first { it === root.content })
        assertSame(root.overlay, root.components.first { it === root.overlay })
        assertSame(root.blocker, root.components.first { it === root.blocker })
        assertEquals(JLayeredPane.DEFAULT_LAYER, root.getLayer(root.content))
        assertEquals(JLayeredPane.PALETTE_LAYER, root.getLayer(root.overlay))
        assertEquals(JLayeredPane.MODAL_LAYER, root.getLayer(root.blocker))
    }

    fun `test root layout fills all immediate children`() {
        val root = LayeredOverlayPanel().apply { setSize(320, 180) }

        root.doLayout()

        assertEquals(Rectangle(0, 0, 320, 180), root.content.bounds)
        assertEquals(Rectangle(0, 0, 320, 180), root.overlay.bounds)
        assertEquals(Rectangle(0, 0, 320, 180), root.blocker.bounds)
    }

    fun `test root preferred size is max of content and overlay`() {
        val root = LayeredOverlayPanel().apply {
            content.preferredSize = Dimension(300, 120)
            overlay.preferredSize = Dimension(180, 220)
        }

        assertEquals(Dimension(300, 220), root.preferredSize)
    }

    fun `test addOverlay applies callback bounds and delegates child layout`() {
        val root = LayeredOverlayPanel().apply { setSize(400, 260) }
        val child = Probe()

        root.addOverlay(child) { _, item ->
            Rectangle(12, 34, item.preferredSize.width, item.preferredSize.height)
        }
        root.doLayout()

        assertEquals(Rectangle(12, 34, 80, 24), child.bounds)
        assertTrue(child.laid)
    }

    fun `test overlay contains only visible overlay children`() {
        val root = LayeredOverlayPanel().apply { setSize(400, 260) }
        val child = Probe()

        root.addOverlay(child) { _, item -> Rectangle(12, 34, item.preferredSize.width, item.preferredSize.height) }
        root.doLayout()

        assertTrue(root.overlay.contains(20, 40))
        assertFalse(root.overlay.contains(4, 4))

        child.isVisible = false
        assertFalse(root.overlay.contains(20, 40))
    }

    fun `test modal content is centered inside blocker`() {
        val root = LayeredOverlayPanel().apply { setSize(200, 100) }
        val child = Probe()

        root.setModalContent(child)
        root.doLayout()

        assertTrue(root.blocker.isVisible)
        assertEquals(1, root.blocker.componentCount)
        assertEquals(Rectangle(60, 38, 80, 24), child.bounds)
    }

    fun `test clearing modal content hides and removes blocker children`() {
        val root = LayeredOverlayPanel().apply { setSize(200, 100) }
        root.setModalContent(Probe())
        root.doLayout()

        root.setModalContent(null)

        assertFalse(root.blocker.isVisible)
        assertEquals(0, root.blocker.componentCount)
    }

    fun `test blocker contains reflects visibility`() {
        val root = LayeredOverlayPanel().apply { setSize(200, 100) }
        root.doLayout()

        root.setBlocked(false)
        assertFalse(root.blocker.contains(50, 50))

        root.setBlocked(true)
        assertTrue(root.blocker.contains(50, 50))
    }

    private class Probe : BorderLayoutPanel() {
        var laid = false

        init {
            preferredSize = Dimension(80, 24)
        }

        override fun doLayout() {
            laid = true
            super.doLayout()
        }
    }
}
