package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.RoundedContentPanel
import com.intellij.util.ui.JBUI
import java.awt.Color
import java.awt.Graphics

/**
 * A raised, opaque session block. Paints the shared code-block background with the standard session
 * block corner arc (the same arc as the card header hover) and no outline, so any view that needs an
 * opaque background gets the same rounded chrome without re-implementing the painting.
 *
 * The panel carries no padding — content decides its own insets (most views add a left inset to line
 * up with the header, while shell code and patch/diff blocks span the full width). Children are
 * clipped to the rounded rectangle, so an opaque rectangular child never squares off the corners.
 */
open class SessionSurfacePanel : RoundedContentPanel(0, 0, 0, 0) {

    override fun contentColor(): Color = SessionUiStyle.Colors.codeBlockBackground()

    override fun outlineColor(): Color? = null

    override fun cornerArc(): Int = JBUI.scale(SessionUiStyle.View.BLOCK_ARC)

    override fun paintChildren(g: Graphics) {
        SessionSurface.clipped(g, width, height) { super.paintChildren(it) }
    }
}
