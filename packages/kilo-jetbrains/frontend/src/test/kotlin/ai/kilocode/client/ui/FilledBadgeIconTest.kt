package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.scale.JBUIScale

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
}
