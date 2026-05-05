package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

@Suppress("UnstableApiUsage")
class SessionUiFactoryTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var workspace: Workspace
    private lateinit var sessions: KiloSessionService
    private lateinit var app: KiloAppService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        sessions = KiloSessionService(project, scope, FakeSessionRpcApi())
        app = KiloAppService(scope, FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        })
        val workspaces = KiloWorkspaceService(scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        })
        workspace = workspaces.workspace("/test")
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test factory creates blank session ui`() {
        val ui = direct().create(project, workspace, FakeManager(), null, true)

        assertNotNull(ui)
    }

    fun `test factory wires open callback`() {
        val manager = FakeManager()
        val rpc = session("ses_1")
        val ui = SessionUi(project, workspace, sessions, app, scope, open = manager::openSession)
        val controller = controller(ui)

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller.openSession(rpc)
        }

        assertEquals(listOf("ses_1"), manager.opened)
    }

    fun `test empty panel opens through controller`() {
        val manager = FakeManager()
        val rpc = session("ses_1")
        val ui = SessionUi(project, workspace, sessions, app, scope, open = manager::openSession)
        val controller = controller(ui)
        val panel = ai.kilocode.client.session.ui.EmptySessionPanel(testRootDisposable, controller, listOf(rpc))

        panel.clickRecent(0)

        assertEquals(listOf("ses_1"), manager.opened)
    }

    private fun controller(ui: SessionUi): ai.kilocode.client.session.update.SessionController {
        val field = SessionUi::class.java.getDeclaredField("controller")
        field.isAccessible = true
        return field.get(ui) as ai.kilocode.client.session.update.SessionController
    }

    fun `test application service is available`() {
        assertNotNull(service<SessionUiFactory>())
    }

    private fun direct() = SessionUiFactory(scope)

    private fun session(id: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = "Session $id",
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )

    private class FakeManager : SessionManager {
        val opened = mutableListOf<String>()
        override fun newSession() {
        }

        override fun openSession(session: SessionDto) {
            opened.add(session.id)
        }
    }
}
