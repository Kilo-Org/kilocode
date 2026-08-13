package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.RoundedContentPanel
import com.intellij.util.ui.JBUI
import java.awt.Color

/**
 * A raised, opaque session surface. Paints the shared code-block background with the standard
 * session block corner arc and no outline, so any view that needs an opaque background gets the
 * same rounded chrome without re-implementing the painting.
 *
 * Following the single-backdrop session strategy, the content placed inside stays transparent and
 * lets this rounded fill show through. The default horizontal inset is at least [SessionUiStyle.View.BLOCK_ARC],
 * so a rectangular opaque child never squares off the rounded corners.
 */
open class SessionSurfacePanel(
    top: Int = JBUI.scale(SessionUiStyle.View.Layout.VERTICAL_PADDING),
    left: Int = JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING),
    bottom: Int = top,
    right: Int = left,
) : RoundedContentPanel(top, left, bottom, right) {

    override fun contentColor(): Color = SessionUiStyle.Colors.codeBlockBackground()

    override fun outlineColor(): Color? = null

    override fun cornerArc(): Int = JBUI.scale(SessionUiStyle.View.BLOCK_ARC)
}
