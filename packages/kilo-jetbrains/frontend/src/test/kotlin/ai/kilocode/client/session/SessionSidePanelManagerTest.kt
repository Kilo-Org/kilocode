package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.session.history.HistoryPanel
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.CloudSessionDto
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
import javax.swing.JLabel
import javax.swing.JComponent
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
    private val refs = mutableListOf<SessionRef?>()
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
    }

    fun `test new session on blank session keeps active component`() {
        val manager = manager()

        manager.newSession()
        val first = active(manager)
        manager.newSession()
        val second = active(manager)

        assertSame(first, second)
        assertEquals(listOf("/test" to null), created)
    }

    fun `test default focused component tracks active session`() {
        val manager = manager()

        assertNull(manager.defaultFocusedComponent)
        manager.newSession()
        val first = active(manager) as SessionUi
        manager.openSession(session("ses_1"))
        val second = active(manager) as SessionUi

        assertSame(second.defaultFocusedComponent, manager.defaultFocusedComponent)
        assertNotSame(first.defaultFocusedComponent, manager.defaultFocusedComponent)
    }

    fun `test default focused component tracks history filter`() {
        val manager = manager()

        manager.showHistory()
        settle()
        val history = active(manager) as HistoryPanel

        assertSame(history.defaultFocusedComponent, manager.defaultFocusedComponent)
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
    }

    fun `test open session seeds session metadata into ui`() {
        val manager = manager()

        manager.openSession(session("ses_1", "/test", "Opened title"))

        val controller = active(manager).controller()
        assertEquals("Opened title", controller.model.session?.title)
    }

    fun `test inactive sessions keep queued style updates`() {
        val manager = manager()
        manager.openSession(session("ses_1"))
        val first = active(manager) as SessionUi
        manager.openSession(session("ses_2"))
        val style = ai.kilocode.client.session.ui.style.SessionEditorStyle.create(family = "Courier New", size = 24)

        first.applyStyle(style)
        manager.openSession(session("ses_1"))

        assertSame(first, active(manager))
        assertSame(style, first.currentStyle())
    }

    fun `test dispose removes active component`() {
        val manager = manager()

        manager.newSession()
        Disposer.dispose(manager)
        managers.remove(manager)

        assertEquals(0, manager.component.componentCount)
    }

    fun `test show history swaps active component`() {
        val history = JLabel("History")
        val manager = manager(history = { _, _, _ -> history })

        manager.newSession()
        manager.showHistory()

        assertSame(history, manager.component.getComponent(0))
        assertNull(manager.defaultFocusedComponent)
    }

    fun `test history back restores latest open session`() {
        val manager = manager()

        manager.openSession(session("ses_1"))
        val first = active(manager)
        manager.showHistory()
        back(manager)

        assertSame(first, active(manager))
    }

    fun `test history back without latest session opens new session`() {
        val manager = manager()

        manager.showHistory()
        back(manager)

        assertTrue(active(manager) is SessionUi)
        assertEquals(listOf("/test" to null), created)
    }

    fun `test history back ignores deleted latest session`() {
        val manager = manager()

        manager.openSession(session("ses_1"))
        manager.showHistory()
        remove(manager, "ses_1")
        back(manager)

        assertTrue(active(manager) is SessionUi)
        assertEquals(listOf("/test" to "ses_1", "/test" to null), created)
    }

    fun `test opening local history item shows session ui`() {
        lateinit var open: (SessionRef) -> Unit
        val history = JLabel("History")
        val manager = manager(history = { _, fn, _ ->
            open = fn
            history
        })

        manager.showHistory()
        open(SessionRef.Local(session("ses_1")))

        assertTrue(active(manager) is SessionUi)
        assertEquals(listOf("/test" to "ses_1"), created)
    }

    fun `test opening cloud history item shows session ui before import`() {
        lateinit var open: (SessionRef) -> Unit
        rpc.historyGate = kotlinx.coroutines.CompletableDeferred()
        rpc.importedCloudSession = session("ses_imported")
        val manager = manager(history = { _, fn, _ ->
            open = fn
            JLabel("History")
        })

        manager.showHistory()
        open(SessionRef.Cloud(cloud("cloud_1")))
        settle()

        assertTrue(active(manager) is SessionUi)
        assertEquals(listOf("/test" to "cloud:cloud_1"), created)
        assertEquals("cloud:cloud_1", refs.single()?.key)
        assertEquals(listOf("cloud_1" to "/test"), rpc.imports)

        rpc.historyGate?.complete(Unit)
        settle()
        assertSame(active(manager), ui.single())
        assertEquals(listOf("/test" to "cloud:cloud_1"), created)
    }

    fun `test opening same cloud session while in-flight reuses existing ui`() {
        rpc.historyGate = kotlinx.coroutines.CompletableDeferred()
        rpc.importedCloudSession = session("ses_imported")
        val manager = manager()
        val ref = SessionRef.Cloud(cloud("cloud_1"))

        manager.openSession(ref)
        val first = active(manager)
        manager.newSession()
        manager.openSession(ref)
        val second = active(manager)

        assertSame(first, second)
        assertEquals(listOf("/test" to "cloud:cloud_1", "/test" to null), created)

        rpc.historyGate!!.complete(Unit)
        settle()
    }

    fun `test imported cloud session is reused when opened as local`() {
        rpc.importedCloudSession = session("ses_imported")
        val manager = manager()

        manager.openSession(SessionRef.Cloud(cloud("cloud_1")))
        settle()
        val first = active(manager)
        manager.openSession(session("ses_imported"))
        val second = active(manager)

        assertSame(first, second)
        assertEquals(listOf("/test" to "cloud:cloud_1"), created)
    }

    fun `test new session from history shows blank session`() {
        val history = JLabel("History")
        val manager = manager(history = { _, _, _ -> history })

        manager.showHistory()
        manager.newSession()

        assertTrue(active(manager) is SessionUi)
        assertEquals(listOf("/test" to null), created)
    }

    fun `test opening same local session while in-flight reuses existing ui`() {
        val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val manager = manager()
        val session = session("ses_1")

        manager.openSession(session)
        val first = active(manager)
        // Open the same session again while history is still loading
        manager.newSession()
        manager.openSession(session)
        val second = active(manager)

        assertSame("in-flight session must be reused", first, second)
        assertEquals(listOf("/test" to "ses_1", "/test" to null), created)

        gate.complete(Unit)
        settle()
    }

    fun `test deleted cached history session is not reused`() {
        lateinit var deleted: (String) -> Unit
        val manager = manager(history = { _, _, fn ->
            deleted = fn
            JLabel("History")
        })
        val session = session("ses_1")

        manager.openSession(session)
        val first = active(manager)
        manager.showHistory()
        deleted("ses_1")
        manager.openSession(session)

        assertNotSame(first, active(manager))
        assertEquals(listOf("/test" to "ses_1", "/test" to "ses_1"), created)
    }

    private fun manager(
        history: ((com.intellij.openapi.Disposable, (SessionRef) -> Unit, (String) -> Unit) -> JComponent)? = null,
    ): SessionSidePanelManager {
        val manager = SessionSidePanelManager(
            project = project,
            root = workspace,
            create = { project, workspace, owner, ref ->
                val id = when (ref) {
                    is SessionRef.Local -> ref.id
                    is SessionRef.Cloud -> ref.key
                    null -> null
                }
                created.add(workspace.directory to id)
                refs.add(ref)
                SessionUi(project, workspace, sessions, app, scope, ref = ref, manager = owner).also {
                    ui.add(it)
                    Disposer.register(it) { ui.remove(it) }
                }
            },
            resolve = { workspaces.workspace(it) },
            history = history,
        )
        managers.add(manager)
        return manager
    }

    private fun active(manager: SessionSidePanelManager) = manager.component.getComponent(0) as JPanel

    private fun JPanel.controller(): ai.kilocode.client.session.controller.SessionController {
        val field = SessionUi::class.java.getDeclaredField("controller")
        field.isAccessible = true
        return field.get(this) as ai.kilocode.client.session.controller.SessionController
    }

    private fun remove(manager: SessionSidePanelManager, id: String) {
        val method = SessionSidePanelManager::class.java.getDeclaredMethod("removeSession", String::class.java)
        method.isAccessible = true
        method.invoke(manager, id)
    }

    private fun back(manager: SessionSidePanelManager) {
        val method = SessionSidePanelManager::class.java.getDeclaredMethod("back")
        method.isAccessible = true
        method.invoke(manager)
    }

    private fun settle() = kotlinx.coroutines.runBlocking {
        repeat(5) {
            kotlinx.coroutines.delay(100)
            com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun session(id: String) = session(id, "/test")

    private fun session(id: String, dir: String, title: String = "Session $id") = SessionDto(
        id = id,
        projectID = "prj",
        directory = dir,
        title = title,
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )

    private fun cloud(id: String) = CloudSessionDto(
        id = id,
        title = "Cloud $id",
        createdAt = "2026-01-01T00:00:00Z",
        updatedAt = "2026-01-02T00:00:00Z",
        version = 1.0,
    )

}
