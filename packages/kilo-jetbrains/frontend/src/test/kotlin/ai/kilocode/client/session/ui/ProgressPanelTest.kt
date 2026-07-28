package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBLabel
import java.awt.Component
import java.awt.Container

/**
 * Verifies [ProgressPanel] show/hide behaviour driven by direct [SessionModel]
 * state mutations — no controller or RPC involved.
 */
@Suppress("UnstableApiUsage")
class ProgressPanelTest : BasePlatformTestCase() {

    private lateinit var model: SessionModel
    private lateinit var parent: Disposable
    private lateinit var panel: ProgressPanel

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("test")
        model = SessionModel()
        panel = ProgressPanel(model, parent)
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
        } finally {
            super.tearDown()
        }
    }

    fun `test panel is hidden initially`() {
        assertFalse(panel.isVisible)
    }

    fun `test panel shows on Busy with text`() {
        model.setState(SessionState.Busy("Thinking\u2026"))

        assertTrue(panel.isVisible)
        assertEquals("Thinking\u2026", panel.labelText())
        assertEquals("0s", panel.elapsedText())
    }

    fun `test panel relies on transcript inset for left padding`() {
        val ins = panel.insets

        assertEquals(UiStyle.Gap.sm(), ins.top)
        assertEquals(0, ins.left)
        assertEquals(0, ins.bottom)
        assertEquals(0, ins.right)
    }

    fun `test panel hides on Idle`() {
        model.setState(SessionState.Busy("Thinking\u2026"))
        model.setState(SessionState.Idle)

        assertFalse(panel.isVisible)
    }

    fun `test panel shows updated text on second Busy`() {
        model.setState(SessionState.Busy("Thinking\u2026"))
        model.setState(SessionState.Busy("Writing response\u2026"))

        assertTrue(panel.isVisible)
        assertEquals("Writing response\u2026", panel.labelText())
    }

    fun `test panel shows on Retry with message and attempt`() {
        model.setState(SessionState.Retry("The usage limit has been reached", attempt = 4, next = 0L))

        assertTrue(panel.isVisible)
        assertTrue(spinner().isVisible)
        assertEquals("The usage limit has been reached (attempt 4)", panel.labelText())
    }

    fun `test panel shows on Offline`() {
        model.setState(SessionState.Offline("Computer appears offline", requestId = "req1"))

        assertTrue(panel.isVisible)
        assertFalse(spinner().isVisible)
        assertEquals("Computer appears offline", panel.labelText())
    }

    fun `test retry falls back to generic message when blank`() {
        model.setState(SessionState.Retry("", attempt = 0, next = 0L))

        assertTrue(panel.isVisible)
        assertEquals(KiloBundle.message("session.status.retry"), panel.labelText())
    }

    fun `test retry without attempt omits attempt suffix`() {
        model.setState(SessionState.Retry("Rate limited", attempt = 0, next = 0L))

        assertTrue(panel.isVisible)
        assertEquals("Rate limited", panel.labelText())
    }

    fun `test elapsed time ticks while progress is visible`() {
        val clock = FakeClock()
        replace(clock)

        model.setState(SessionState.Busy("Thinking"))

        assertEquals("0s", panel.elapsedText())
        assertTrue(clock.timer.isRunning())

        clock.advance(59_000)
        assertEquals("59s", panel.elapsedText())

        clock.advance(23_000)
        assertEquals("1m 22s", panel.elapsedText())

        clock.advance(3_600_000)
        assertEquals("1h 1m 22s", panel.elapsedText())
    }

    fun `test elapsed time is right aligned`() {
        val clock = FakeClock()
        replace(clock)

        model.setState(SessionState.Busy("Thinking"))
        panel.setSize(300, panel.preferredSize.height)
        panel.doLayout()

        val time = labels(panel).first { it.text == "0s" }

        assertEquals(panel.width - panel.insets.right, time.x + time.width)
    }

    fun `test elapsed time continues across visible progress states and stops when hidden`() {
        val clock = FakeClock()
        replace(clock)

        model.setState(SessionState.Busy("Thinking"))
        clock.advance(61_000)
        model.setState(SessionState.Retry("Rate limited", attempt = 1, next = 0L))

        assertEquals("1m 1s", panel.elapsedText())

        model.setState(SessionState.Idle)
        assertFalse(clock.timer.isRunning())

        clock.advance(1_000)
        assertEquals("1m 1s", panel.elapsedText())

        model.setState(SessionState.Busy("Thinking again"))
        assertEquals("0s", panel.elapsedText())
    }

    fun `test reverting state is busy`() {
        assertTrue(SessionState.Reverting("x", SessionState.Reverting.Kind.ROLLBACK).isBusy())
    }

    fun `test state churn retains footer components`() {
        val clock = FakeClock()
        replace(clock)
        val comps = components(panel)

        repeat(500) { i ->
            model.setState(SessionState.Busy("Thinking $i"))
            model.setState(SessionState.Retry("Rate limited", attempt = i + 1, next = 0L))
            model.setState(SessionState.Offline("Computer appears offline", requestId = "req$i"))
            model.setState(SessionState.Idle)

            assertEquals(comps, components(panel))
        }
    }

    fun `test disposing parent removes model listener`() {
        model.setState(SessionState.Busy("Thinking"))
        Disposer.dispose(parent)

        model.setState(SessionState.Retry("Rate limited", attempt = 1, next = 0L))

        assertEquals("Thinking", panel.labelText())
        parent = Disposer.newDisposable("test replacement")
    }

    fun `test panel hides on Error state`() {
        model.setState(SessionState.Busy("Thinking\u2026"))
        model.setState(SessionState.Error("something went wrong"))

        assertFalse(panel.isVisible)
    }

    fun `test panel hides on AwaitingPermission`() {
        model.setState(SessionState.Busy("Thinking\u2026"))
        model.setState(SessionState.AwaitingPermission(stub()))

        assertFalse(panel.isVisible)
    }

    // ------ helpers ------

    private fun replace(clock: FakeClock) {
        Disposer.dispose(parent)
        parent = Disposer.newDisposable("test replacement")
        model = SessionModel()
        panel = ProgressPanel(model, parent, clock)
    }

    private fun stub() = Permission(
        id = "perm1",
        sessionId = "ses",
        name = "edit",
        patterns = emptyList(),
        always = emptyList(),
        meta = PermissionMeta(raw = emptyMap()),
    )

    private fun spinner() = labels(panel).first { it.icon != null }

    private fun labels(root: Container): List<JBLabel> {
        val items = mutableListOf<JBLabel>()
        for (child in root.components) {
            if (child is JBLabel) items.add(child)
            if (child is Container) items.addAll(labels(child))
        }
        return items
    }

    private fun components(root: Container): List<Component> {
        val items = mutableListOf<Component>()
        for (child in root.components) {
            items.add(child)
            if (child is Container) items.addAll(components(child))
        }
        return items
    }

    private class FakeClock : UiTimerSource {
        var time = 0L
        lateinit var timer: FakeTimer

        override fun now(): Long = time

        override fun timer(ms: Int, repeats: Boolean, action: () -> Unit): UiTimer {
            timer = FakeTimer(action)
            return timer
        }

        fun advance(ms: Long) {
            time += ms
            timer.fire()
        }
    }

    private class FakeTimer(private val action: () -> Unit) : UiTimer {
        private var running = false

        override fun start() {
            running = true
        }

        override fun stop() {
            running = false
        }

        override fun restart() {
            running = true
        }

        override fun isRunning(): Boolean = running

        fun fire() {
            if (running) action()
        }
    }
}
