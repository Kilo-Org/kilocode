package ai.kilocode.client.session.ui.style

import ai.kilocode.client.ui.UiStyle
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Color
import javax.swing.UIManager

@Suppress("UnstableApiUsage")
class SessionUiStyleTest : BasePlatformTestCase() {

    fun `test session background shifts when panel matches the raised editor surface`() {
        val raised = SessionUiStyle.Colors.codeBlockBackground()
        val previous = UIManager.getColor("Panel.background")
        try {
            // Force the Islands case: the panel/backdrop is exactly the raised editor surface.
            UIManager.put("Panel.background", Color(raised.rgb))
            val bg = SessionUiStyle.Colors.sessionBackground()

            // When the panel equals the raised surface the backdrop must shift to a distinct color:
            // lighter in dark themes, darker in light themes.
            assertTrue("Backdrop must not equal the raised surface", raised.rgb != bg.rgb)
            val dark = raised.red * 0.299 + raised.green * 0.587 + raised.blue * 0.114 < 128
            if (dark) {
                assertTrue("Dark themes shift the backdrop lighter", brighter(bg, raised))
            } else {
                assertTrue("Light themes shift the backdrop darker", darker(bg, raised))
            }
        } finally {
            UIManager.put("Panel.background", previous)
        }
    }

    fun `test session background follows the panel when it differs from the raised surface`() {
        val previous = UIManager.getColor("Panel.background")
        try {
            val panel = UiStyle.Colors.contrast(SessionUiStyle.Colors.codeBlockBackground(), 40)
            UIManager.put("Panel.background", panel)

            assertEquals(panel.rgb, SessionUiStyle.Colors.sessionBackground().rgb)
        } finally {
            UIManager.put("Panel.background", previous)
        }
    }

    fun `test secondary text blends foreground toward session background and uses regular font`() {
        val style = SessionEditorStyle.create(family = "Courier New", size = 22)
        val bg = UIManager.getColor("Kilo.Session.background")
        val fg = UIManager.getColor("Kilo.Session.foreground")
        try {
            UIManager.put("Kilo.Session.background", Color.BLACK)
            UIManager.put("Kilo.Session.foreground", Color.WHITE)
            assertTrue(luminance(SessionUiStyle.Text.Secondary.foreground()) < luminance(SessionUiStyle.Colors.foreground()))

            UIManager.put("Kilo.Session.background", Color.WHITE)
            UIManager.put("Kilo.Session.foreground", Color.BLACK)
            assertTrue(luminance(SessionUiStyle.Text.Secondary.foreground()) > luminance(SessionUiStyle.Colors.foreground()))
        } finally {
            UIManager.put("Kilo.Session.background", bg)
            UIManager.put("Kilo.Session.foreground", fg)
        }

        assertEquals(UiStyle.Fonts.regular(), SessionUiStyle.Text.Secondary.font(style))
    }

    private fun brighter(shifted: Color, base: Color) =
        shifted.red >= base.red && shifted.green >= base.green && shifted.blue >= base.blue

    private fun darker(shifted: Color, base: Color) =
        shifted.red <= base.red && shifted.green <= base.green && shifted.blue <= base.blue

    private fun luminance(color: Color) = color.red * 0.299 + color.green * 0.587 + color.blue * 0.114
}
