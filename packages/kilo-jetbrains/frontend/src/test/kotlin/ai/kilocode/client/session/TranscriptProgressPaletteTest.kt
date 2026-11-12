package ai.kilocode.client.session

import ai.kilocode.client.agentManager.worktree.WorktreeIcons
import ai.kilocode.client.ui.AnimationIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.edtWait
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.image.BufferedImage
import javax.swing.Icon
import javax.swing.UIManager
import kotlin.math.abs

class TranscriptProgressPaletteTest : BasePlatformTestCase() {
    fun `test default brand is logo yellow with progressively lighter progress colors`() = isolated {
        val primary = UiStyle.Colors.Brand.primary
        val light = UiStyle.Colors.Brand.light
        val pale = UiStyle.Colors.Brand.pale

        assertEquals(Color(0xFFDD00).rgb, primary.rgb)
        assertEquals(Color(0xFFE859).rgb, light.rgb)
        assertEquals(Color(0xFFF3A5).rgb, pale.rgb)
        assertEquals(light.rgb, UiStyle.Colors.Brand.progress(0f).rgb)
        assertEquals(Color(0xFFED7F).rgb, UiStyle.Colors.Brand.progress(0.5f).rgb)
        assertEquals(pale.rgb, UiStyle.Colors.Brand.progress(1f).rgb)

        val colors = listOf(primary) + (0..4).map { UiStyle.Colors.Brand.progress(it / 4f) }
        for ((before, after) in colors.zipWithNext()) {
            assertEquals(255, after.alpha)
            assertTrue("Red must not darken", after.red >= before.red)
            assertTrue("Green must become lighter", after.green > before.green)
            assertTrue("Blue must become lighter", after.blue > before.blue)
        }
    }

    fun `test brand override updates held tokens and cached frames without recoloring default spinner`() = isolated {
        val primary = UiStyle.Colors.Brand.primary
        val light = UiStyle.Colors.Brand.light
        val pale = UiStyle.Colors.Brand.pale
        val branded = SpinnerIcon.branded as AnimationIcon
        val frames = (0 until 12).map { branded.frame(it * 100L).icon }
        val yellow = frames.map { pixels(it) }
        val neutral = SpinnerIcon.icon as AnimationIcon
        val gray = SpinnerIcon.color().rgb
        val baseline = (0 until 12).map { pixels(neutral.frame(it * 100L).icon) }

        assertSame("Agent Manager must retain the original neutral icon", SpinnerIcon.icon, WorktreeIcons.running)
        assertTrue(gray == UiStyle.Colors.runningLight.rgb || gray == UiStyle.Colors.runningDark.rgb)
        assertEquals(UiStyle.Colors.running().rgb, gray)
        val color = Color(gray, true)
        val colors = baseline.flatMap { it.filter { pixel -> pixel ushr 24 >= 64 } }.map { Color(it, true) }
        assertTrue(colors.isNotEmpty())
        assertTrue("The default spinner's actual pixels must remain neutral", colors.all {
            abs(it.red - color.red) <= 3 && abs(it.green - color.green) <= 3 && abs(it.blue - color.blue) <= 3
        })

        UIManager.put("Kilo.Brand.primary", Color.BLUE)

        assertSame(primary, UiStyle.Colors.Brand.primary)
        assertSame(light, UiStyle.Colors.Brand.light)
        assertSame(pale, UiStyle.Colors.Brand.pale)
        assertEquals(Color.BLUE.rgb, primary.rgb)
        assertEquals(Color(89, 89, 255).rgb, light.rgb)
        assertEquals(Color(165, 165, 255).rgb, pale.rgb)
        assertEquals(Color(127, 127, 255).rgb, UiStyle.Colors.Brand.progress(0.5f).rgb)
        assertSame(branded, SpinnerIcon.branded)
        frames.zip(yellow).forEachIndexed { index, (frame, before) ->
            assertSame(frame, branded.frame(index * 100L).icon)
            val blue = pixels(frame)
            assertFalse("Retained frame $index must resolve the new palette when painted", before.contentEquals(blue))
            val visible = blue.filter { it ushr 24 >= 64 }.map { Color(it, true) }
            assertTrue(visible.isNotEmpty())
            assertTrue("The overridden palette must reach actual frame pixels", visible.all { it.blue > it.red && it.blue > it.green })
        }
        assertEquals(gray, SpinnerIcon.color().rgb)
        assertSame(neutral, SpinnerIcon.icon)
        assertSame(neutral, WorktreeIcons.running)
        baseline.forEachIndexed { index, before ->
            assertTrue("Neutral frame $index changed under a brand override", before.contentEquals(pixels(neutral.frame(index * 100L).icon)))
        }

        UIManager.put("Kilo.Brand.primary", null)

        assertEquals(Color(0xFFDD00).rgb, primary.rgb)
        assertEquals(Color(0xFFE859).rgb, light.rgb)
        assertEquals(Color(0xFFF3A5).rgb, pale.rgb)
        frames.zip(yellow).forEach { (frame, before) ->
            assertTrue("The same cached frame must return to yellow", before.contentEquals(pixels(frame)))
        }
        baseline.forEachIndexed { index, before ->
            assertTrue("Neutral frame $index changed after exercising the brand palette", before.contentEquals(pixels(neutral.frame(index * 100L).icon)))
        }
    }

