package ai.kilocode.client.session.ui

import com.intellij.ui.components.JBScrollPane
import java.awt.Graphics
import javax.swing.JComponent

/**
 * Raised code surface for scrollable tool bodies. Paints the shared code-block background rounded
 * with the standard block arc — the same corners as the card header — and clips its content to that
 * shape so the opaque viewport never squares off the corners. Views keep their own content insets;
 * this only owns the rounded fill.
 */
internal open class SessionCodeScroll(view: JComponent) : JBScrollPane(view) {

    override fun isOpaque(): Boolean = false

    override fun paintComponent(g: Graphics) {
        SessionSurface.fill(g, width, height)
        super.paintComponent(g)
    }

    override fun paintChildren(g: Graphics) {
        SessionSurface.clipped(g, width, height) { super.paintChildren(it) }
    }
}
