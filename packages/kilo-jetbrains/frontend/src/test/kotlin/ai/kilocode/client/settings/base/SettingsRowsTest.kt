package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.SeparatorComponent
import com.intellij.ui.components.JBLabel
import java.awt.Color
import java.awt.Container
import java.awt.BorderLayout
import java.awt.Rectangle
import java.awt.image.BufferedImage
import javax.swing.AbstractButton
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JScrollPane
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable
import javax.swing.text.JTextComponent

class SettingsRowsTest : BasePlatformTestCase() {

    fun `test rows do not insert separators`() {
        val rows = SettingsRows()

        rows.row(SettingsRow("One", value = JButton("A")))
        rows.row(SettingsRow("Two", value = JButton("B")))

        assertEquals(2, rows.componentCount)
        assertTrue(components(rows).none { it is SeparatorComponent })
    }

    fun `test keyed update preserves row and value`() {
        val rows = SettingsRows()
        val value = JButton("A")
        val row = rows.row("one", SettingsRow("One", "Before", value))

        val updated = rows.update("one", "Updated", "After", value)

        assertSame(row, updated)
        assertSame(value, components(row).first { it === value })
        assertTrue(text(row).contains("Updated"))
        assertTrue(text(row).contains("After"))
    }

    fun `test keyed update can clear value`() {
        val rows = SettingsRows()
        val value = JButton("A")
        val row = rows.row("one", SettingsRow("One", value = value))

        rows.update("one", "One")

        assertFalse(components(row).any { it === value })
    }

    fun `test row value centers vertically`() {
        val value = JButton("Choose a model")
        val row = SettingsRow(
            "Default model",
            "This description is intentionally long enough to wrap instead of pushing the value off screen.",
            value,
        )
        row.setSize(row.preferredSize.width, row.preferredSize.height)

        layout(row)

        assertEquals((value.parent.height - value.height) / 2, value.y)
    }

    fun `test row description uses escaped wrapping html`() {
        val row = SettingsRow("Mode", "Use <fast> & safe models")

        val label = components(row)
            .filterIsInstance<JBLabel>()
            .single { it.text.contains("fast") }

        assertTrue(label.text.startsWith("<html>"))
        assertTrue(label.text.contains("&lt;fast&gt;"))
        assertTrue(label.text.contains("&amp;"))
    }

    fun `test removing keyed row removes only that row`() {
        val rows = SettingsRows()
        val one = rows.row("one", SettingsRow("One", value = JButton("A")))
        val two = rows.row("two", SettingsRow("Two", value = JButton("B")))

        assertSame(one, rows.remove("one"))

        assertEquals(1, rows.componentCount)
        assertSame(two, rows.getComponent(0))
    }

    fun `test retain keeps requested keyed rows`() {
        val rows = SettingsRows()
        val one = rows.row("one", SettingsRow("One", value = JButton("A")))
        rows.row("two", SettingsRow("Two", value = JButton("B")))

        rows.retain(setOf("one"))

        assertEquals(1, rows.componentCount)
        assertSame(one, rows.getComponent(0))
    }

    fun `test top banner renders login action`() {
        val top = SettingsTop()

        top.showNotLoggedIn {}

        assertTrue(text(top).contains("Sign in to Kilo Code"))
        assertTrue(top.isVisible)
    }

    fun `test settings panel keeps banner in scroll content and progress in overlay`() {
        val panel = SettingsPanel()

        panel.top.showNotLoggedIn {}
        panel.showProgress("Loading models...")

        assertTrue(text(panel.content).contains("Sign in to Kilo Code"))
        assertFalse(text(panel.overlay).contains("Sign in to Kilo Code"))
        assertTrue(panel.overlay.components.any { it === panel.progress })
        assertTrue(text(panel.progress).contains("Loading models..."))
        val scroll = components(panel.content).filterIsInstance<JScrollPane>().single()
        assertFalse(components(scroll.viewport.view as JComponent).any { it === panel.progress })
    }

