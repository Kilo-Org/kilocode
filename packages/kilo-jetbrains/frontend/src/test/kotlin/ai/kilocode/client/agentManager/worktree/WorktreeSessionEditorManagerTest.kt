package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edtWait
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.onboarding.providers.v5migration.FakeMigrationUiController
import ai.kilocode.client.onboarding.providers.v5migration.MigrationUiState
import ai.kilocode.client.onboarding.FakeOnboardingController
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.MigrationProviderInfoDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.util.registry.RegistryKeyDescriptor
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CompletableDeferred
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
    private val migration = FakeMigrationUiController()
    private val onboarding = FakeOnboardingController()

    override fun setUp() {
        super.setUp()
        TestDialogManager.setTestDialog(TestDialog.DEFAULT)
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
        useInactiveDisposeTimeout()
    }

    override fun tearDown() {
        try {
            TestDialogManager.setTestDialog(TestDialog.DEFAULT)
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test empty panel is minimal`() {
        val manager = manager()
        val controller = controller()
        flush()

        val panel = edt { manager.emptyPanel(testRootDisposable, controller) }

        assertTrue(panel.logoVisible())
        assertTrue(panel.feedbackVisible())
        assertFalse(panel.descriptionVisible())
        assertFalse(panel.historyVisible())
        assertFalse(panel.recentVisible())
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

    fun `test new session sends the queued worktree prompt once with its picked selection`() {
        rpc.session = session("ses_new", updated = 4.0).copy(title = "New session")
        val manager = manager()
        edt {
            service<PendingWorktreePrompt>().put(
                DIR,
                PendingPrompt("fix the bug", agent = "plan", provider = "kilo", model = "gpt-5", variant = "high"),
            )
        }

        edt { manager.newSession() }
        waitUntil { rpc.prompts.any { it.first == "ses_new" } }

        val sent = rpc.prompts.single { it.first == "ses_new" }
        assertEquals(DIR, sent.second)
        assertTrue("prompt parts should carry the typed text", sent.third.parts.any { it.text == "fix the bug" })
        // The dialog's mode / model / reasoning must ride along with the first turn.
        assertEquals("plan", sent.third.agent)
        assertEquals("kilo", sent.third.providerID)
        assertEquals("gpt-5", sent.third.modelID)
        assertEquals("high", sent.third.variant)
        // The queued prompt is consumed once, so it is cleared after the first new session.
        assertNull(edt { service<PendingWorktreePrompt>().take(DIR) })
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

        assertEquals(listOf(DIR to "ses_1", DIR to "ses_2"), created)
        waitUntil { manager.deleting().isEmpty() }
        assertEquals(listOf(first.id to DIR), rpc.deletes.toList())
    }

    fun `test deleting middle shown session falls back to next visible session`() {
        val top = session("ses_top", updated = 3.0)
        val mid = session("ses_mid", updated = 2.0)
        val bottom = session("ses_bottom", updated = 1.0)
        rpc.listed += top
        rpc.listed += mid
        rpc.listed += bottom
        val manager = manager()
        edt { manager.start() }
        flush()
        edt { manager.openSession(SessionRef.Local(mid), focus = false) }

        edt { manager.deleteSessions(listOf(mid.id)) }
        pump()
        flush()

        assertEquals(listOf(DIR to top.id, DIR to mid.id, DIR to bottom.id), created)
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
        val manager = manager(del = { _, done -> done(false, "delete unavailable") })
        edt { manager.start() }
        flush()

        edt { manager.deleteSessions(listOf(session.id)) }
        waitUntil { manager.deleting().isEmpty() }

        assertTrue(edt { manager.deleting().isEmpty() })
        assertTrue(rpc.listed.any { it.id == session.id })
        assertEquals(listOf("Failed to delete session \"Session ses_1\"" to "delete unavailable"), notified)
    }

    fun `test rename updates session title optimistically and keeps success`() {
        val session = session("ses_1", updated = 1.0)
        rpc.listed += session
        val controller = WorktreeSessionListController(sessions, DIR, coroutines.scope)
        val manager = manager(controller = controller)
        edt { manager.start() }
        flush()

        edt { manager.renameSession(session.id, "Renamed Session") }

        assertEquals("Renamed Session", edt { controller.model.getElementAt(0).title })
        flush()

        assertEquals(listOf(Triple(session.id, DIR, "Renamed Session")), rpc.renames)
        assertEquals("Renamed Session", edt { controller.model.getElementAt(0).title })
        assertTrue(notified.isEmpty())
    }

    fun `test rename failure reverts session title and notifies`() {
        val session = session("ses_1", updated = 1.0)
        rpc.listed += session
        rpc.renameThrows = IllegalStateException("rename unavailable")
        val controller = WorktreeSessionListController(sessions, DIR, coroutines.scope)
        val manager = manager(controller = controller)
        edt { manager.start() }
        flush()

        edt { manager.renameSession(session.id, "Renamed Session") }
        flush()

        assertEquals("Session ses_1", edt { controller.model.getElementAt(0).title })
        assertEquals(listOf("Failed to rename session \"Renamed Session\"" to "rename unavailable"), notified)
    }

    fun `test placeholder session title is not adopted as the worktree name`() {
        rpc.listed += session("ses_1", updated = 1.0).copy(title = "New session - 2026-07-30T19:01:40.945Z")
        val calls = mutableListOf<String>()
        val manager = manager(
            adopt = { _, _, name ->
                calls += name
                RenameWorktreeResultDto(worktree = WorktreeDto(DIR, name, "feature-x", DIR))
            },
        )

        edt { manager.start() }
        flush()

        assertTrue("the CLI placeholder title must not be adopted", calls.isEmpty())
    }

    fun `test first named session adopts the worktree name`() {
        rpc.listed += session("ses_1", updated = 1.0).copy(title = "Fix login bug")
        val calls = mutableListOf<Triple<String, String, String>>()
        val adoptedNames = mutableListOf<String>()
        val manager = manager(
            adopt = { dir, path, name ->
                calls += Triple(dir, path, name)
                RenameWorktreeResultDto(worktree = WorktreeDto(path, name, "feature-x", path))
            },
            onAdopted = { adoptedNames += it.name },
        )

        edt { manager.start() }
        waitUntil { calls.isNotEmpty() }

        assertEquals(listOf(Triple(DIR, DIR, "Fix login bug")), calls)
        assertEquals(listOf("Fix login bug"), adoptedNames)
    }

    fun `test skipped adoption keeps the default name and stops retrying`() {
        rpc.listed += session("ses_1", updated = 1.0).copy(title = "Fix login bug")
        rpc.session = session("ses_2", updated = 5.0).copy(title = "Another task")
        val calls = mutableListOf<String>()
        val adoptedNames = mutableListOf<String>()
        val manager = manager(
            adopt = { _, _, name -> calls += name; RenameWorktreeResultDto() },
            onAdopted = { adoptedNames += it.name },
        )

        edt { manager.start() }
        waitUntil { calls.isNotEmpty() }
        edt { manager.newSession() }
        flush()

        assertEquals(listOf("Fix login bug"), calls)
        assertTrue(adoptedNames.isEmpty())
    }

    fun `test shows empty session panel when create fails then creates on retry`() {
        rpc.createThrows = IllegalStateException("Kilo backend is not ready")
        rpc.session = session("ses_new", updated = 4.0).copy(title = "New session")
        val manager = manager()

        edt { manager.start() }
        flush()

        // No real session yet, but the editor shows the empty session panel instead of a blank void.
        assertTrue(edt { manager.component.getComponent(0) } is SessionUi)
        assertEquals(listOf(DIR to null), created)

        // Backend recovers -> starting again creates and shows the real session.
        rpc.createThrows = null
        edt { manager.start() }
        flush()

        assertEquals(listOf(DIR to null, DIR to "ses_new"), created)
        assertTrue(edt { manager.component.getComponent(0) } is SessionUi)
    }

    fun `test session appears after migration completes`() {
        rpc.createThrows = IllegalStateException("Kilo backend is not ready")
        rpc.session = session("ses_new", updated = 4.0).copy(title = "New session")
        val manager = manager()

        // Editor opened while the backend is paused for migration: only the empty panel shows.
        migration._state.value = MigrationUiState.Needed(detection = detection())
        flush()
        edt { manager.start() }
        flush()
        assertEquals(listOf(DIR to null), created)

        // Migration finishes -> the manager re-runs start() and the real session appears.
        rpc.createThrows = null
        migration._state.value = MigrationUiState.Hidden
        flush()

        assertEquals(listOf(DIR to null, DIR to "ses_new"), created)
    }

    private fun detection() = LegacyMigrationDetectionDto(
        providers = listOf(MigrationProviderInfoDto("profile1", "anthropic", "claude-3", true, true, "anthropic")),
        mcpServers = emptyList(),
        customModes = emptyList(),
        sessions = emptyList(),
        defaultModel = null,
        settings = null,
        hasData = true,
    )

    private fun manager(
        controller: WorktreeSessionListController = WorktreeSessionListController(sessions, DIR, coroutines.scope, telemetry = { _, _ -> }),
        del: (String, (Boolean, String?) -> Unit) -> Unit = controller::delete,
        adopt: suspend (String, String, String) -> RenameWorktreeResultDto = { _, _, _ -> RenameWorktreeResultDto() },
        onAdopted: (WorktreeDto) -> Unit = {},
    ): WorktreeSessionEditorManager {
        return WorktreeSessionEditorManager(
            parent = testRootDisposable,
            project = project,
            worktree = workspace,
            list = controller,
            del = del,
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
                    onboarding = onboarding,
                    timers = timers,
                ).also {
                    ui.add(it)
                    Disposer.register(it) { ui.remove(it) }
                }
            },
            resolve = { workspaces.workspace(it) },
            status = { sessions.activitySnapshot() },
            timers = timers,
            request = { requested += it },
            notify = { title, content -> notified += title to content },
            cs = coroutines.scope,
            migration = migration,
            adopt = adopt,
            onAdopted = onAdopted,
        )
    }

    private fun session(id: String, updated: Double) = SessionDto(
        id = id,
        projectID = "proj_test",
        directory = DIR,
        title = "Session $id",
        version = "1",
        time = SessionTimeDto(created = 0.0, updated = updated),
    )

    private fun controller() = SessionController(
        parent = testRootDisposable,
        sessions = sessions,
        workspace = workspace,
        app = app,
        cs = coroutines.scope,
        timers = timers,
    )

    private fun flush() = coroutines.drain()

    private fun waitUntil(block: () -> Boolean) {
        assertTrue(coroutines.pumpUntil { edt(block) })
    }

    private fun useInactiveDisposeTimeout() {
        Registry.mutateContributedKeys {
            it + (TIMEOUT to RegistryKeyDescriptor(
                TIMEOUT,
                "Milliseconds before hidden session UI is disposed after switching away.",
                "180000",
                false,
                false,
                null,
                null,
            ))
        }
        Disposer.register(testRootDisposable) {
            Registry.mutateContributedKeys { it - TIMEOUT }
        }
        Registry.get(TIMEOUT).setValue(60_000, testRootDisposable)
    }

    private fun pump() = pumpEdt()

    private fun <T> edt(block: () -> T): T = edtWait(block)

    private companion object {
        const val DIR = "/repo/.kilo/worktrees/feature-x"
        const val TIMEOUT = "kilo.session.inactive.disposeTimeoutMs"
    }
}
