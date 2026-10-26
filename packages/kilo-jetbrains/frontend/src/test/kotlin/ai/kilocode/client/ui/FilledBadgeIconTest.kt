package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.scale.JBUIScale
import java.awt.Color
import java.awt.image.BufferedImage

/**
 * A [FilledBadgeIcon] instance is retained by its owning label across an IDE zoom — callers only
 * recreate it when the badge text or style changes, see `ActiveListBadgeCell.update` — so its geometry
 * has to be measured per call rather than captured once.
 */
@Suppress("UnstableApiUsage")
class FilledBadgeIconTest : BasePlatformTestCase() {

    fun `test icon geometry grows after a zoom without recreating the icon`() {
        val original = JBUIScale.scale(1f)
        try {
            JBUIScale.setUserScaleFactorForTest(1f)
            val icon = FilledBadgeIcon("12", UiStyle.Badge.Secondary)
            val width = icon.iconWidth
            val height = icon.iconHeight

            JBUIScale.setUserScaleFactorForTest(2f)

            assertTrue("expected a wider badge after the zoom, was $width then ${icon.iconWidth}", icon.iconWidth > width)
            assertEquals("expected the badge height to scale exactly once", height * 2, icon.iconHeight)
        } finally {
            JBUIScale.setUserScaleFactorForTest(original)
        }
    }

    fun `test combined badge joins independently colored segments`() {
        val mcp = UiStyle.Badge.typeMcp(true)
        val skill = UiStyle.Badge.typeSkill(true)
        val icon = FilledBadgeIcon(
            listOf(
                FilledBadgeIcon.Segment("MCP", mcp),
                FilledBadgeIcon.Segment("Skill", skill),
            ),
        )

        assertEquals("MCP|Skill", icon.text)
        assertEquals(
            FilledBadgeIcon("MCP", mcp).iconWidth + FilledBadgeIcon("Skill", skill).iconWidth,
            icon.iconWidth,
        )

        val image = BufferedImage(icon.iconWidth, icon.iconHeight, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            icon.paintIcon(null, g, 0, 0)
        } finally {
            g.dispose()
        }
        val pixels = (0 until image.width).flatMap { x ->
            (0 until image.height).map { y -> Color(image.getRGB(x, y), true) }
        }
        assertTrue("expected the MCP segment color", pixels.any { it.rgb == mcp.bg().rgb })
        assertTrue("expected the Skill segment color", pixels.any { it.rgb == skill.bg().rgb })
        assertTrue("expected antialiasing on the rounded edge", pixels.any { it.alpha in 1..254 })
    }
}
