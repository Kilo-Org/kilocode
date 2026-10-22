package ai.kilocode.client.settings.auth

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.awt.Color
import java.awt.image.BufferedImage
import javax.swing.ImageIcon

internal object QrCode {
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

    fun icon(text: String, size: Int = 160): ImageIcon = ImageIcon(image(text, size))
}
