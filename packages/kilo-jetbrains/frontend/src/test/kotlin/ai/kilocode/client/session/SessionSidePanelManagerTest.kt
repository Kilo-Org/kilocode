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
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import javax.swing.JPanel

@Suppress("UnstableApiUsage")
class SessionSidePanelManagerTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var workspace: Workspace
    private lateinit var sessions: KiloSessionService
    private lateinit var app: KiloAppService
    private val managers = mutableListOf<SessionSidePanelManager>()
    private val created = mutableListOf<Pair<String, String?>>()
    private val loading = mutableListOf<Boolean>()
    private val ui = mutableListOf<SessionUi>()

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, scope, rpc)
        app = KiloAppService(scope, FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        })
        workspaces = KiloWorkspaceService(scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        })
        workspace = workspaces.workspace("/test")
    }

    override fun tearDown() {
        try {
            managers.forEach { Disposer.dispose(it) }
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test component provides session manager`() {
        val manager = manager()
        val provider = manager.component as DataProvider

        assertSame(manager, provider.getData(SessionManager.KEY.name))
    }

    fun `test new session replaces active component`() {
        val manager = manager()

        manager.newSession()
        val first = active(manager)
        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            first.controller().prompt("hello")
        }
        settle()
        manager.newSession()
        val second = active(manager)

        assertNotSame(first, second)
        assertEquals(listOf("/test" to null, "/test" to null), created)
        assertEquals(listOf(true, false), loading)
    }

    fun `test new session on blank session keeps active component`() {
        val manager = manager()

        manager.newSession()
        val first = active(manager)
        manager.newSession()
        val second = active(manager)

        assertSame(first, second)
        assertEquals(listOf("/test" to null), created)
        assertEquals(listOf(true), loading)
    }

    fun `test opening same existing session reuses component`() {
        val manager = manager()
        val session = session("ses_1")

        manager.openSession(session)
        val first = active(manager)
        manager.newSession()
        manager.openSession(session)
        val second = active(manager)

        assertSame(first, second)
        assertEquals(listOf("/test" to "ses_1", "/test" to null), created)
        assertEquals(listOf(false, false), loading)
    }

    fun `test prompted blank session is reused from recents`() {
        val manager = manager()
        manager.newSession()
        val first = active(manager)

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            first.controller().prompt("hello")
        }
        settle()
        manager.newSession()
        manager.openSession(session("ses_test"))
        val second = active(manager)

        assertSame(first, second)
        assertEquals(1, rpc.creates)
        assertEquals(listOf("/test" to null, "/test" to null), created)
    }

    fun `test anonymous blank session is disposed when replaced`() {
        val manager = manager()
        manager.newSession()
        val first = active(manager)

        manager.openSession(session("ses_1"))

        assertNotSame(first, active(manager))
        assertFalse(ui.contains(first))
    }

    fun `test open session resolves historical workspace`() {
        val manager = manager()

        manager.openSession(session("ses_1", "/repo"))

        assertEquals(listOf("/repo" to "ses_1"), created)
        assertEquals(listOf(false), loading)
    }

    fun `test dispose removes active component`() {
        val manager = manager()

        manager.newSession()
        Disposer.dispose(manager)
        managers.remove(manager)

        assertEquals(0, manager.component.componentCount)
    }

    private fun manager(): SessionSidePanelManager {
        val manager = SessionSidePanelManager(
            project = project,
            root = workspace,
            create = { project, workspace, owner, id, show ->
                created.add(workspace.directory to id)
                loading.add(show)
                SessionUi(project, workspace, sessions, app, scope, id = id, loading = show, open = owner::openSession).also {
                    ui.add(it)
                    Disposer.register(it) { ui.remove(it) }
                }
            },
            resolve = { workspaces.workspace(it) },
        )
        managers.add(manager)
        return manager
    }

    private fun active(manager: SessionSidePanelManager) = manager.component.getComponent(0) as JPanel

    private fun JPanel.controller(): ai.kilocode.client.session.update.SessionController {
        val field = SessionUi::class.java.getDeclaredField("controller")
        field.isAccessible = true
        return field.get(this) as ai.kilocode.client.session.update.SessionController
    }

    private fun settle() = kotlinx.coroutines.runBlocking {
        repeat(5) {
            kotlinx.coroutines.delay(100)
            com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun session(id: String) = session(id, "/test")

    private fun session(id: String, dir: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = dir,
        title = "Session $id",
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )

}
