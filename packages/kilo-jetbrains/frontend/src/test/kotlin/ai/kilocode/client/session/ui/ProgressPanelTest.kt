package ai.kilocode.client.session.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.JBUI

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
    }

    fun `test panel uses transcript row padding`() {
        val ins = panel.insets

        assertEquals(UiStyle.Gap.sm(), ins.top)
        assertEquals(JBUI.scale(SessionUiStyle.View.Layout.HORIZONTAL_PADDING), ins.left)
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

    fun `test reverting state is busy`() {
        assertTrue(SessionState.Reverting("x", SessionState.Reverting.Kind.ROLLBACK).isBusy())
    }

    fun `test state churn retains footer components`() {
        val count = panel.componentCount
        val icon = panel.components[0]
        val text = panel.components[1]

        repeat(500) { i ->
            model.setState(SessionState.Busy("Thinking $i"))
            model.setState(SessionState.Retry("Rate limited", attempt = i + 1, next = 0L))
            model.setState(SessionState.Offline("Computer appears offline", requestId = "req$i"))
            model.setState(SessionState.Idle)

            assertEquals(count, panel.componentCount)
            assertSame(icon, panel.components[0])
            assertSame(text, panel.components[1])
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

    private fun stub() = Permission(
        id = "perm1",
        sessionId = "ses",
        name = "edit",
        patterns = emptyList(),
        always = emptyList(),
        meta = PermissionMeta(raw = emptyMap()),
    )

    private fun spinner() = panel.components[0]
}
