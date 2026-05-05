package ai.kilocode.client.session.ui

import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.session.update.SessionControllerEvent
import ai.kilocode.client.session.update.SessionControllerTestBase
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.ConfigWarningDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import java.awt.Dimension

@Suppress("UnstableApiUsage")
class ConnectionPanelTest : SessionControllerTestBase() {

    private lateinit var panel: ConnectionPanel
    private lateinit var controller: SessionController

    override fun setUp() {
        super.setUp()
        controller = controller("ses_test")
        panel = ConnectionPanel(parent, controller)
        flush()
    }

    fun `test loading hides retry and details`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowConnecting)
        }

        assertTrue(panel.isVisible)
        assertEquals("Loading...", panel.summaryText())
        assertEquals("", panel.detailsText())
        assertFalse(panel.toggleVisible())
        assertFalse(panel.detailsVisible())
        assertFalse(panel.retryVisible())
    }

    fun `test app error starts collapsed and expands details`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowError(
                "CLI startup failed",
                "stderr line\nconfig: HTTP 500: broken",
            ))
        }

        assertTrue(panel.isVisible)
        assertEquals("CLI startup failed", panel.summaryText())
        assertEquals(UiStyle.Colors.error(), panel.summaryColor())
        assertTrue(panel.toggleVisible())
        assertFalse(panel.toggleExpanded())
        assertFalse(panel.detailsVisible())
        assertEquals("stderr line\nconfig: HTTP 500: broken", panel.detailsText())
        assertEquals(UiStyle.Colors.fg(), panel.detailsColor())
        assertTrue(panel.retryVisible())
        assertFalse(panel.retryFocusable())

        edt { panel.clickSummary() }

        assertTrue(panel.toggleExpanded())
        assertTrue(panel.detailsVisible())

        edt { panel.clickToggle() }

        assertFalse(panel.toggleExpanded())
        assertFalse(panel.detailsVisible())
    }

    fun `test workspace error shows retry without details`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowError("Workspace failed", null))
        }

        assertTrue(panel.isVisible)
        assertEquals("Workspace failed", panel.summaryText())
        assertFalse(panel.toggleVisible())
        assertFalse(panel.detailsVisible())
        assertEquals("", panel.detailsText())
        assertTrue(panel.retryVisible())
        assertEquals("Try again", panel.retryText())
    }

    fun `test retry click triggers app retry for app error`() {
        edt {
            controller.model.app = KiloAppStateDto(
                status = KiloAppStatusDto.ERROR,
                error = "CLI startup failed",
            )
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowError("CLI startup failed", null))
        }
        edt { panel.clickRetry() }
        flush()

        assertEquals(1, appRpc.retries)
    }

    fun `test ready warnings show collapsed banner with retry`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowWarning(
                "Configuration warnings",
                ".kilo/kilo.json: Invalid JSON\nCloseBraceExpected at line 11, column 1",
            ))
        }

        assertTrue(panel.isVisible)
        assertEquals("Configuration warnings", panel.summaryText())
        assertEquals(UiStyle.Colors.warning(), panel.summaryColor())
        assertTrue(panel.toggleVisible())
        assertFalse(panel.toggleExpanded())
        assertFalse(panel.detailsVisible())
        assertTrue(panel.retryVisible())
        assertFalse(panel.retryFocusable())
        assertEquals(
            ".kilo/kilo.json: Invalid JSON\nCloseBraceExpected at line 11, column 1",
            panel.detailsText(),
        )

        edt { panel.clickSummary() }

        assertTrue(panel.toggleExpanded())
        assertTrue(panel.detailsVisible())
    }

    fun `test retry click triggers app retry for warnings`() {
        edt {
            controller.model.app = KiloAppStateDto(
                status = KiloAppStatusDto.READY,
                warnings = listOf(ConfigWarningDto(path = ".kilo/kilo.json", message = "Invalid JSON")),
            )
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowWarning("Configuration warnings", null))
        }
        edt { panel.clickRetry() }
        flush()

        assertEquals(1, appRpc.retries)
    }

    fun `test expanded details height is capped at ten lines`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowError("CLI startup failed", lines(30)))
            panel.size = Dimension(480, 1000)
        }

        edt { panel.clickSummary() }

        assertTrue(panel.detailsVisible())
        assertTrue(panel.preferredSize.height <= panel.maxExpandedHeight())
    }

    fun `test raw app and workspace events do not render panel`() {
        edt {
            panel.onEvent(SessionControllerEvent.AppChanged)
            panel.onEvent(SessionControllerEvent.WorkspaceChanged)
        }

        assertFalse(panel.isVisible)
    }

    fun `test panel has top separator`() {
        assertTrue(panel.hasSeparator())
    }

    private fun lines(count: Int) = (1..count).joinToString("\n") { "line $it" }
}
