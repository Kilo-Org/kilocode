package ai.kilocode.client.ui.popup

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

/**
 * Shows a single popup beside whatever is hovered, after a short dwell, and hides it after a short grace
 * period. Shared by the chat transcript's collapsed cards and the Agent Manager's worktree rows.
 *
 * Hover state is tracked as two booleans — [onSubject] for the hovered element and [onPopup] for the
 * balloon subtree — so the show/hide decision is independent of the order platform enter and exit events
 * arrive in. The popup is kept alive while the mouse is over either surface, which lets the user move
 * from the element into the popup without it disappearing.
 *
 * Popup subtree hover is detected via [HoverListener] (an experimental IntelliJ API) so nested editors
 * count as "inside the popup".
 */
internal class SidePopupController(
    timers: UiTimerSource = UiTimers,
    /**
     * How long the pointer has to rest before the body is built. The default suits a transcript card,
     * which the pointer arrives at deliberately. A dense list should pass [LIST_MS]: there the pointer
     * crosses several rows on the way to the one it wants, and a short dwell flashes a popup for each of
     * them.
     */
    dwell: Int = SHOW_MS,
) : Disposable {
    private var target: Any? = null
    private var source: (() -> SidePopupRequest?)? = null
    private var balloon: Balloon? = null
    private var body: Disposable? = null
    private var guard: Disposable? = null
    private var onSubject = false
    private var onPopup = false
    private val showTimer = timers.timer(dwell, repeats = false) { display() }
    private val hideTimer = timers.timer(HIDE_MS, repeats = false) { hideAll() }

    /**
     * Begins the dwell for [key], the identity of the hovered element. [owner] is whose disposal must
     * tear the popup down — a card for the transcript, the list for a row. [request] is consulted when
     * the dwell elapses rather than now, so a body is never built for a pointer passing through.
     */
    @RequiresEdt
    fun show(key: Any, owner: Disposable, request: () -> SidePopupRequest?) {
        if (target == key) {
            onSubject = true
            reevaluate()
            return
        }
        hideAll()
        target = key
        source = request
        guard = object : Disposable {
            override fun dispose() {
                if (guard === this) guard = null
                if (target == key) hideAll()
            }
        }.also { Disposer.register(owner, it) }
        onSubject = true
        showTimer.restart()
    }

    @RequiresEdt
    fun notifyExit(key: Any) {
        if (target != key) return
        onSubject = false
        reevaluate()
    }

    /** Whether a balloon is currently on screen. */
    @RequiresEdt
    fun showing(): Boolean = balloon != null

    @RequiresEdt
    fun hideAll() {
        showTimer.stop()
        hideTimer.stop()
        onSubject = false
        onPopup = false
        val popup = balloon
        val item = body
        val hook = guard
        // Cleared before disposing: Disposer.dispose can re-enter through the balloon's own onClosed, and
        // that reentry has to find clean state and no-op rather than tear down a newer popup.
        target = null
        source = null
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
        if (onSubject || onPopup) {
            hideTimer.stop()
            return
        }
        if (balloon == null) hideAll() else hideTimer.restart()
    }

    @RequiresEdt
    private fun display() {
        if (target == null) return
        if (!onSubject && !onPopup) return hideAll()
        val req = source?.invoke() ?: return hideAll()
        val built = req.build()
        val spot = req.place(built)
        if (spot == null) {
            // The body is live by now — a chat card registered editors on its disposable, a task card
            // reparented its own view into it — so a placement with nowhere to sit has to release it
            // rather than drop the reference. Handing it to [body] lets [hideAll] do that.
            body = built.disposable
            return hideAll()
        }
        open(req, built, spot)
    }

    @RequiresEdt
    private fun open(req: SidePopupRequest, built: SidePopupContent, spot: SidePopupSpot) {
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
                // Identity check: a stale close, from hideOnClickOutside or a superseded balloon, must not
                // tear down whatever is showing now.
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

    internal companion object {
        const val SHOW_MS = 500

        /** Dwell for a list of rows, where the pointer passes over neighbours to reach its target. */
        const val LIST_MS = SHOW_MS * 2
        const val HIDE_MS = 250
    }
}
