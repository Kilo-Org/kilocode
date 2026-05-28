package ai.kilocode.client.settings

import ai.kilocode.client.settings.profile.QrCode
import java.awt.Color
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class QrCodeTest {

    @Test
    fun `generates qr image with requested size`() {
        val img = QrCode.image("https://app.kilo.ai/device-auth?code=TEST", 64)
        assertEquals(64, img.width)
        assertEquals(64, img.height)
    }

    @Test
    fun `generated image contains black and white pixels`() {
        val img = QrCode.image("https://app.kilo.ai/device-auth?code=TEST", 64)
        var hasBlack = false
        var hasWhite = false
        outer@ for (y in 0 until img.height) {
            for (x in 0 until img.width) {
                val rgb = img.getRGB(x, y)
                if (rgb == Color.BLACK.rgb) hasBlack = true
                if (rgb == Color.WHITE.rgb) hasWhite = true
                if (hasBlack && hasWhite) break@outer
            }
        }
        assertTrue(hasBlack, "QR image should have black pixels")
        assertTrue(hasWhite, "QR image should have white pixels")
    }

    @Test
    fun `different inputs produce different images`() {
        val a = QrCode.image("https://auth.kilo.ai/device?code=AAA", 64)
        val b = QrCode.image("https://auth.kilo.ai/device?code=ZZZ", 64)
        var differs = false
        outer@ for (y in 0 until a.height) {
            for (x in 0 until a.width) {
                if (a.getRGB(x, y) != b.getRGB(x, y)) {
                    differs = true
                    break@outer
                }
            }
        }
        assertTrue(differs, "Images for different URLs should differ in at least one pixel")
    }

    @Test
    fun `blank input throws IllegalArgumentException`() {
        assertFailsWith<IllegalArgumentException> {
            QrCode.image("")
        }
    }

    @Test
    fun `whitespace-only input throws IllegalArgumentException`() {
        assertFailsWith<IllegalArgumentException> {
            QrCode.image("   ")
        }
    }

    @Test
    fun `icon wraps image with correct dimensions`() {
        val icon = QrCode.icon("https://auth.kilo.ai/device", 64)
        assertEquals(64, icon.iconWidth)
        assertEquals(64, icon.iconHeight)
    }
}
