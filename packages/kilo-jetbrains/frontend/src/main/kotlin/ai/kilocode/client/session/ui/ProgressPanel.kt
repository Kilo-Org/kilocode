package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Color

/**
 * Progress footer rendered at the bottom of the session transcript while the
 * agent is working.
 *
 * Reacts to [SessionModelEvent.StateChanged]:
 * - [SessionState.Busy] → shows an animated spinner and [SessionState.Busy.text]
 * - [SessionState.Retry] → shows an animated spinner and retry detail
 * - [SessionState.Offline] → shows offline detail without a spinner
 * - [SessionState.AwaitingPermission] / [SessionState.AwaitingQuestion] / [SessionState.Reverting]
 *   → hidden, but the elapsed counter is paused (not reset): the turn is still active, just
 *   waiting on the user, so that time must not count as — or discard — working time.
 * - Any other state (e.g. idle, a finished/errored turn) → hidden and the counter resets to zero
 *   for the next turn.
 *
 * Owned by [SessionMessageListPanel], which always re-anchors it as the last child so it
 * appears below all turn views inside the scroll pane.
 */
class ProgressPanel(
    model: SessionModel,
    parent: Disposable,
    private val clock: UiTimerSource = UiTimers,
) : BorderLayoutPanel(), SessionEditorStyleTarget {

    private var style = SessionEditorStyle.current()
    private var state: SessionState = SessionState.Idle

    // Elapsed time is tracked as banked time from previous running stretches
    // (`accrued`) plus the start of the current stretch (`began`, `null` when
    // paused). This lets the footer hide while awaiting a permission/question
    // without losing — or over-counting — the turn's active working time.
    private var accrued = 0L
    private var began: Long? = null
    private val label = JBLabel().apply {
        foreground = style.editorForeground
    }
    private val elapsed = JBLabel().apply {
        foreground = SessionUiStyle.Text.Secondary.foreground()
    }
    private val spinner = JBLabel(SpinnerIcon.icon)
    private val tick = clock.timer(1000) { syncElapsed() }

    init {
        isOpaque = true
        isVisible = false
        border = JBUI.Borders.empty(
            UiStyle.Gap.sm(),
            0,
            0,
            0,
        )
        applyStyle(SessionEditorStyle.current())

        addToLeft(
            Stack(StackAxis.HORIZONTAL, UiStyle.Gap.md())
                .next(spinner)
                .next(label),
        )
        addToRight(elapsed)
        Disposer.register(parent) { tick.stop() }

        model.addListener(parent) { event ->
            if (event is SessionModelEvent.StateChanged) onState(event.state)
        }
    }

    /** Exposed for test assertions. */
    fun labelText(): String = label.text

    /** Exposed for test assertions. */
    fun elapsedText(): String = elapsed.text

    /** Exposed for test assertions. */
    fun labelForeground() = label.foreground

    override fun getBackground(): Color = SessionUiStyle.Colors.sessionBackground()

    private fun onState(state: SessionState) {
        this.state = state
        when (state) {
            is SessionState.Busy -> {
                spinner.isVisible = true
                label.text = state.text
                label.foreground = style.editorForeground
                resume()
                showProgress()
            }
            is SessionState.Retry -> {
                spinner.isVisible = true
                label.text = retryText(state)
                label.foreground = UiStyle.Colors.warningLabelForeground()
                resume()
                showProgress()
            }
            is SessionState.Offline -> {
                spinner.isVisible = false
                label.text = state.message.ifBlank { KiloBundle.message("session.status.offline") }
                label.foreground = UiStyle.Colors.errorLabelForeground()
                resume()
                showProgress()
            }
            // Waiting on the user: the turn is still active, so keep the banked
            // time but stop the clock and hide the footer, same as idle.
            is SessionState.AwaitingPermission, is SessionState.AwaitingQuestion, is SessionState.Reverting -> {
                pause()
                hideProgress()
            }
            // Turn boundaries: the next turn starts its own counter at zero.
            else -> {
                reset()
                hideProgress()
            }
        }
        revalidate()
        repaint()
    }

    /** Start (or continue) the current running stretch. */
    private fun resume() {
        if (began == null) began = clock.now()
    }

    /** Bank the current running stretch, if any, and stop the clock. */
    private fun pause() {
        val start = began ?: return
        accrued += (clock.now() - start).coerceAtLeast(0)
        began = null
    }

    /** Clear all banked and running time for the next turn. */
    private fun reset() {
        accrued = 0L
        began = null
    }

    private fun showProgress() {
        if (!isVisible) syncElapsed()
        if (!tick.isRunning()) tick.start()
        isVisible = true
    }

    private fun hideProgress() {
        tick.stop()
        isVisible = false
    }

    private fun syncElapsed() {
        val start = began
        val running = if (start == null) 0L else (clock.now() - start).coerceAtLeast(0)
        elapsed.text = elapsedText(accrued + running)
        revalidate()
        repaint()
    }

    private fun retryText(state: SessionState.Retry): String {
        val base = state.message.ifBlank { KiloBundle.message("session.status.retry") }
        return if (state.attempt > 0) {
            KiloBundle.message("session.status.retry.attempt", base, state.attempt)
        } else base
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        label.font = style.regularFont
        elapsed.font = style.regularFont
        elapsed.foreground = SessionUiStyle.Text.Secondary.foreground()
        if (state is SessionState.Busy) label.foreground = style.editorForeground
        revalidate()
        repaint()
    }

    private fun elapsedText(ms: Long): String {
        val total = ms / 1000
        val sec = total % 60
        val min = (total / 60) % 60
        val hour = total / 3600
        if (hour > 0) return "${hour}h ${min}m ${sec}s"
        if (min > 0) return "${min}m ${sec}s"
        return "${sec}s"
    }
}
