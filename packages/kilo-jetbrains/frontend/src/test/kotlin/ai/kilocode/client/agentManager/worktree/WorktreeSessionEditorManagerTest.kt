package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.migration.MigrationUiController
import ai.kilocode.client.migration.MigrationUiSelections
import ai.kilocode.client.migration.MigrationUiState
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import javax.swing.JComponent
import javax.swing.JPanel

@Suppress("UnstableApiUsage")
class WorktreeSessionEditorManagerTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var workspace: Workspace
    private lateinit var timers: TestUiTimers
    private val created = mutableListOf<Pair<String, String?>>()
    private val requested = mutableListOf<JComponent>()
    private val notified = mutableListOf<Pair<String, String?>>()
    private val ui = mutableListOf<SessionUi>()
    private var confirms = 0

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        timers = TestUiTimers()
        rpc = FakeSessionRpcApi()
        sessions = KiloSessionService(project, coroutines.scope, rpc)
        app = KiloAppService(coroutines.scope, FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        })
        workspaces = KiloWorkspaceService(coroutines.scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        })
        workspace = workspaces.workspace(DIR)
    }

    override fun tearDown() {
        try {
            TestDialogManager.setTestDialog(TestDialog.DEFAULT)
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test new session creates and opens a persisted session`() {
        rpc.session = session("ses_new", updated = 4.0).copy(title = "New session")
        val manager = manager()

        edt { manager.newSession() }
        flush()

        val active = edt { manager.component.getComponent(0) as JPanel }
        assertTrue(active is SessionUi)
        assertEquals(1, rpc.creates)
        assertEquals(listOf(DIR to "ses_new"), created)
        assertEquals(1, requested.size)
    }

    fun `test open session shows selected session`() {
        val session = session("ses_1", updated = 1.0)
        val manager = manager()

        edt { manager.openSession(SessionRef.Local(session)) }

        val active = edt { manager.component.getComponent(0) as JPanel }
        assertTrue(active is SessionUi)
        assertEquals(listOf(DIR to "ses_1"), created)
        assertEquals(1, requested.size)
    }

    fun `test start opens most recent listed session`() {
        rpc.listed += session("ses_old", updated = 1.0)
        rpc.listed += session("ses_new", updated = 3.0)
        val manager = manager()

        edt { manager.start() }
        flush()

        assertEquals(listOf(DIR), rpc.lists)
        assertEquals(listOf(DIR to "ses_new"), created)
        assertTrue(requested.isEmpty())
    }

    fun `test start preserves focused open intent`() {
        rpc.listed += session("ses_new", updated = 3.0)
        val manager = manager(focus = true)

        edt { manager.start() }
        flush()

        assertEquals(listOf(DIR to "ses_new"), created)
        assertEquals(1, requested.size)
    }

    fun `test start creates a session when none are listed`() {
        rpc.session = session("ses_new", updated = 4.0).copy(title = "New session")
        val manager = manager()

        edt { manager.start() }
        flush()

        assertTrue(rpc.lists.contains(DIR))
        assertEquals(1, rpc.creates)
        assertEquals(listOf(DIR to "ses_new"), created)
        assertTrue(requested.isEmpty())
    }

    fun `test preferred focus returns active session focus component`() {
        val session = session("ses_1", updated = 1.0)
        val manager = manager()

        edt { manager.openSession(SessionRef.Local(session)) }

        assertSame(edt { ui.single().defaultFocusedComponent }, edt { manager.preferredFocus() })
    }

    fun `test deleting shown session removes it and falls back to next session`() {
        val first = session("ses_1", updated = 3.0)
        val second = session("ses_2", updated = 2.0)
        rpc.listed += first
        rpc.listed += second
        val manager = manager()
        edt { manager.start() }
        flush()

        edt { manager.deleteSessions(listOf(first.id)) }
        pump()
        flush()

        assertEquals(1, confirms)
        assertEquals(listOf(DIR to "ses_1", DIR to "ses_2"), created)
        waitUntil { manager.deleting().isEmpty() }
        assertEquals(listOf(first.id to DIR), rpc.deletes.toList())
    }

    fun `test delete marks session deleting then removes on success`() {
        val gate = CompletableDeferred<Unit>()
        rpc.deleteGate = gate
        val session = session("ses_1", updated = 1.0)
        val manager = manager()

        edt { manager.deleteSessions(listOf(session.id)) }
        pump()

        assertEquals(setOf(session.id), edt { manager.deleting() })

        gate.complete(Unit)
        waitUntil { manager.deleting().isEmpty() && rpc.deletes.contains(session.id to DIR) }

        assertTrue(edt { manager.deleting().isEmpty() })
        assertEquals(listOf(session.id to DIR), rpc.deletes.toList())
        assertTrue(notified.isEmpty())
    }

    fun `test delete failure reverts row and notifies`() {
        val session = session("ses_1", updated = 1.0)
        rpc.listed += session
        rpc.deleteThrows = IllegalStateException("delete unavailable")
        val manager = manager()
        edt { manager.start() }
        flush()

        edt { manager.deleteSessions(listOf(session.id)) }
        waitUntil { manager.deleting().isEmpty() }

        assertTrue(edt { manager.deleting().isEmpty() })
        assertTrue(rpc.listed.any { it.id == session.id })
        assertEquals(listOf("Failed to delete session \"Session ses_1\"" to "delete unavailable"), notified)
    }

    private fun manager(focus: Boolean = false): WorktreeSessionEditorManager {
        val controller = WorktreeSessionListController(sessions, DIR, coroutines.scope)
        return WorktreeSessionEditorManager(
            parent = testRootDisposable,
            project = project,
            worktree = workspace,
            list = controller,
            create = { project, workspace, owner, ref, timers ->
                val id = when (ref) {
                    is SessionRef.Local -> ref.id
                    is SessionRef.Cloud -> ref.key
                    null -> null
                }
                created.add(workspace.directory to id)
                SessionUi(
                    project,
                    workspace,
                    sessions,
                    app,
                    coroutines.scope,
                    ref = ref,
                    manager = owner,
                    workspaces = workspaces,
                    migration = FakeMigration,
                    timers = timers,
                ).also {
                    ui.add(it)
                    Disposer.register(it) { ui.remove(it) }
                }
            },
            resolve = { workspaces.workspace(it) },
            status = { sessions.activity() },
            timers = timers,
            request = { requested += it },
            confirm = { _, _, _ -> confirms++; true },
            notify = { title, content -> notified += title to content },
        ).also { it.startFocus = focus }
    }

    private fun session(id: String, updated: Double) = SessionDto(
        id = id,
        projectID = "proj_test",
        directory = DIR,
        title = "Session $id",
        version = "1",
        time = SessionTimeDto(created = 0.0, updated = updated),
    )

    private fun flush() = coroutines.drain(::pump)

    private fun waitUntil(block: () -> Boolean) {
        repeat(10) {
            flush()
            if (edt(block)) return
        }
        assertTrue(edt(block))
    }

    private fun pump() {
        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            UIUtil.dispatchAllInvocationEvents()
        }
    }

    private fun <T> edt(block: () -> T): T {
        val out = arrayOfNulls<Any?>(1)
        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait { out[0] = block() }
        @Suppress("UNCHECKED_CAST")
        return out[0] as T
    }

    private companion object {
        const val DIR = "/repo/.kilo/worktrees/feature-x"
    }
}

private object FakeMigration : MigrationUiController {
    override val state = MutableStateFlow<MigrationUiState>(MigrationUiState.Hidden)
    override fun check() {}
    override fun start(selections: MigrationUiSelections) {}
    override fun skip() {}
    override fun later() {}
    override fun finish() {}
}
