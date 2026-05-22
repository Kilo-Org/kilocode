package ai.kilocode.client.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI
import java.awt.Color

@Suppress("UnstableApiUsage")
class UiStyleTest : BasePlatformTestCase() {

    fun `test border is lighter than dark panel`() {
        val panel = Color(0, 0, 0)
        val border = UiStyle.Colors.contrast(panel, SessionUiStyle.View.BORDER_DELTA)

        assertTrue(border.red > panel.red)
        assertTrue(border.green > panel.green)
        assertTrue(border.blue > panel.blue)
    }

    fun `test border is darker than light panel`() {
        val panel = Color(255, 255, 255)
        val border = UiStyle.Colors.contrast(panel, SessionUiStyle.View.BORDER_DELTA)

        assertTrue(border.red < panel.red)
        assertTrue(border.green < panel.green)
        assertTrue(border.blue < panel.blue)
    }

    fun `test hover blends from panel toward border`() {
        val panel = Color(0, 0, 0)
        val border = UiStyle.Colors.contrast(panel, SessionUiStyle.View.BORDER_DELTA)
        val hover = UiStyle.Colors.blend(panel, border, SessionUiStyle.View.HOVER_ALPHA)

        assertTrue(hover.red > panel.red)
        assertTrue(hover.red < border.red)
        assertEquals(hover.red, hover.green)
        assertEquals(hover.green, hover.blue)
    }

    fun `test session layout constants provide shared geometry`() {
        assertTrue(JBUI.scale(SessionUiStyle.SessionLayout.GAP) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.CARD_LAYOUT_GAP) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.CARD_VERTICAL_PADDING) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.CARD_HORIZONTAL_PADDING) > 0)
        assertTrue(SessionUiStyle.View.Tool.BODY_LINES > 0)
        assertTrue(SessionUiStyle.View.Reasoning.BODY_LINES > 0)
    }
}
