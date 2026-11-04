package ai.kilocode.client.ui

import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.UIUtil
import java.awt.image.BufferedImage
import javax.swing.Icon
import javax.swing.UIManager

class AnimationIconTest : BasePlatformTestCase() {
    fun `test cycle snapshots use absolute time at frame and cycle boundaries`() = edtWait {
        val first = EmptyIcon.create(12)
        val second = EmptyIcon.create(14)
        val third = EmptyIcon.create(16)
        val icon = AnimationIcon.Cycle(100, first, second, third)
        for ((time, glyph, delay) in listOf(
            Triple(0L, first, 100),
            Triple(99L, first, 1),
            Triple(100L, second, 100),
            Triple(199L, second, 1),
            Triple(200L, third, 100),
            Triple(299L, third, 1),
            Triple(300L, first, 100),
            Triple(10_001L, second, 99),
            Triple(9_000_000_000_100L, second, 100),
            Triple(-1L, third, 1),
        )) {
            val frame = icon.frame(time)
            assertSame("Frame at $time", glyph, frame.icon)
            assertEquals("Delay at $time", delay, frame.delay)
        }
    }

    fun `test sampling out of order or after skipped cycles cannot drift animation`() = edtWait {
        val first = EmptyIcon.create(12)
        val second = EmptyIcon.create(16)
        val icon = AnimationIcon.Cycle(100, first, second)
        val frame = icon.frame(149)
        repeat(10) {
            assertSame(first, icon.frame(20_000).icon)
            assertSame(second, icon.frame(399).icon)
            assertEquals(frame, icon.frame(149))
            assertSame(first, icon.frame(0).icon)
        }
        assertSame(second, frame.icon)
        assertEquals(51, frame.delay)
    }

    fun `test a single frame is a static snapshot with no animation deadline`() = edtWait {
        val glyph = EmptyIcon.ICON_16
        val icon = AnimationIcon.Cycle(100, glyph)
        for (time in listOf(0L, 99L, 100L, 10_001L)) {
            assertSame(glyph, icon.frame(time).icon)
            assertNull(icon.frame(time).delay)
            assertNull(animationDelay(icon, time))
        }
    }

    fun `test nonpositive frame delays still advance by a positive millisecond`() = edtWait {
        val first = EmptyIcon.create(12)
        val second = EmptyIcon.create(16)
        for (delay in listOf(0, -10)) {
            val icon = AnimationIcon.Cycle(delay, first, second)
            assertSame(first, icon.frame(0).icon)
            assertSame(second, icon.frame(1).icon)
            assertSame(first, icon.frame(2).icon)
            assertEquals(1, icon.frame(0).delay)
            assertEquals(1, icon.frame(1).delay)
        }
    }

    fun `test frame and delay helpers preserve static icons and unwrap animated live badges`() = edtWait {
        val first = EmptyIcon.create(12)
        val second = EmptyIcon.create(16)
        val icon = AnimationIcon.Cycle(100, first, second)
        val badge = LiveBadgeIcon(icon, UIUtil.getLabelForeground())
        assertSame(second, animationFrame(icon, 149))
        assertEquals(51, animationDelay(icon, 149))
        val frame = animationFrame(badge, 149) as LiveBadgeIcon
        assertSame(second, frame.icon)
        assertSame(badge.paint, frame.paint)
        assertEquals(second.iconWidth, frame.iconWidth)
        assertEquals(second.iconHeight, frame.iconHeight)
        assertEquals(51, animationDelay(badge, 149))

        val still = LiveBadgeIcon(first, badge.paint)
        assertSame(first, animationFrame(first, 149))
        assertSame(still, animationFrame(still, 149))
        assertNull(animationDelay(first, 149))
        assertNull(animationDelay(still, 149))
        assertNull(animationFrame(null, 149))
        assertNull(animationDelay(null, 149))
    }

    fun `test progress snapshots retain native frames and theme derived delays`() = edtWait {
        val previous = UIManager.get("ProgressIcon.delay")
        val native = object : AnimatedIcon.Default() {
            fun frames(): Array<AnimatedIcon.Frame> = getFrames()
        }
        val icon = AnimationIcon.Progress()
        try {
            for (delay in listOf(37, 83)) {
                UIManager.put("ProgressIcon.delay", delay)
                val frames = native.frames()
                assertTrue(frames.size > 1)
                val second = frames.getOrNull(1) ?: error("Native progress has no second frame")
                assertEquals(List(frames.size) { delay }, frames.map { it.delay })
                assertEquals(frames.map { it.delay }, icon.frames().map { it.delay })
                assertEquals(delay, icon.frame(0).delay)
                assertEquals(1, icon.frame(delay - 1L).delay)
                assertEquals(delay - 7, icon.frame(delay + 7L).delay)
                assertTrue(pixels(frames.first().icon).contentEquals(pixels(icon.frame(0).icon)))
                assertTrue(pixels(second.icon).contentEquals(pixels(icon.frame(delay + 7L).icon)))
                val period = frames.sumOf { it.delay.toLong() }
                assertTrue(pixels(frames.first().icon).contentEquals(pixels(icon.frame(period).icon)))
                assertTrue(pixels(second.icon).contentEquals(pixels(icon.frame(period * 1_000 + delay).icon)))
            }
        } finally {
            UIManager.put("ProgressIcon.delay", previous)
        }
    }

    fun `test standalone cycle and progress icons remain native animated icons`() = edtWait {
        val cycle: Icon = AnimationIcon.Cycle(100, EmptyIcon.create(12), EmptyIcon.create(16))
        val progress: Icon = AnimationIcon.Progress()
        for (icon in listOf(cycle, progress)) {
            val label = JBLabel(icon)
            assertTrue(label.icon is AnimatedIcon)
            assertSame(icon, label.icon)
            assertNull(label.getClientProperty(AnimatedIcon.ANIMATION_IN_RENDERER_ALLOWED))
        }
        assertTrue(progress is AnimatedIcon.Default)
    }

    private fun pixels(icon: Icon): IntArray {
        val image = BufferedImage(icon.iconWidth, icon.iconHeight, BufferedImage.TYPE_INT_ARGB)
        val graphics = image.createGraphics()
        try {
            icon.paintIcon(null, graphics, 0, 0)
        } finally {
            graphics.dispose()
        }
        return image.getRGB(0, 0, image.width, image.height, null, 0, image.width)
    }
}
