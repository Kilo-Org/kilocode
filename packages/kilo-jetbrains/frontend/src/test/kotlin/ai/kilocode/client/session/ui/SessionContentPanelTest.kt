package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import java.awt.Dimension
import java.awt.image.BufferedImage

@Suppress("UnstableApiUsage")
class SessionContentPanelTest : BasePlatformTestCase() {

    fun `test content panel and footer are transparent`() {
        val panel = SessionContentPanel()

        assertFalse("the content column paints nothing itself", panel.isOpaque)
        assertFalse("footer region is empty until used", panel.hasFooter())
    }

    fun `test footer region appears only once a component is added`() {
        val panel = SessionContentPanel()

        assertFalse(panel.hasFooter())
        panel.footer(JBLabel("auto-approved"))

        assertTrue(panel.hasFooter())
    }

    fun `test content pieces stack separated by the standard gap`() {
        val panel = SessionContentPanel()
        val first = sized()
        val second = sized()
        panel.content(first).content(second)
        panel.setSize(120, panel.preferredSize.height)
        layout(panel)

        // The two content surfaces are laid out top-to-bottom, split by exactly the standard gap.
        assertEquals(first.height + SessionUiStyle.View.contentGap(), y(second) - y(first))
    }

    fun `test surface paints a rounded code-block background`() {
        val surface = SessionSurfacePanel()
        surface.setSize(40, 40)
        val image = BufferedImage(40, 40, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        surface.paint(graphics)
        graphics.dispose()

        assertEquals(SessionUiStyle.Colors.codeBlockBackground().rgb, surface.background.rgb)
        assertEquals("center is the raised code surface", SessionUiStyle.Colors.codeBlockBackground().rgb, image.getRGB(20, 20))
        assertEquals("corner is rounded away, letting the backdrop show", 0, image.getRGB(0, 0) ushr 24)
    }

    private fun sized() = JBLabel("x").apply {
        val size = Dimension(80, 20)
        preferredSize = size
        minimumSize = size
        maximumSize = size
    }

    private fun y(component: java.awt.Component): Int {
        var node: java.awt.Component? = component
        var top = 0
        while (node != null && node !is SessionContentPanel) {
            top += node.y
            node = node.parent
        }
        return top
    }

    private fun layout(root: java.awt.Container) {
        root.doLayout()
        root.components.filterIsInstance<java.awt.Container>().forEach(::layout)
    }
}
