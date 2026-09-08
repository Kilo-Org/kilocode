package ai.kilocode.client.session.ui.popup

import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.popup.SidePopupContent
import ai.kilocode.client.ui.popup.SidePopupController
import ai.kilocode.client.ui.popup.SidePopupFit
import ai.kilocode.client.ui.popup.SidePopupGeometry
import ai.kilocode.client.ui.popup.SidePopupRequest
import ai.kilocode.client.ui.popup.SidePopupSpot
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.ui.ComponentUtil
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * Header popups for the chat transcript: the dwell, balloon and lifetime rules live in
 * [SidePopupController], and this adds the chat-specific placement — beside the hovered card, height
 * budgeted to the visible session.
 */
class HeaderPopupController(timers: UiTimerSource = UiTimers) : Disposable {
    private val popup = SidePopupController(timers)

    @RequiresEdt
    fun show(view: PartView) {
        popup.show(view, view) { request(view) }
    }

    @RequiresEdt
    fun notifyExit(view: PartView) {
        popup.notifyExit(view)
    }

    @RequiresEdt
    fun hideAll() {
        popup.hideAll()
    }

    @RequiresEdt
    override fun dispose() {
        popup.dispose()
    }

    @RequiresEdt
    private fun request(view: PartView): SidePopupRequest? {
        val req = view.headerPopup() ?: return null
        return SidePopupRequest(
            build = req.build,
            place = { body -> place(view, req.anchor, body) },
            shown = req.shown,
        )
    }

    /**
     * Resolves the pointer target beside [card], the collapsible view the popup belongs to, sizing the
     * body to the space available on the chosen side and to the visible height of the chat. Pointing at
     * the card rather than the hovered row keeps the popup off the transcript instead of covering the
     * row the user is reading, and pointing at the card rather than the session edge keeps the balloon
     * attached to the thing it describes.
     *
     * Returns null when the chat is not on screen yet, in which case there is nothing to sit beside.
     */
    @RequiresEdt
    private fun place(card: JComponent, anchor: JComponent, built: SidePopupContent): SidePopupSpot? {
        val pane = SwingUtilities.getRootPane(anchor)?.layeredPane
        val chat = ComponentUtil.getParentOfType(SessionRootPanel::class.java, anchor)
        // A showing anchor implies every ancestor, including the chat, is showing and laid out.
        if (pane == null || chat == null || !anchor.isShowing) return null
        val gap = UiStyle.Gap.pad()
        val insets = UiStyle.Balloon.insets()
        // The shadow is reserved on every side, so it counts twice on each axis.
        val shadow = UiStyle.Balloon.shadow()
        val chromeHeight = insets.top + insets.bottom + shadow * 2
        // The visible chat rect, not the whole panel: a session clipped by a short tool window or a
        // scrolled editor tab must keep its popups inside the part the user can actually see.
        val area = SwingUtilities.convertRectangle(chat, chat.visibleRect, pane)
        if (area.isEmpty) return null
        val rect = SwingUtilities.convertRectangle(card.parent, card.bounds, pane)
        val spot = SidePopupGeometry.beside(
            pane = Rectangle(pane.size),
            subject = rect,
            view = area,
            fit = SidePopupFit(
                chromeWidth = insets.left + insets.right + UiStyle.Balloon.pointer().height + shadow * 2,
                chromeHeight = chromeHeight,
                gap = gap,
                maxWidth = JBUI.scale(SessionUiStyle.View.Popup.WIDE_MAX_WIDTH),
                maxHeight = JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT),
            ),
        )
        built.fitWithin(spot.maxWidth, spot.maxHeight)
        val row = SwingUtilities.convertPoint(anchor, Point(0, anchor.height / 2), pane)
        val view = Rectangle(area.x, area.y + shadow, area.width, (area.height - shadow * 2).coerceAtLeast(0))
        val height = built.component.preferredSize.height + insets.top + insets.bottom
        val aim = SidePopupGeometry.aim(
            view = view,
            subject = rect,
            y = row.y,
            height = height,
            gap = gap,
            indent = UiStyle.Balloon.arc() + UiStyle.Balloon.pointer().width / 2,
        )
        return SidePopupSpot(pane, Point(spot.x, aim.y), spot.position, aim.distance)
    }
}
