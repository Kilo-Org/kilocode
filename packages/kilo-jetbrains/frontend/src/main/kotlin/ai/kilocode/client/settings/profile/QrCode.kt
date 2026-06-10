package ai.kilocode.client.settings.profile

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.awt.Color
import java.awt.image.BufferedImage
import javax.swing.ImageIcon

internal object QrCode {

    /**
     * Generate a QR code image for [text].
     *
     * Uses black modules on a white background regardless of IDE theme — this is
     * intentional for scanning reliability (QR scanners expect high contrast B/W).
     *
     * @param text URL or text to encode; must not be blank.
     * @param size pixel dimension for both width and height.
     * @throws IllegalArgumentException if [text] is blank.
     */
    fun image(text: String, size: Int = 160): BufferedImage {
        require(text.isNotBlank()) { "QR text must not be blank" }
        val hints = mapOf(EncodeHintType.MARGIN to 2)
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
        val img = BufferedImage(size, size, BufferedImage.TYPE_INT_RGB)
        for (y in 0 until size) {
            for (x in 0 until size) {
                img.setRGB(x, y, if (matrix[x, y]) Color.BLACK.rgb else Color.WHITE.rgb)
            }
        }
        return img
    }

    /**
     * Convenience wrapper that returns the QR code as an [ImageIcon].
     *
     * @param text URL or text to encode; must not be blank.
     * @param size pixel dimension for both width and height.
     */
    fun icon(text: String, size: Int = 160): ImageIcon = ImageIcon(image(text, size))
}
