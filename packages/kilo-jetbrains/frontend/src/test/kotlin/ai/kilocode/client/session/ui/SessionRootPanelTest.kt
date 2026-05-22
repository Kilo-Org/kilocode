package ai.kilocode.client.session.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JLayeredPane

@Suppress("UnstableApiUsage")
class SessionRootPanelTest : BasePlatformTestCase() {

    fun `test root owns content and overlay layers`() {
        val root = SessionRootPanel()

        assertEquals(2, root.componentCount)
        assertSame(root.content, root.components.first { it === root.content })
        assertSame(root.overlay, root.components.first { it === root.overlay })
        assertEquals(JLayeredPane.DEFAULT_LAYER, root.getLayer(root.content))
        assertEquals(JLayeredPane.PALETTE_LAYER, root.getLayer(root.overlay))
    }

    fun `test root layout fills immediate children`() {
        val root = SessionRootPanel().apply {
            setSize(320, 180)
        }

        root.doLayout()

        assertEquals(Rectangle(0, 0, 320, 180), root.content.bounds)
        assertEquals(Rectangle(0, 0, 320, 180), root.overlay.bounds)
    }

    fun `test root preferred size is max of immediate children`() {
        val root = SessionRootPanel().apply {
            content.preferredSize = Dimension(300, 120)
            overlay.preferredSize = Dimension(180, 220)
        }

        assertEquals(Dimension(300, 220), root.preferredSize)
    }

    fun `test addOverlay applies callback bounds and delegates child layout`() {
        val root = SessionRootPanel().apply {
            setSize(400, 260)
        }
        val child = Probe()

        root.addOverlay(child) { _, item ->
            Rectangle(12, 34, item.preferredSize.width, item.preferredSize.height)
        }

        root.doLayout()

        assertEquals(Rectangle(12, 34, 80, 24), child.bounds)
        assertTrue(child.laid)
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
