package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.TestCoroutines
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class HostedManagementServiceTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private val ref = HostedWorkspaceRefDto("cloud", "wrk_1")

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        val rpc = FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(
                KiloAppStatusDto.READY,
                profile = ProfileDto(email = "first@example.com", currentOrgId = "org_1"),
            )
        }
        ApplicationManager.getApplication().replaceService(
            KiloAppService::class.java,
            KiloAppService(coroutines.scope, rpc),
            testRootDisposable,
        )
        PropertiesComponent.getInstance(project).unsetValue("kilo.hosted.management.test")
    }

    override fun tearDown() {
        try {
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun testRemoveHidesOnlyThatWorkspaceAndAddRestoresIt() {
        val management = project.service<HostedManagementService>()
        val items = listOf(
            HostedWorkspaceDto(ref, name = "One"),
            HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "wrk_2"), name = "Two"),
        )
        assertEquals(2, management.visible(items).size)
        management.refreshScope()
        management.remove(ref)
        assertEquals(listOf("wrk_2"), management.visible(items).map { it.ref.workspaceID })
        management.restore(ref)
        assertEquals(2, management.visible(items).size)
    }

    fun testClosedChildrenAndSelectionPersistIndependently() {
        val management = project.service<HostedManagementService>()
        management.refreshScope()
        management.close(ref, "ses_one")
        management.close(ref, "ses_two")
        management.reopen(ref, "ses_one")
        management.select(ref, "ses_two")

        assertEquals(setOf("ses_two"), management.closed(ref))
        assertEquals("ses_two", management.selected(ref))
        assertTrue(management.pendingDelete(ref) == false)

        management.markPendingDelete(ref)
        assertTrue(management.pendingDelete(ref))
        management.clearDelete(ref)
        assertFalse(management.pendingDelete(ref))
    }
}
