package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SpinnerIcon
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.ShimmerLabel
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.text.HtmlChunk
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import javax.swing.JPanel

/**
 * Progress footer rendered at the bottom of the session transcript while the
 * agent is working. The spinner, status text, and elapsed counter sit in one
 * horizontally centered row.
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
    private var text = ""
    private val busy = ShimmerLabel().apply {
        foreground = style.editorForeground
    }
    private val status = StatusLabel().apply {
        isVisible = false
    }
    private val elapsed = JBLabel().apply {
        foreground = SessionUiStyle.Text.Secondary.foreground()
    }
    private val spinner = JBLabel(SpinnerIcon.icon)
    private val footer = Footer(spinner, busy, status, elapsed)
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

        addToCenter(footer)
        Disposer.register(parent) { tick.stop() }

        model.addListener(parent) { event ->
            if (event is SessionModelEvent.StateChanged) onState(event.state)
        }
    }

    /** Exposed for test assertions. */
    fun labelText(): String = text

    /** Exposed for test assertions. */
    fun elapsedText(): String = elapsed.text

    /** Exposed for test assertions. */
    fun labelForeground() = if (status.isVisible) status.foreground else busy.foreground

    override fun getBackground(): Color = SessionUiStyle.Colors.sessionBackground()

    private fun onState(state: SessionState) {
        this.state = state
        when (state) {
            is SessionState.Busy -> {
                text = state.text
                spinner.isVisible = true
                status.isVisible = false
                busy.isVisible = true
                busy.text = text
                busy.foreground = style.editorForeground
                busy.isShimmering = true
                resume()
                showProgress()
            }
            is SessionState.Retry -> {
                text = retryText(state)
                spinner.isVisible = true
                busy.isShimmering = false
                busy.isVisible = false
                status.isVisible = true
                status.foreground = UiStyle.Colors.warningLabelForeground()
                status.sync(text)
                resume()
                showProgress()
            }
            is SessionState.Offline -> {
                text = state.message.ifBlank { KiloBundle.message("session.status.offline") }
                spinner.isVisible = false
                busy.isShimmering = false
                busy.isVisible = false
                status.isVisible = true
                status.foreground = UiStyle.Colors.errorLabelForeground()
                status.sync(text)
                resume()
                showProgress()
            }
            // Waiting on the user: the turn is still active, so keep the banked
            // time but stop the clock and hide the footer, same as idle.
            is SessionState.AwaitingPermission, is SessionState.AwaitingQuestion, is SessionState.Reverting -> {
                busy.isShimmering = false
                pause()
                hideProgress()
            }
            // Turn boundaries: the next turn starts its own counter at zero.
            else -> {
                busy.isShimmering = false
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
        busy.font = style.regularFont
        status.font = style.regularFont
        elapsed.font = style.regularFont
        elapsed.foreground = SessionUiStyle.Text.Secondary.foreground()
        if (state is SessionState.Busy) busy.foreground = style.editorForeground
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

/** Copyable HTML label whose preferred height follows its assigned width. */
internal class StatusLabel(private val centered: Boolean = false) : JBLabel() {
    private var content = ""

    init {
        verticalTextPosition = TOP
        setCopyable(true)
        setAllowAutoWrapping(true)
    }

    fun sync(value: String) {
        if (content == value) return
        content = value
        text = markup(value, centered)
        accessibleContext?.accessibleName = value
    }

    fun natural(): Dimension = probe(Short.MAX_VALUE.toInt())

    fun measure(width: Int): Dimension {
        if (width <= 0) return Dimension(0, natural().height)
        return Dimension(width, probe(width).height)
    }

    override fun getPreferredSize(): Dimension {
        if (width <= 0) return super.getPreferredSize()
        return measure(width)
    }

    private fun probe(width: Int): Dimension {
        val old = size
        setSize(width.coerceAtLeast(1), Short.MAX_VALUE.toInt())
        doLayout()
        val pref = super.getPreferredSize()
        setSize(old)
        doLayout()
        return pref
    }
}

private class Footer(
    private val spinner: JBLabel,
    private val busy: ShimmerLabel,
    private val status: StatusLabel,
    private val elapsed: JBLabel,
) : JPanel(null) {

    init {
        isOpaque = false
        add(spinner)
        add(busy)
        add(status)
        add(elapsed)
    }

    override fun getPreferredSize(): Dimension {
        val ins = insets
        val metrics = measure(space())
        return Dimension(
            metrics.width + ins.left + ins.right,
            metrics.height + ins.top + ins.bottom,
        )
    }

    override fun doLayout() {
        val ins = insets
        val space = (width - ins.left - ins.right).coerceAtLeast(0)
        val metrics = measure(space)
        var x = ins.left + (space - metrics.width) / 2

        if (spinner.isVisible) {
            spinner.setBounds(
                x,
                ins.top + (metrics.height - metrics.spinner.height) / 2,
                metrics.spinner.width,
                metrics.spinner.height,
            )
            x += metrics.spinner.width + metrics.before
        }

        val label = active()
        label.setBounds(
            x,
            ins.top + (metrics.height - metrics.label.height) / 2,
            metrics.label.width,
            metrics.label.height,
        )
        x += metrics.label.width + metrics.after

        elapsed.setBounds(
            x,
            ins.top + (metrics.height - metrics.elapsed.height) / 2,
            metrics.elapsed.width,
            metrics.elapsed.height,
        )
    }

    private fun measure(space: Int): Metrics {
        val label = active()
        val text = if (label is StatusLabel) label.natural() else label.preferredSize
        val spin = if (spinner.isVisible) spinner.preferredSize else Dimension()
        val time = elapsed.preferredSize
        val slots = if (spinner.isVisible) 2 else 1
        val gap = UiStyle.Gap.md()
        val natural = spin.width + text.width + time.width + gap * slots
        val width = if (space > 0) minOf(space, natural) else natural
        var rest = width
        val sw = minOf(spin.width, rest)
        rest -= sw
        val ew = minOf(time.width, rest)
        rest -= ew
        val gaps = minOf(gap * slots, rest)
        val before = if (spinner.isVisible) minOf(gap, (gaps + slots - 1) / slots) else 0
        val after = gaps - before
        val room = (rest - gaps).coerceAtLeast(0)
        val body = if (label is StatusLabel) {
            label.measure(room)
        } else {
            Dimension(minOf(text.width, room), text.height)
        }
        val glyph = Dimension(sw, spin.height)
        val timer = Dimension(ew, time.height)
        val height = maxOf(glyph.height, body.height, timer.height)
        return Metrics(width, height, glyph, body, timer, before, after)
    }

    private fun active(): Component = if (status.isVisible) status else busy

    private fun space(): Int {
        val own = width - insets.left - insets.right
        if (own > 0) return own
        var node: Container? = parent
        while (node != null) {
            if (node.width > 0) {
                val ins = node.insets
                return (node.width - ins.left - ins.right).coerceAtLeast(0)
            }
            node = node.parent
        }
        return 0
    }

    private data class Metrics(
        val width: Int,
        val height: Int,
        val spinner: Dimension,
        val label: Dimension,
        val elapsed: Dimension,
        val before: Int,
        val after: Int,
    )
}

private fun markup(value: String, centered: Boolean): String {
    val lines = value.replace("\r\n", "\n").replace('\r', '\n').split('\n')
    val div = HtmlChunk.div().children(
        lines.flatMapIndexed { index, line ->
            if (index == lines.lastIndex) listOf(HtmlChunk.text(line))
            else listOf(HtmlChunk.text(line), HtmlChunk.br())
        },
    )
    val body = if (centered) div.attr("style", "text-align:center") else div
    return body.wrapWith(HtmlChunk.body()).wrapWith("html").toString()
}
