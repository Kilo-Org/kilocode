package ai.kilocode.client.session.ui

import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import java.awt.Component

/**
 * Reusable body for an expanded session card. A transparent vertical column that stacks content
 * surfaces (usually [SessionSurfacePanel] boxes) separated by the standard [SessionUiStyle.View.contentGap],
 * followed by a transparent footer region where a view can add ambient components — for example an
 * auto-approved note — that read on the session backdrop rather than on a raised surface.
 *
 * The panel itself paints nothing: content pieces bring their own opaque surface, and the footer
 * stays transparent, so the session's single-backdrop strategy is preserved and views never
 * duplicate background painting.
 */
class SessionContentPanel : Stack(StackAxis.VERTICAL, SessionUiStyle.View.contentGap()) {

    private val body = Stack.vertical(SessionUiStyle.View.contentGap())
    private val footer = Stack.vertical(SessionUiStyle.View.contentGap()).also { it.isVisible = false }

    init {
        next(body)
        next(footer)
    }

    /** Adds a content piece (its own raised surface) below the previous one, separated by the standard gap. */
    fun content(component: Component): SessionContentPanel {
        body.next(component)
        return this
    }

    /** Adds a transparent footer component below the content; the footer region appears only once used. */
    fun footer(component: Component): SessionContentPanel {
        footer.next(component)
        footer.isVisible = true
        return this
    }

    /** True while the footer region holds at least one component. */
    fun hasFooter(): Boolean = footer.componentCount > 0
}
