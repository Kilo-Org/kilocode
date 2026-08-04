package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase

class DiffStatBadgeTest : BasePlatformTestCase() {
    fun `test hides deletion label when deletions are zero`() {
        val badge = DiffStatBadge(3, 0)

        assertTrue(badge.addedLabelForTest().isVisible)
        assertEquals("+3", badge.addedLabelForTest().text)
        assertFalse(badge.removedLabelForTest().isVisible)
    }

    fun `test hides addition label when additions are zero`() {
        val badge = DiffStatBadge(0, 2)

        assertTrue(badge.removedLabelForTest().isVisible)
        assertEquals("-2", badge.removedLabelForTest().text)
        assertFalse(badge.addedLabelForTest().isVisible)
    }

    fun `test both zero leaves badge empty`() {
        val badge = DiffStatBadge(0, 0)

        assertFalse(badge.removedLabelForTest().isVisible)
        assertFalse(badge.addedLabelForTest().isVisible)
    }

    fun `test update toggles zero side visibility`() {
        val badge = DiffStatBadge(1, 1)

        badge.update(0, 4)
        assertTrue(badge.removedLabelForTest().isVisible)
        assertFalse(badge.addedLabelForTest().isVisible)

        badge.update(5, 0)
        assertFalse(badge.removedLabelForTest().isVisible)
        assertTrue(badge.addedLabelForTest().isVisible)

        badge.update(0, 0)
        assertFalse(badge.removedLabelForTest().isVisible)
        assertFalse(badge.addedLabelForTest().isVisible)
    }
}
