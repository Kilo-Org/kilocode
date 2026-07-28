package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel

/**
 * Progress footer rendered at the bottom of the session transcript while the
 * agent is working.
 *
 * Reacts to [SessionModelEvent.StateChanged]:
 * - [SessionState.Busy] → shows an animated spinner and [SessionState.Busy.text]
 * - [SessionState.Retry] → shows an animated spinner and retry detail
 * - [SessionState.Offline] → shows offline detail without a spinner
 * - Any other state -> hidden
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
    private var began = 0L
    private val label = JBLabel().apply {
        foreground = style.editorForeground
    }
    private val elapsed = JBLabel().apply {
        foreground = UiStyle.Colors.weak()
    }
    private val spinner = JBLabel(AnimatedIcon.Default())
    private val tick = clock.timer(1000) { syncElapsed() }

    init {
        isOpaque = false
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

    private fun onState(state: SessionState) {
        this.state = state
        when (state) {
            is SessionState.Busy -> {
                spinner.isVisible = true
                label.text = state.text
                label.foreground = style.editorForeground
                showProgress()
            }
            is SessionState.Retry -> {
                spinner.isVisible = true
                label.text = retryText(state)
                label.foreground = UiStyle.Colors.warningLabelForeground()
                showProgress()
            }
            is SessionState.Offline -> {
                spinner.isVisible = false
                label.text = state.message.ifBlank { KiloBundle.message("session.status.offline") }
                label.foreground = UiStyle.Colors.errorLabelForeground()
                showProgress()
            }
            else -> hideProgress()
        }
        revalidate()
        repaint()
    }

    private fun showProgress() {
        if (!isVisible) {
            began = clock.now()
            syncElapsed()
        }
        if (!tick.isRunning()) tick.start()
        isVisible = true
    }

    private fun hideProgress() {
        tick.stop()
        isVisible = false
    }

    private fun syncElapsed() {
        elapsed.text = elapsedText((clock.now() - began).coerceAtLeast(0))
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
        elapsed.foreground = UiStyle.Colors.weak()
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