    fun `test settings panel tracks viewport width without horizontal scroll`() {
        val panel = SettingsPanel()

        val scroll = components(panel).filterIsInstance<JScrollPane>().single()
        val view = scroll.viewport.view

        assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, scroll.horizontalScrollBarPolicy)
        assertTrue(view is Scrollable)
        assertTrue((view as Scrollable).getScrollableTracksViewportWidth())
    }

    fun `test settings panel header gets right inset outside scroll`() {
        val panel = SettingsPanel()
        val field = javax.swing.JTextField()

        panel.setHeader(field)

        val header = (panel.content.layout as BorderLayout).getLayoutComponent(BorderLayout.NORTH) as JComponent
        assertEquals(UiStyle.Gap.xl(), header.insets.right)
        assertTrue(components(header).any { it === field })
    }

    fun `test settings progress overlay is centered near top`() {
        val panel = SettingsPanel().apply { setSize(400, 300) }

        panel.showProgress("Loading")
        panel.doLayout()

        val size = panel.progress.preferredSize
        assertEquals(
            Rectangle((400 - size.width) / 2, UiStyle.Gap.pad(), size.width, size.height),
            panel.progress.bounds,
        )
        assertTrue(panel.overlay.contains(panel.progress.x + 1, panel.progress.y + 1))
        assertFalse(panel.overlay.contains(1, 1))
    }

    fun `test settings progress overlay retains label across updates`() {
        val panel = SettingsPanel()

        panel.showProgress("Loading")
        val label = components(panel.progress).filterIsInstance<JBLabel>().single { it.text == "Loading" }

        panel.showProgress("Saving")

        assertSame(label, components(panel.progress).filterIsInstance<JBLabel>().single { it.text == "Saving" })

        panel.clearProgress()
        assertFalse(panel.progress.isVisible)
    }

    fun `test settings progress overlay retains cancel button across progress updates`() {
        val panel = SettingsPanel()
        var calls = 0

        panel.showProgress("Starting", "Cancel") { calls++ }
        val label = components(panel.progress).filterIsInstance<JBLabel>().single { it.text == "Starting" }
        val button = components(panel.progress).filterIsInstance<JButton>().single { it.text == "Cancel" }

        panel.updateProgress("Waiting")
        button.doClick()

        assertSame(label, components(panel.progress).filterIsInstance<JBLabel>().single { it.text == "Waiting" })
        assertSame(button, components(panel.progress).filterIsInstance<JButton>().single { it.text == "Cancel" })
        assertEquals(1, calls)
    }

    fun `test settings progress overlay clears cancel action for text only states`() {
        val panel = SettingsPanel()
        var calls = 0

        panel.showProgress("Starting", "Cancel") { calls++ }
        val button = components(panel.progress).filterIsInstance<JButton>().single { it.text == "Cancel" }
        panel.showProgress("Loading")

        assertFalse(button.isVisible)
        button.doClick()
        assertEquals(0, calls)

        panel.showProgress("Starting", "Cancel") { calls++ }
        panel.showError("Failed")
        assertFalse(button.isVisible)
        button.doClick()
        assertEquals(0, calls)

        panel.showProgress("Starting", "Cancel") { calls++ }
        panel.clearProgress()
        assertFalse(button.isVisible)
        button.doClick()
        assertEquals(0, calls)
    }

    fun `test settings progress overlay uses information colors`() {
        val panel = SettingsPanel()

        panel.showProgress("Loading")

        val label = components(panel.progress).filterIsInstance<JBLabel>().single { it.text == "Loading" }
        assertEquals(UiStyle.Colors.infoOverlayBackground(), panel.progress.background)
        assertEquals(UiStyle.Colors.infoOverlayForeground(), panel.progress.foreground)
        assertEquals(UiStyle.Colors.infoOverlayForeground(), label.foreground)
    }

    fun `test settings progress overlay paints styled background`() {
        val panel = SettingsPanel()

        panel.showProgress("Saving")
        panel.progress.setSize(panel.progress.preferredSize)
        panel.progress.doLayout()

        assertEquals(UiStyle.Colors.infoOverlayBackground().rgb, paint(panel.progress, UiStyle.Gap.lg(), panel.progress.height / 2).rgb)
        assertNotSameColor(UiStyle.Colors.bg(), panel.progress.background)
    }

    fun `test settings progress overlay can show error`() {
        val panel = SettingsPanel()

        panel.showError("Failed to save model settings")

        val label = components(panel.progress).filterIsInstance<JBLabel>().single { it.text == "Failed to save model settings" }
        assertTrue(panel.progress.isVisible)
        assertEquals(UiStyle.Colors.errorOverlayBackground(), panel.progress.background)
        assertEquals(UiStyle.Colors.errorOverlayForeground(), panel.progress.foreground)
        assertEquals(UiStyle.Colors.errorOverlayForeground(), label.foreground)
    }

    fun `test settings progress overlay switches error back to info`() {
        val panel = SettingsPanel()

        panel.showError("Failed")
        val label = components(panel.progress).filterIsInstance<JBLabel>().single { it.text == "Failed" }
        panel.showProgress("Saving")

        assertSame(label, components(panel.progress).filterIsInstance<JBLabel>().single { it.text == "Saving" })
        assertEquals(UiStyle.Colors.infoOverlayBackground(), panel.progress.background)
        assertEquals(UiStyle.Colors.infoOverlayForeground(), panel.progress.foreground)
        assertEquals(UiStyle.Colors.infoOverlayForeground(), label.foreground)
    }

    private fun paint(component: JComponent, x: Int, y: Int): Color {
        val image = BufferedImage(component.width, component.height, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            component.paint(g)
        } finally {
            g.dispose()
        }
        return Color(image.getRGB(x, y), true)
    }

    private fun assertNotSameColor(a: Color, b: Color) {
        assertFalse("Expected colors to differ: $a", a.rgb == b.rgb)
    }

    private fun layout(component: JComponent) {
        component.doLayout()
        components(component).filterIsInstance<Container>().forEach { it.doLayout() }
    }

    private fun text(component: JComponent): String = components(component)
        .mapNotNull {
            when (it) {
                is JLabel -> it.text
                is AbstractButton -> it.text
                is JTextComponent -> it.text
                else -> null
            }
        }
        .joinToString("\n")

    private fun components(component: JComponent): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(c: java.awt.Component) {
            out += c
            if (c is Container) c.components.forEach { visit(it) }
        }
        visit(component)
        return out
    }
}
