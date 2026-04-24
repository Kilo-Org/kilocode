package ai.kilocode.client.session

import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.ProgressPanel
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

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
}