    fun `test branded spinner preserves twelve frame timing dimensions and alpha geometry at every scale`() = isolated {
        val neutral = SpinnerIcon.icon as AnimationIcon
        val branded = SpinnerIcon.branded as AnimationIcon
        assertTrue(neutral is AnimationIcon.Cycle)
        assertTrue(branded is AnimationIcon.Cycle)
        assertTrue(neutral is AnimatedIcon)
        assertTrue(branded is AnimatedIcon)
        assertNotSame(neutral, branded)

        for (scale in listOf(1f, 1.5f, 2f)) {
            JBUIScale.setUserScaleFactorForTest(scale)
            val masks = mutableListOf<List<Int>>()
            for (index in 0 until 12) {
                val time = index * 100L
                val plain = neutral.frame(time).icon
                val tinted = branded.frame(time).icon
                for (icon in listOf(plain, tinted)) {
                    assertEquals(JBUI.scale(16), icon.iconWidth)
                    assertEquals(JBUI.scale(16), icon.iconHeight)
                }
                for (offset in listOf(0L, 37L, 99L)) {
                    assertSame(plain, neutral.frame(time + offset).icon)
                    assertSame(tinted, branded.frame(time + offset).icon)
                    assertEquals((100L - offset).toInt(), neutral.frame(time + offset).delay)
                    assertEquals((100L - offset).toInt(), branded.frame(time + offset).delay)
                }
                assertSame(plain, neutral.frame(time + 1200L).icon)
                assertSame(tinted, branded.frame(time + 1200L).icon)
                assertSame(tinted, branded.frame(time + 1_200_000L).icon)

                val expected = pixels(plain).map { it ushr 24 }
                val actual = pixels(tinted).map { it ushr 24 }
                assertEquals("Frame $index at ${scale}x must change only RGB, not shape or opacity", expected, actual)
                assertTrue("Frame $index must paint visible squares", actual.any { it > 0 })
                val width = tinted.iconWidth
                for (corner in listOf(0, width - 1, actual.size - width, actual.size - 1)) {
                    assertEquals("Grid corners must stay transparent", 0, actual.getOrNull(corner))
                }
                masks.add(actual)
            }
            assertEquals("All twelve opacity frames must remain distinct", 12, masks.toSet().size)
            assertEquals(12, (0 until 12).map { branded.frame(it * 100L).icon }.toSet().size)
        }
    }

    fun `test actual branded spinner frames contain varying lighter yellow tones`() = isolated {
        JBUIScale.setUserScaleFactorForTest(2f)
        val branded = SpinnerIcon.branded as AnimationIcon
        for (index in 0 until 12) {
            // Ignore low-coverage antialiased edges, where RGB unpremultiplication loses precision.
            val colors = pixels(branded.frame(index * 100L).icon)
                .filter { it ushr 24 >= 64 }
                .map { Color(it, true) }
            assertTrue("Frame $index must paint visible yellow squares", colors.isNotEmpty())
            assertTrue("Frame $index must use lighter yellow, not neutral gray or the unblended primary", colors.all {
                it.red >= 250 && it.red > it.green && it.green > it.blue && it.green > 221 && it.blue > 0
            })
            assertTrue("Frame $index must vary its yellow tint across the pulsing squares", colors.maxOf { it.blue } - colors.minOf { it.blue } >= 20)
        }
    }

    fun `test avatar palette opt in recolors only running lit dots and preserves identity geometry`() = isolated {
        val id = "ses_bbb"
        val identity = AgentAvatarIdentity.identity(id)
        for (scale in listOf(1f, 1.5f, 2f)) {
            JBUIScale.setUserScaleFactorForTest(scale)
            for (slot in listOf(null, 3)) {
                val hue = UiStyle.Colors.avatarHue(slot ?: requireNotNull(identity.color)).rgb
                val static = AgentAvatar.static(id, color = slot)
                val running = AgentAvatar.running(id, color = slot)
                val branded = AgentAvatar.running(id, color = slot, palette = UiStyle.Colors.Brand::progress)
                val baseline = pixels(static)
                val opaque = baseline.map { it ushr 24 == 255 }

                assertTrue("The identity must contain fully opaque lit dots", opaque.any { it })
                assertFalse(static is AnimatedIcon)
                assertTrue(running is AnimatedIcon)
                assertTrue(branded is AnimatedIcon)
                assertFalse("The default avatar must remain a native animation", running is AnimationIcon)
                assertFalse("The opt-in avatar must remain a native animation", branded is AnimationIcon)

                // Lit dots always use alpha=1 and palette amount=1. Unlit dots stay below half opacity,
                // so only fully opaque pixels are sampled, independently of the native animation clock.
                for ((icon, color) in listOf(static to hue, running to hue, branded to UiStyle.Colors.Brand.pale.rgb)) {
                    assertEquals(JBUI.scale(16), icon.iconWidth)
                    assertEquals(JBUI.scale(16), icon.iconHeight)
                    val painted = pixels(icon)
                    assertEquals("Palette changes must preserve the lit identity at ${scale}x", opaque, painted.map { it ushr 24 == 255 })
                    assertEquals("Fully opaque dots must use the expected hue", setOf(color), painted.filter { it ushr 24 == 255 }.toSet())
                }
                assertTrue("Exercising a running palette must not change the static identity", baseline.contentEquals(pixels(static)))
                assertFalse("The branded lit dots must differ from the identity hue", hue == UiStyle.Colors.Brand.pale.rgb)
            }
        }
    }

    private fun isolated(block: () -> Unit) = edtWait {
        val previous = listOf("Kilo.Brand.primary", "Kilo.Activity.runningSpinnerForeground")
            .associateWith { UIManager.get(it) }
        val scale = JBUIScale.scale(1f)
        try {
            previous.keys.forEach { UIManager.put(it, null) }
            JBUIScale.setUserScaleFactorForTest(1f)
            block()
        } finally {
            previous.forEach { (key, value) -> UIManager.put(key, value) }
            JBUIScale.setUserScaleFactorForTest(scale)
        }
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
