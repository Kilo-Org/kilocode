package ai.kilocode.client.ui

import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.Transferable
import java.awt.datatransfer.UnsupportedFlavorException
import java.awt.image.BufferedImage

/**
 * Puts [image] on the clipboard, so pasting lands a picture rather than text.
 *
 * Only [DataFlavor.imageFlavor] is offered, matching the platform's own image editor: adding a text
 * flavor would let apps that prefer text paste that instead of the picture.
 */
@RequiresEdt
internal fun copyImage(image: BufferedImage) {
    CopyPasteManager.getInstance().setContents(Picture(image))
}

private class Picture(private val image: BufferedImage) : Transferable {
    override fun getTransferDataFlavors(): Array<DataFlavor> = arrayOf(DataFlavor.imageFlavor)

    override fun isDataFlavorSupported(flavor: DataFlavor): Boolean = DataFlavor.imageFlavor == flavor

    override fun getTransferData(flavor: DataFlavor): Any {
        if (DataFlavor.imageFlavor != flavor) throw UnsupportedFlavorException(flavor)
        return image
    }
}
