package ai.kilocode.client.session.ui.popup

import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.JBPopupListener
import com.intellij.openapi.ui.popup.LightweightWindowEvent
import com.intellij.openapi.util.Disposer
import com.intellij.ui.ComponentUtil
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.hover.HoverListener
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * Shows a single header popup after a short hover dwell and hides it after a short grace period.
 *
 * Hover state is tracked as two booleans — [onHeader] for the originating header row and [onPopup]
 * for the balloon subtree — so the show/hide decision is independent of the order platform enter and
 * exit events arrive in. The popup is kept alive while the mouse is over either surface, which lets
 * the user move from the header into the popup without it disappearing.
 *
 * Popup subtree hover is detected via [HoverListener] (an experimental IntelliJ API) so the nested
 * editor counts as "inside the popup".
 */
class HeaderPopupController(timers: UiTimerSource = UiTimers) : Disposable {
    private var target: PartView? = null
    private var balloon: Balloon? = null
    private var body: Disposable? = null
    private var guard: Disposable? = null
    private var onHeader = false
    private var onPopup = false
    private val showTimer = timers.timer(SHOW_MS, repeats = false) { display() }
    private val hideTimer = timers.timer(HIDE_MS, repeats = false) { hideAll() }

    @RequiresEdt
    fun show(view: PartView) {
        if (target === view) {
            onHeader = true
            reevaluate()
            return
        }
        hideAll()
        target = view
        guard = object : Disposable {
            override fun dispose() {
                if (guard === this) guard = null
                if (target === view) hideAll()
            }
        }.also { Disposer.register(view, it) }
        onHeader = true
        showTimer.restart()
    }

    @RequiresEdt
    fun notifyExit(view: PartView) {
        if (target !== view) return
        onHeader = false
        reevaluate()
    }

    @RequiresEdt
    fun hideAll() {
        showTimer.stop()
        hideTimer.stop()
        onHeader = false
        onPopup = false
        val popup = balloon
        val item = body
        val hook = guard
        target = null
        balloon = null
        body = null
        guard = null
        hook?.let(Disposer::dispose)
        popup?.hide()
        item?.let(Disposer::dispose)
    }

    @RequiresEdt
    override fun dispose() {
        hideAll()
    }

    @RequiresEdt
    private fun popupEntered() {
        onPopup = true
        reevaluate()
    }

    @RequiresEdt
    private fun popupExited() {
        onPopup = false
        reevaluate()
    }

    @RequiresEdt
    private fun reevaluate() {
        if (onHeader || onPopup) {
            hideTimer.stop()
            return
        }
        if (balloon == null) hideAll() else hideTimer.restart()
    }

    @RequiresEdt
    private fun display() {
        val view = target ?: return
        if (!onHeader && !onPopup) return hideAll()
        val req = view.headerPopup() ?: return hideAll()
        val built = req.build()
        place(view, req.anchor, built)?.let { open(req, built, it) } ?: hideAll()
    }

    @RequiresEdt
    private fun open(req: HeaderPopupRequest, built: HeaderPopupBody, spot: Spot) {
        val popup = JBPopupFactory.getInstance()
            .createBalloonBuilder(built.component)
            .setFillColor(built.background)
            .setBorderColor(UiStyle.Balloon.border())
            .setBorderInsets(UiStyle.Balloon.insets())
            .setPointerSize(UiStyle.Balloon.pointer())
            .setCornerToPointerDistance(spot.distance)
            .setCornerRadius(UiStyle.Balloon.arc())
            .setHideOnClickOutside(true)
            .setHideOnKeyOutside(true)
            .setHideOnFrameResize(true)
            .setFadeoutTime(0)
            .setAnimationCycle(0)
            .createBalloon()

        popup.setAnimationEnabled(false)
        popup.addListener(object : JBPopupListener {
            override fun onClosed(event: LightweightWindowEvent) {
                if (body !== built.disposable) return
                hideAll()
            }
        })

        object : HoverListener() {
            override fun mouseEntered(component: Component, x: Int, y: Int) = popupEntered()
            override fun mouseMoved(component: Component, x: Int, y: Int) = Unit
            override fun mouseExited(component: Component) = popupExited()
        }.addTo(built.component, built.disposable)

        balloon = popup
        body = built.disposable
        popup.show(RelativePoint(spot.pane, spot.point), spot.position)
        req.shown()
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
    private fun place(card: JComponent, anchor: JComponent, built: HeaderPopupBody): Spot? {
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
        val spot = HeaderPopupGeometry.beside(
            pane = Rectangle(pane.size),
            card = rect,
            view = area,
            fit = HeaderPopupFit(
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
        val aim = HeaderPopupGeometry.aim(
            view = view,
            card = rect,
            y = row.y,
            height = height,
            gap = gap,
            indent = UiStyle.Balloon.arc() + UiStyle.Balloon.pointer().width / 2,
        )
        return Spot(pane, Point(spot.x, aim.y), spot.position, aim.distance)
    }

    private class Spot(val pane: JComponent, val point: Point, val position: Balloon.Position, val distance: Int)

    private companion object {
        const val SHOW_MS = 500
        const val HIDE_MS = 250
    }
}
