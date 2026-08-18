package ai.kilocode.client.session.ui.popup

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
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.hover.HoverListener
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Component
import java.awt.Point

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
        val popup = JBPopupFactory.getInstance()
            .createBalloonBuilder(built.component)
            .setFillColor(built.background)
            .setBorderColor(UiStyle.Balloon.border())
            .setBorderInsets(UiStyle.Balloon.insets())
            .setPointerSize(UiStyle.Balloon.pointer())
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
        val point = RelativePoint(req.anchor, Point(req.anchor.width, req.anchor.height / 2))
        popup.show(point, Balloon.Position.atRight)
        req.shown()
    }

    private companion object {
        const val SHOW_MS = 500
        const val HIDE_MS = 250
    }
}
