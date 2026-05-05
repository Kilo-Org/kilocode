package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Color

@Suppress("UnstableApiUsage")
class UiStyleTest : BasePlatformTestCase() {

    fun `test border is lighter than dark panel`() {
        val panel = Color(0, 0, 0)
        val border = UiStyle.Colors.contrast(panel, UiStyle.Colors.BORDER_DELTA)

        assertTrue(border.red > panel.red)
        assertTrue(border.green > panel.green)
        assertTrue(border.blue > panel.blue)
    }

    fun `test border is darker than light panel`() {
        val panel = Color(255, 255, 255)
        val border = UiStyle.Colors.contrast(panel, UiStyle.Colors.BORDER_DELTA)

        assertTrue(border.red < panel.red)
        assertTrue(border.green < panel.green)
        assertTrue(border.blue < panel.blue)
    }

    fun `test hover blends from panel toward border`() {
        val panel = Color(0, 0, 0)
        val border = UiStyle.Colors.contrast(panel, UiStyle.Colors.BORDER_DELTA)
        val hover = UiStyle.Colors.blend(panel, border, UiStyle.Colors.HOVER_ALPHA)

        assertTrue(hover.red > panel.red)
        assertTrue(hover.red < border.red)
        assertEquals(hover.red, hover.green)
        assertEquals(hover.green, hover.blue)
    }

    fun `test card helpers provide shared geometry`() {
        assertNotNull(UiStyle.Card.layout())
        assertNotNull(UiStyle.Card.border())
        assertNotNull(UiStyle.Card.divider())
        assertNotNull(UiStyle.Card.headerInsets())
        assertNotNull(UiStyle.Card.bodyInsets())
        assertTrue(UiStyle.Card.groupGap() > 0)
    }
}
