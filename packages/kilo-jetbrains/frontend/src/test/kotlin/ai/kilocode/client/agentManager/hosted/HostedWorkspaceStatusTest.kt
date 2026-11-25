package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class HostedWorkspaceStatusTest : BasePlatformTestCase() {
    fun `test canonical compute states and sandbox aliases map to editor badge labels`() {
        val cases = mapOf(
            "active" to "Active", "running" to "Active", "setting_up" to "Setting Up",
            "sleeping" to "Sleeping", "starting" to "Starting", "stopping" to "Stopping",
            "failed" to "Failed", "stopped" to "Stopped", "error" to "Unavailable",
            "unreachable" to "Unavailable", "unknown" to "Unknown",
        )
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        cases.forEach { (state, text) ->
            val status = HostedWorkspaceStatusDto(ref, "active", state, "detail", 100.0)
            assertEquals(text, HostedWorkspaceStatus.of(status).badge().text)
        }
        assertEquals("Loading Cloud status...", HostedWorkspaceStatus.of(null).badge().text)
    }

    fun `test setup and sleeping badges use the secondary style and active uses the marketplace green`() {
        for (status in listOf(HostedWorkspaceStatus.SETTING_UP, HostedWorkspaceStatus.STARTING, HostedWorkspaceStatus.SLEEPING)) {
            assertSame(UiStyle.Badge.Secondary, status.badge().style)
        }
        val active = HostedWorkspaceStatus.ACTIVE.badge().style as UiStyle.Badge.Type
        val marketplace = UiStyle.Badge.typeAgent(true)
        assertEquals(marketplace.bg(), active.bg())
        assertEquals(marketplace.fg(), active.fg())
    }
}
