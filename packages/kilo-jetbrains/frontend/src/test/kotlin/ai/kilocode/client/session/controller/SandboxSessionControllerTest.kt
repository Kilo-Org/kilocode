package ai.kilocode.client.session.controller

import ai.kilocode.client.app.KiloSandboxService
import ai.kilocode.client.session.model.SandboxUiState
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.testing.FakeSandboxRpcApi
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.SandboxStatusDto
import com.intellij.testFramework.runInEdtAndWait
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SandboxSessionControllerTest : SessionControllerTestBase() {
    fun `test first session sends explicit off metadata before prompt`() {
        val (_, service) = sandbox()
        ready()
        val controller = controller(sandbox = service)

        runInEdtAndWait { controller.prompt("hello") }
        flush()

        assertEquals(listOf<Boolean?>(false), rpc.createSandboxCalls)
        assertEquals(1, rpc.prompts.size)
    }

    fun `test desired sandbox fails closed before session creation when unsupported`() {
        val (fake, service) = sandbox()
        service.setNewSessionDefault(true)
        fake.defaultSupport = ai.kilocode.rpc.dto.SandboxSupportDto(false, "missing helper")
        ready()
        val controller = controller(sandbox = service)

        runInEdtAndWait { controller.prompt("hello") }
        flush()

        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
        assertIs<SessionState.Error>(controller.model.state)
    }

    fun `test desired sandbox is verified before first prompt`() {
        val (fake, service) = sandbox()
        service.setNewSessionDefault(true)
        fake.defaultStatus = { id, path ->
            SandboxStatusDto(id, path, enabled = true, available = true, version = 1)
        }
        ready()
        val controller = controller(sandbox = service)

        runInEdtAndWait { controller.prompt("hello") }
        flush()

        assertEquals(listOf<Boolean?>(true), rpc.createSandboxCalls)
        assertEquals(1, rpc.prompts.size)
        val state = assertIs<SandboxUiState.Known>(controller.model.sandbox)
        assertTrue(state.enabled)
    }

    fun `test repeated toggle while request is active sends one reconciliation`() {
        val (fake, service) = sandbox()
        fake.defaultStatus = { id, path ->
            SandboxStatusDto(id, path, enabled = false, available = true, version = 1)
        }
        ready()
        val controller = controller("ses_test", sandbox = service)
        flush()

        runInEdtAndWait {
            controller.toggleSandbox()
            controller.toggleSandbox()
        }
        flush()

        assertEquals(1, fake.setEnabledCalls.size)
        assertFalse(assertIs<SandboxUiState.Known>(controller.model.sandbox).pending)
    }

    private fun sandbox(): Pair<FakeSandboxRpcApi, KiloSandboxService> {
        val fake = FakeSandboxRpcApi()
        val service = KiloSandboxService(project, scope, fake)
        service.unsetNewSessionDefault()
        return fake to service
    }

    private fun ready() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady()
    }
}
