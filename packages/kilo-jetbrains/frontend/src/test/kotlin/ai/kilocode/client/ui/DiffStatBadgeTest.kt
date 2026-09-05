package ai.kilocode.client.ui

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.image.BufferedImage

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

    /**
     * The conflict marker is a circle behind the pill, so what has to hold is that it shows past the pill's
     * trailing edge, that it takes its own room rather than covering whatever sits after the badge, and that
     * the counts stay where they were when it appears.
     */
    fun `test a conflict marks the badge past its trailing edge without moving the counts`() {
        val badge = DiffStatBadge(9, 3, DiffStatBadge.Variant.COMPACT)
        val plain = paint(badge)
        badge.conflict = true
        val marked = paint(badge)
        val over = marked.width - plain.width

        assertTrue("the marker must take trailing room of its own, not a neighbour's", over > 0)
        assertEquals(plain.height, marked.height)
        // The pill's leading half carries the text, and the marker sits at the far end of the badge, so
        // anything the marker changed there would be the counts having shifted.
        val lead = plain.width / 2
        assertTrue("the counts moved when the marker appeared", same(crop(plain, lead), crop(marked, lead)))
        // Widest where the pill ends, which is where the circle's own centre sits.
        assertEquals(
            "the trailing edge is not marked",
            UiStyle.Badge.ActivityError.bg().rgb,
            marked.getRGB(plain.width, marked.height / 2),
        )
    }

    fun `test a badge with no conflict paints no marker at all`() {
        val image = paint(DiffStatBadge(9, 3, DiffStatBadge.Variant.COMPACT))
        val marker = UiStyle.Badge.ActivityError.bg().rgb

        for (x in 0 until image.width) {
            for (y in 0 until image.height) {
                assertTrue("marked at $x,$y with nothing to report", image.getRGB(x, y) != marker)
            }
        }
    }

    fun `test a fill-less badge has no pill for a marker to sit behind`() {
        val badge = DiffStatBadge(9, 3, DiffStatBadge.Variant.COMPACT, fill = false)
        val plain = badge.preferredSize.width

        badge.conflict = true

        // Text alone: a circle behind it would be a blob with nothing to explain it.
        assertEquals(plain, badge.preferredSize.width)
    }

    private fun paint(badge: DiffStatBadge): BufferedImage {
        val size = badge.preferredSize
        badge.size = size
        badge.doLayout()
        val image = BufferedImage(size.width, size.height, BufferedImage.TYPE_INT_ARGB)
        val canvas = image.createGraphics()
        try {
            badge.paint(canvas)
        } finally {
            canvas.dispose()
        }
        return image
    }

    private fun crop(image: BufferedImage, width: Int): BufferedImage = image.getSubimage(0, 0, width, image.height)

    private fun same(a: BufferedImage, b: BufferedImage): Boolean {
        if (a.width != b.width || a.height != b.height) return false
        for (x in 0 until a.width) {
            for (y in 0 until a.height) {
                if (a.getRGB(x, y) != b.getRGB(x, y)) return false
            }
        }
        return true
    }
}
