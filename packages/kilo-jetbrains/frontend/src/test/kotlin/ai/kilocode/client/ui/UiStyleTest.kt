package ai.kilocode.client.ui

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.rpc.dto.GhState
import com.intellij.openapi.editor.HighlighterColors
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.openapi.editor.colors.impl.EditorColorsSchemeImpl
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.awt.image.BufferedImage

@Suppress("UnstableApiUsage")
class UiStyleTest : BasePlatformTestCase() {

    /**
     * [UiStyle.Gap]'s unscaled constants exist for APIs that scale what they are handed (notably
     * [JBUI.Borders]) — feeding them the scaled function result instead double-scales the value. This
     * pins each constant to the pixel count its matching function reports at 1x, so the two can never
     * silently drift apart.
     */
    fun `test gap constants match their scaled functions at 1x`() {
        val original = JBUIScale.scale(1f)
        try {
            JBUIScale.setUserScaleFactorForTest(1f)

            assertEquals(UiStyle.Gap.XS, UiStyle.Gap.xs())
            assertEquals(UiStyle.Gap.SM, UiStyle.Gap.sm())
            assertEquals(UiStyle.Gap.MD, UiStyle.Gap.md())
            assertEquals(UiStyle.Gap.LG, UiStyle.Gap.lg())
            assertEquals(UiStyle.Gap.PAD, UiStyle.Gap.pad())
            assertEquals(UiStyle.Gap.XL, UiStyle.Gap.xl())
        } finally {
            JBUIScale.setUserScaleFactorForTest(original)
        }
    }

    fun `test gap constants scale exactly once through JBUI scale`() {
        val original = JBUIScale.scale(1f)
        try {
            JBUIScale.setUserScaleFactorForTest(2f)

            assertEquals(UiStyle.Gap.md(), JBUI.scale(UiStyle.Gap.MD))
            assertEquals(UiStyle.Gap.pad(), JBUI.scale(UiStyle.Gap.PAD))
        } finally {
            JBUIScale.setUserScaleFactorForTest(original)
        }
    }

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
        val hover = UiStyle.Colors.blend(panel, border, SessionUiStyle.View.HOVER_FILL_ALPHA)

        assertTrue(hover.red > panel.red)
        assertTrue(hover.red < border.red)
        assertEquals(hover.red, hover.green)
        assertEquals(hover.green, hover.blue)
    }

    fun `test retained editor background follows custom active schemes`() {
        val manager = EditorColorsManager.getInstance()
        val original = manager.globalScheme
        val first = original.clone() as EditorColorsScheme
        val second = original.clone() as EditorColorsScheme
        first.setAttributes(HighlighterColors.TEXT, TextAttributes(Color.WHITE, Color.BLUE, null, null, 0))
        second.setAttributes(HighlighterColors.TEXT, TextAttributes(Color.BLACK, Color.YELLOW, null, null, 0))
        try {
            manager.setGlobalScheme(first)
            val color = UiStyle.Colors.editorBackground()
            assertEquals(Color.BLUE.rgb, color.rgb)

            manager.setGlobalScheme(second)
            assertEquals(Color.YELLOW.rgb, color.rgb)
        } finally {
            manager.setGlobalScheme(original)
        }
    }

    fun `test editor background falls back while editable default is unavailable`() {
        val color = UiStyle.Colors.editorBackground()
        val original = color.rgb

        unavailable {
            assertEquals(UIUtil.getPanelBackground().rgb, color.rgb)
        }

        assertEquals(original, color.rgb)
    }

    fun `test session backdrop paints while editable default is unavailable`() {
        val root = SessionRootPanel().apply { setSize(120, 80) }
        val count = root.componentCount
        val image = BufferedImage(120, 80, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            unavailable {
                repeat(200) {
                    root.paint(graphics)
                    assertEquals(root.background.rgb, image.getRGB(1, 1))
                    assertEquals(count, root.componentCount)
                }
            }
            root.paint(graphics)
            assertEquals(root.background.rgb, image.getRGB(1, 1))
        } finally {
            graphics.dispose()
        }
    }

    fun `test session layout constants provide shared geometry`() {
        assertTrue(JBUI.scale(SessionUiStyle.SessionLayout.GAP) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.Layout.GAP) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING) > 0)
        assertTrue(JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING) > 0)
        assertTrue(SessionUiStyle.View.Tool.BODY_LINES > 0)
        assertEquals(5, SessionUiStyle.View.Reasoning.BODY_LINES)
    }

    fun `test session status badges use shared styles`() {
        assertSame(UiStyle.Badge.ActivityRunning, SessionActivityKind.RUNNING.style())
        assertSame(UiStyle.Badge.ActivityAttention, SessionActivityKind.QUESTION.style())
        assertSame(UiStyle.Badge.ActivityAttention, SessionActivityKind.PLAN.style())
        assertSame(UiStyle.Badge.ActivityAttention, SessionActivityKind.PERMISSION.style())
        assertSame(UiStyle.Badge.ActivityAttention, SessionActivityKind.LOGIN_REQUIRED.style())
        assertSame(UiStyle.Badge.ActivityError, SessionActivityKind.ERROR.style())
    }

    fun `test pull request states use github badge styles`() {
        assertSame(UiStyle.Badge.PullRequestOpen, style(GhState.OPEN))
        assertSame(UiStyle.Badge.PullRequestDraft, style(GhState.DRAFT))
        assertSame(UiStyle.Badge.PullRequestMerged, style(GhState.MERGED))
        assertSame(UiStyle.Badge.PullRequestClosed, style(GhState.CLOSED))
    }

    fun `test pull request badges use soft accent backgrounds`() {
        val styles = listOf(
            UiStyle.Badge.PullRequestOpen,
            UiStyle.Badge.PullRequestDraft,
            UiStyle.Badge.PullRequestMerged,
            UiStyle.Badge.PullRequestClosed,
        )

        styles.forEach { style ->
            assertTrue(style.bg().alpha < Color.WHITE.alpha)
            assertEquals(Color.WHITE.alpha, style.fg().alpha)
        }
    }

    private fun unavailable(block: () -> Unit) {
        val manager = EditorColorsManager.getInstance()
        val original = manager.globalScheme
        val base = requireNotNull(manager.getScheme(EditorColorsManager.getDefaultSchemeName()))
        val hidden = (base.clone() as EditorColorsSchemeImpl).apply {
            setName("KiloUnavailableFixture")
            setVisible(false)
        }
        try {
            manager.setGlobalScheme(base)
            val editable = requireNotNull(manager.activeVisibleScheme)
            val name = editable.name
            try {
                // Recreate the reload gap using public scheme APIs, without removing registered schemes.
                editable.setName("KiloUnavailableScheme")
                manager.setGlobalScheme(hidden)
                assertNull(manager.getScheme(name))
                assertNull(manager.activeVisibleScheme)
                block()
            } finally {
                editable.setName(name)
            }
        } finally {
            manager.setGlobalScheme(original)
        }
    }
}
