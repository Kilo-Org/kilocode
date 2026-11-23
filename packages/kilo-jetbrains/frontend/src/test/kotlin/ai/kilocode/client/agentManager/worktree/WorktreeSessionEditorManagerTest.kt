package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edtWait
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.onboarding.providers.v5migration.FakeMigrationUiController
import ai.kilocode.client.onboarding.providers.v5migration.MigrationUiState
import ai.kilocode.client.onboarding.FakeOnboardingController
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.SessionManager
import ai.kilocode.client.session.SessionRef
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.session.SessionUiFactory
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.model.PromptAttachment
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.TEST_WAIT_MS
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.rpc.KiloSessionRpcApi
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.LegacyMigrationDetectionDto
import ai.kilocode.rpc.dto.MigrationProviderInfoDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.RenameWorktreeResultDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionListDto
import ai.kilocode.rpc.dto.SessionTimeDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.util.registry.RegistryKeyDescriptor
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.xmlb.XmlSerializer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import java.awt.Container
import javax.swing.JComponent
import javax.swing.JPanel

@Suppress("UnstableApiUsage")
class WorktreeSessionEditorManagerTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var sessions: KiloSessionService
    private lateinit var app: KiloAppService
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var workspaceRpc: FakeWorkspaceRpcApi
    private lateinit var workspace: Workspace
    private lateinit var timers: TestUiTimers
    private val created = mutableListOf<Pair<String, String?>>()
    private val requested = mutableListOf<JComponent>()
    private val notified = mutableListOf<Pair<String, String?>>()
    private val ui = mutableListOf<SessionUi>()
    private val movedTo = mutableListOf<Triple<String?, String, String>>()
    private var newWorktreeCalls = 0
    private val migration = FakeMigrationUiController()
    private val onboarding = FakeOnboardingController()

    override fun setUp() {
        super.setUp()
        TestDialogManager.setTestDialog(TestDialog.DEFAULT)
        coroutines = TestCoroutines()
        timers = TestUiTimers()
        rpc = FakeSessionRpcApi().also { it.session = it.session.copy(directory = DIR) }
        sessions = KiloSessionService(project, coroutines.scope, rpc)
        app = KiloAppService(coroutines.scope, FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        })
        workspaceRpc = FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        }
        workspaces = KiloWorkspaceService(coroutines.scope, workspaceRpc)
        workspace = workspaces.workspace(DIR)
        edt { service<PendingWorktreePrompt>().loadState(PendingWorktreePrompt.State()) }
        useInactiveDisposeTimeout()
    }

    override fun tearDown() {
        try {
            TestDialogManager.setTestDialog(TestDialog.DEFAULT)
            coroutines.close(::pump)
            edt { service<PendingWorktreePrompt>().loadState(PendingWorktreePrompt.State()) }
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
        val pending = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        assertEquals(pending.id, sent.third.messageID)
        assertTrue(pending.attempted)
        assertEquals("ses_new", pending.session)
        emit(ChatEventDto.MessageUpdated("ses_new", message("ses_new", pending.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        rpc.listed += rpc.session
        edt { manager.start() }
        flush()
        assertEquals(1, rpc.prompts.size)
    }

    fun `test reload winning creation race hands prompt to the intended first session once`() {
        creation(reloadFirst = true)
    }

    fun `test creation winning stale reload race hands prompt to the intended first session once`() {
        creation(reloadFirst = false)
    }

    private fun creation(reloadFirst: Boolean) {
        val api = FakeWorktreeRpcApi()
        val checkout = WorktreeDto("actual-id", "Feature", "feature/x", DIR)
        val create = CompletableDeferred<Unit>()
        val listing = CompletableDeferred<Unit>()
        val reload = CompletableDeferred<Unit>()
        api.beforeCreate = { create.await() }
        api.createResult = { CreateWorktreeResultDto(checkout) }
        api.listed += WorktreeDto("/repo", "Repo", "main", "/repo", main = true)
        api.listed += checkout.copy(id = "stale-id", locked = true)
        api.beforeList = { listing.complete(Unit); reload.await() }
        val controller = WorktreeController(KiloWorktreeService(coroutines.scope, api), "/repo", coroutines.scope, telemetry = { _, _ -> })
        val editor = manager()
        rpc.session = session("ses_intended", updated = 1.0)
        val payload = PendingPrompt("fix this checkout", "plan", "kilo", "gpt-5", "high")
        edt {
            controller.onSelect = { id ->
                if (!controller.isPending(id)) {
                    assertEquals(checkout.id, id)
                    assertEquals(payload, service<PendingWorktreePrompt>().peek(checkout.path)?.prompt)
                    editor.start()
                }
            }
            controller.create("feature/x", "main", prompt = payload)
            controller.reload()
        }
        waitUntil { api.creates.size == 1 && listing.isCompleted }
        if (reloadFirst) {
            reload.complete(Unit)
            flush()
            assertTrue(edt { controller.isPending(controller.model.getElementAt(0).id) })
            assertTrue(rpc.prompts.isEmpty())
        }
        create.complete(Unit)
        waitUntil { rpc.prompts.size == 1 }
        if (!reloadFirst) {
            reload.complete(Unit)
            flush()
        }

        assertEquals(listOf(checkout), edt { (0 until controller.model.size).map { controller.model.getElementAt(it) } })
        val sent = rpc.prompts.single()
        assertEquals("ses_intended", sent.first)
        assertEquals(DIR, sent.second)
        assertEquals(payload.text, sent.third.parts.first().text)
        assertEquals(payload.agent, sent.third.agent)
        assertEquals(payload.provider, sent.third.providerID)
        assertEquals(payload.model, sent.third.modelID)
        assertEquals(payload.variant, sent.third.variant)
        emit(ChatEventDto.MessageUpdated(sent.first, message(sent.first, requireNotNull(sent.third.messageID))))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })

        rpc.listed += rpc.session
        edt { editor.start() }
        flush()
        assertEquals(1, rpc.prompts.size)
    }

    fun `test list failure retains pending prompt without creating a rival session`() {
        queue()
        rpc.listThrows = IllegalStateException("list unavailable")
        val manager = manager()
        edt { manager.start() }
        flush()

        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })

        rpc.listThrows = null
        edt { manager.start() }
        waitUntil { rpc.prompts.size == 1 }
        assertEquals("initial prompt", rpc.prompts.single().third.parts.first().text)
    }

    fun `test list failure opens the explicitly supplied continued fork without a rival session`() {
        val fork = session("ses_continued", updated = 1.0)
        rpc.forked = fork
        rpc.listThrows = IllegalStateException("list unavailable")
        val controller = WorktreeSessionListController(sessions, DIR, coroutines.scope, telemetry = { _, _ -> })
        lateinit var editor: WorktreeSessionEditorManager

        edt {
            controller.fork("ses_source", null) { dto, err ->
                assertNull(err)
                editor = manager(controller = controller, session = requireNotNull(dto).id)
                editor.start()
            }
        }
        flush()

        assertEquals(listOf(FakeSessionRpcApi.ForkCall("ses_source", DIR, null)), rpc.forks)
        assertEquals(fork.id, edt { editor.currentKey() })
        assertEquals(listOf(DIR to fork.id), created)
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test supplied startup session takes priority over a valid journal binding`() {
        val entry = bound("ses_saved")
        rpc.listed += session("ses_saved", updated = 1.0)
        rpc.listed += session("ses_supplied", updated = 2.0)
        val manager = manager(session = "ses_supplied")

        edt { manager.start() }
        flush()

        assertEquals("ses_supplied", edt { manager.currentKey() })
        assertEquals(listOf(DIR to "ses_supplied"), created)
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test list failure still prioritizes supplied session over a resolved journal binding`() {
        val entry = bound(rpc.session.id)
        rpc.listThrows = IllegalStateException("list unavailable")
        val gate = CompletableDeferred<Unit>()
        val api = object : KiloSessionRpcApi by rpc {
            override suspend fun find(id: String, directory: String): SessionDto? {
                if (id == entry.session) gate.await()
                return rpc.find(id, directory)
            }
        }
        sessions = KiloSessionService(project, coroutines.scope, api)
        val manager = manager(session = "ses_supplied")

        edt { manager.start() }
        flush()

        assertEquals("ses_supplied", edt { manager.currentKey() })
        assertEquals(listOf(DIR to "ses_supplied"), created)
        assertTrue(rpc.prompts.isEmpty())
        gate.complete(Unit)
        flush()

        assertEquals("ses_supplied", edt { manager.currentKey() })
        assertEquals(listOf(DIR to "ses_supplied"), created)
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test saved session omitted from root list is resolved before opening`() {
        val entry = bound(rpc.session.id)
        rpc.listed += session("ses_unrelated", updated = 100.0)
        val manager = manager()

        edt { manager.start() }
        flush()

        assertEquals(entry.session, edt { manager.currentKey() })
        assertEquals(listOf(DIR to entry.session), created)
        assertEquals("initial prompt", edt { prompt().text() })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test failed list and lookup preserve live bound prompt until original target recovers`() {
        unavailable(listed = false)
    }

    fun `test successful root list and failed lookup preserve live child session and correlation`() {
        unavailable(listed = true)
    }

    fun `test cancelled lookup preserves live bound prompt and permits original target retry`() {
        unavailable(listed = true, err = CancellationException("lookup cancelled"))
    }

    private fun unavailable(listed: Boolean, err: Exception = IllegalStateException("session not found during outage")) {
        val payload = PendingPrompt("keep the original turn", "plan", "kilo", "gpt-5", "high")
        val entry = bound(rpc.session.id, payload, attempted = false)
        val gate = CompletableDeferred<Unit>()
        val sending = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val api = object : KiloSessionRpcApi by rpc {
            override suspend fun prompt(id: String, directory: String, prompt: PromptDto) {
                rpc.prompt(id, directory, prompt)
                sending.complete(Unit)
            }
        }
        sessions = KiloSessionService(project, coroutines.scope, api)
        rpc.listed += rpc.session
        val manager = manager()
        edt { manager.start() }
        flush()
        val active = edt { ui.single() }
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })

        rpc.listed.clear()
        rpc.listed += session("ses_unrelated", updated = 100.0)
        rpc.listThrows = if (listed) null else IllegalStateException("list unavailable")
        rpc.findThrows = err
        edt { manager.start() }
        flush()

        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertSame(active, edt { ui.single() })
        assertEquals(entry.session, edt { manager.currentKey() })
        assertEquals(listOf(DIR to entry.session), created)
        assertEquals(listOf(entry.session to DIR), rpc.finds)
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())

        rpc.findThrows = null
        edt { manager.start() }
        flush()
        assertSame(active, edt { ui.single() })
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        gate.complete(Unit)
        await(sending)

        val sent = rpc.prompts.single()
        assertEquals(entry.session, sent.first)
        assertEquals(entry.id, sent.third.messageID)
        assertEquals(payload.text, sent.third.parts.single().text)
        assertEquals(payload.agent, sent.third.agent)
        assertEquals(payload.provider, sent.third.providerID)
        assertEquals(payload.model, sent.third.modelID)
        assertEquals(payload.variant, sent.third.variant)
        assertEquals(entry.copy(attempted = true), edt { service<PendingWorktreePrompt>().peek(DIR) })
        edt { Disposer.dispose(manager) }
        val reopened = manager()
        edt { reopened.start() }
        flush()

        assertEquals(entry.session, edt { reopened.currentKey() })
        assertEquals(entry.id, edt { service<PendingWorktreePrompt>().peek(DIR)?.id })
        assertEquals(payload.text, edt { prompt().text() })
        assertEquals(1, rpc.prompts.size)
        assertEquals(0, rpc.creates)
    }

    fun `test failed lookup on reopen preserves attempted draft without selecting latest or creating rival`() {
        val entry = bound("ses_original", PendingPrompt("retry this", "plan", "kilo", "gpt-5", "high"))
        rpc.findThrows = IllegalStateException("backend unavailable")
        rpc.listed += session("ses_unrelated", updated = 100.0)
        val manager = manager()

        edt { manager.start() }
        flush()

        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(listOf(DIR to null), created)
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())

        rpc.session = session(requireNotNull(entry.session), updated = 1.0)
        rpc.findThrows = null
        edt { manager.start() }
        flush()

        assertEquals(entry.session, edt { manager.currentKey() })
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(entry.text, edt { prompt().text() })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test reconnect recovers a bound child draft without restarting the tab`() {
        reconnect(attempted = true, listed = false)
    }

    fun `test reconnect sends an unattempted child prompt exactly once`() {
        reconnect(attempted = false, listed = true)
    }

    private fun reconnect(attempted: Boolean, listed: Boolean) {
        val payload = PendingPrompt("recover after reconnect", "plan", "kilo", "gpt-5", "high")
        val entry = bound("ses_child", payload, attempted)
        val agents = listOf(AgentDto("code", mode = "code"), AgentDto("plan", mode = "plan"))
        workspaceRpc.state.value = workspaceRpc.state.value.copy(
            agents = AgentsDto(agents, agents, "code"),
            providers = ProvidersDto(
                listOf(ProviderDto("kilo", "Kilo", models = mapOf(
                    "gpt-5" to ModelDto("gpt-5", "GPT-5", variants = listOf("low", "high")),
                ))),
                listOf("kilo"), emptyMap(),
            ),
        )
        rpc.session = session("ses_child", updated = 1.0).copy(parentID = "ses_root")
        rpc.listed += session("ses_root", updated = 2.0)
        rpc.listThrows = if (listed) null else IllegalStateException("list unavailable")
        rpc.findThrows = IllegalStateException("lookup unavailable")
        val state = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.ERROR))
        val list = WorktreeSessionListController(sessions, DIR, coroutines.scope, state, telemetry = { _, _ -> })
        val manager = manager(controller = list)
        edt { manager.start() }
        flush()
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(listOf(DIR to null), created)
        assertEquals(0, rpc.creates)

        rpc.listThrows = null
        rpc.findThrows = null
        state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        waitUntil { manager.currentKey() == entry.session }
        flush()

        assertEquals(listOf(DIR to null, DIR to entry.session), created)
        assertEquals(0, rpc.creates)
        assertEquals(entry.id, edt { service<PendingWorktreePrompt>().peek(DIR)?.id })
        if (attempted) {
            assertTrue(rpc.prompts.isEmpty())
            assertEquals(payload.text, edt { prompt().text() })
            edt { prompt().send() }
        }
        waitUntil { rpc.prompts.size == 1 }
        val sent = rpc.prompts.single()
        assertEquals(entry.session, sent.first)
        assertEquals(entry.id, sent.third.messageID)
        assertEquals(payload.text, sent.third.parts.single().text)
        assertEquals(payload.agent, sent.third.agent)
        assertEquals(payload.provider, sent.third.providerID)
        assertEquals(payload.model, sent.third.modelID)
        assertEquals(payload.variant, sent.third.variant)
        emit(ChatEventDto.MessageUpdated(sent.first, message(sent.first, entry.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })

        state.value = KiloAppStateDto(KiloAppStatusDto.ERROR)
        flush()
        val before = rpc.lists.size
        state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        waitUntil { rpc.lists.size > before }
        flush()
        assertEquals(entry.session, edt { manager.currentKey() })
        assertEquals(2, created.size)
        assertEquals(1, rpc.prompts.size)
        assertEquals(0, rpc.creates)
    }

    fun `test reconnect recovery ignores a late missing lookup after the child was opened`() {
        val entry = bound("ses_child")
        rpc.session = session("ses_child", updated = 1.0).copy(parentID = "ses_root")
        rpc.listed += session("ses_root", updated = 2.0)
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val api = object : KiloSessionRpcApi by rpc {
            override suspend fun find(id: String, directory: String): SessionDto? {
                if (!entered.isCompleted) {
                    entered.complete(Unit)
                    gate.await()
                    return null
                }
                return rpc.find(id, directory)
            }
        }
        sessions = KiloSessionService(project, coroutines.scope, api)
        val state = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.ERROR))
        val list = WorktreeSessionListController(sessions, DIR, coroutines.scope, state, telemetry = { _, _ -> })
        val manager = manager(controller = list)
        edt { manager.start() }
        waitUntil { entered.isCompleted }

        state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        waitUntil { manager.currentKey() == entry.session }
        gate.complete(Unit)
        flush()

        assertEquals(listOf(DIR to entry.session), created)
        assertEquals(entry.session, edt { manager.currentKey() })
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(entry.text, edt { prompt().text() })
        assertTrue(rpc.prompts.isEmpty())
        assertEquals(0, rpc.creates)
    }

    fun `test late initial listing cannot replace a session recovered by reconnect`() {
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val api = object : KiloSessionRpcApi by rpc {
            override suspend fun list(directory: String): SessionListDto {
                val snapshot = rpc.list(directory)
                if (!entered.isCompleted) {
                    entered.complete(Unit)
                    gate.await()
                }
                return snapshot
            }
        }
        sessions = KiloSessionService(project, coroutines.scope, api)
        val state = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.ERROR))
        val list = WorktreeSessionListController(sessions, DIR, coroutines.scope, state, telemetry = { _, _ -> })
        val manager = manager(controller = list)
        edt { manager.start() }
        waitUntil { entered.isCompleted }

        rpc.listed += session("ses_recovered", updated = 1.0)
        state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        waitUntil { manager.currentKey() == "ses_recovered" }
        gate.complete(Unit)
        flush()

        assertEquals(listOf(DIR to "ses_recovered"), created)
        assertEquals("ses_recovered", edt { manager.currentKey() })
        assertEquals(0, rpc.creates)
    }

    fun `test reconnect lookup cannot replace a session started in the blank composer`() {
        pendingCreation(programmatic = false)
    }

    fun `test reconnect lookup cannot cancel a programmatic send while session creation is pending`() {
        pendingCreation(programmatic = true)
    }

    private fun pendingCreation(programmatic: Boolean) {
        val entry = bound("ses_child")
        val child = session("ses_child", updated = 1.0).copy(parentID = "ses_root")
        rpc.listed += session("ses_root", updated = 2.0)
        rpc.findThrows = IllegalStateException("lookup unavailable")
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val api = object : KiloSessionRpcApi by rpc {
            override suspend fun find(id: String, directory: String): SessionDto? {
                rpc.findThrows?.let { throw it }
                entered.complete(Unit)
                gate.await()
                return child
            }
        }
        sessions = KiloSessionService(project, coroutines.scope, api)
        val state = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.ERROR))
        val list = WorktreeSessionListController(sessions, DIR, coroutines.scope, state, telemetry = { _, _ -> })
        val manager = manager(controller = list)
        edt { manager.start() }
        flush()
        val blank = edt { ui.single() }

        rpc.findThrows = null
        state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        waitUntil { entered.isCompleted }
        rpc.session = session("ses_user", updated = 3.0)
        val create = CompletableDeferred<Unit>()
        rpc.createGate = create
        edt {
            if (programmatic) manager.submitPrompt("start a different conversation", "New conversation")
            if (!programmatic) {
                prompt().setDraft("start a different conversation", emptyList())
                prompt().send()
            }
        }
        waitUntil { rpc.creates == 1 }
        gate.complete(Unit)
        flush()

        assertSame(blank, edt { ui.single() })
        assertNull(edt { blank.id })
        assertTrue(rpc.prompts.isEmpty())
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        create.complete(Unit)
        waitUntil { rpc.prompts.size == 1 }
        assertSame(blank, edt { ui.single() })
        assertEquals("ses_user", edt { blank.id })
        assertEquals("ses_user", rpc.prompts.single().first)
        assertEquals("start a different conversation", rpc.prompts.single().third.parts.single().text)
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(1, rpc.creates)
    }

    fun `test reconnect lookup preserves an unsent blank draft and its attachments`() {
        val entry = bound("ses_child")
        val child = session("ses_child", updated = 1.0).copy(parentID = "ses_root")
        rpc.listed += session("ses_root", updated = 2.0)
        rpc.findThrows = IllegalStateException("lookup unavailable")
        val entered = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val api = object : KiloSessionRpcApi by rpc {
            override suspend fun find(id: String, directory: String): SessionDto? {
                rpc.findThrows?.let { throw it }
                entered.complete(Unit)
                gate.await()
                return child
            }
        }
        sessions = KiloSessionService(project, coroutines.scope, api)
        val state = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.ERROR))
        val list = WorktreeSessionListController(sessions, DIR, coroutines.scope, state, telemetry = { _, _ -> })
        val manager = manager(controller = list)
        edt { manager.start() }
        flush()
        val blank = edt { ui.single() }
        rpc.findThrows = null
        state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        waitUntil { entered.isCompleted }
        val attachment = PromptAttachment("notes", "notes.txt", "text/plain", "file:///notes.txt", reference = true)
        edt { prompt().setDraft("my newer draft", listOf(attachment)) }

        gate.complete(Unit)
        flush()

        assertSame(blank, edt { ui.single() })
        assertNull(edt { blank.id })
        assertEquals("my newer draft", edt { prompt().text() })
        assertEquals(listOf(attachment), edt { prompt().attachments() })
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test passive reload does not open a background or disposed manager`() {
        val entry = bound("ses_child")
        val state = MutableStateFlow(KiloAppStateDto(KiloAppStatusDto.ERROR))
        val list = WorktreeSessionListController(sessions, DIR, coroutines.scope, state, telemetry = { _, _ -> })
        val manager = manager(controller = list)
        flush()
        state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        waitUntil { rpc.lists.isNotEmpty() }
        flush()
        assertTrue(created.isEmpty())
        assertTrue(rpc.finds.isEmpty())

        rpc.findThrows = IllegalStateException("lookup unavailable")
        edt { manager.start() }
        flush()
        assertEquals(listOf(DIR to null), created)
        edt { Disposer.dispose(manager) }
        assertNull(list.onReload)
        state.value = KiloAppStateDto(KiloAppStatusDto.ERROR)
        flush()
        rpc.findThrows = null
        val before = rpc.lists.size
        state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        waitUntil { rpc.lists.size > before }
        flush()

        assertEquals(listOf(DIR to null), created)
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test supplied session wins during list and saved lookup failure without retargeting prompt`() {
        val entry = bound("ses_original", PendingPrompt("keep original choices", "plan", "kilo", "gpt-5", "high"), attempted = false)
        rpc.listThrows = IllegalStateException("list unavailable")
        rpc.findThrows = IllegalStateException("lookup unavailable")
        val manager = manager(session = "ses_supplied")

        edt { manager.start() }
        flush()

        assertEquals("ses_supplied", edt { manager.currentKey() })
        assertEquals(listOf(DIR to "ses_supplied"), created)
        assertEquals(entry, edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test deleted bound session recovers selected prompt in existing session without automatic resend`() {
        val payload = PendingPrompt("recover this draft", "plan", "kilo", "gpt-5", "high")
        val agents = listOf(AgentDto("code", mode = "code"), AgentDto("plan", mode = "plan"))
        workspaceRpc.state.value = workspaceRpc.state.value.copy(
            agents = AgentsDto(agents, agents, "code"),
            providers = ProvidersDto(
                listOf(ProviderDto("kilo", "Kilo", models = mapOf(
                    "gpt-5" to ModelDto("gpt-5", "GPT-5", variants = listOf("low", "high")),
                ))),
                listOf("kilo"),
                emptyMap(),
            ),
        )
        val entry = bound("ses_deleted", payload, attempted = false)
        val sending = CompletableDeferred<Unit>()
        missing("ses_deleted", sending)
        rpc.session = session("ses_existing", updated = 2.0)
        rpc.listed += rpc.session
        val manager = manager()

        edt { manager.start() }
        flush()

        val recovered = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        assertEquals(rpc.session.id, edt { manager.currentKey() })
        assertEquals(listOf(DIR to rpc.session.id), created)
        assertEquals(payload.text, edt { prompt().text() })
        assertEquals(payload, recovered.prompt)
        assertEquals(rpc.session.id, recovered.session)
        assertTrue(recovered.attempted)
        assertFalse(entry.id == recovered.id)
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, entry.id)))
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })

        edt {
            assertTrue(prompt().isSendEnabled)
            prompt().send()
        }
        await(sending)

        val sent = rpc.prompts.single()
        assertEquals(rpc.session.id, sent.first)
        assertEquals(recovered.id, sent.third.messageID)
        assertEquals(payload.text, sent.third.parts.first().text)
        assertEquals(payload.agent, sent.third.agent)
        assertEquals(payload.provider, sent.third.providerID)
        assertEquals(payload.model, sent.third.modelID)
        assertEquals(payload.variant, sent.third.variant)
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, recovered.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
    }

    fun `test deleted bound session recovers into supplied session ahead of latest session`() {
        val entry = bound("ses_deleted", attempted = false)
        missing("ses_deleted")
        rpc.listed += session("ses_supplied", updated = 1.0)
        rpc.listed += session("ses_latest", updated = 10.0)
        val manager = manager(session = "ses_supplied")

        edt { manager.start() }
        flush()

        assertEquals("ses_supplied", edt { manager.currentKey() })
        assertEquals(listOf(DIR to "ses_supplied"), created)
        assertEquals(entry.prompt, edt { service<PendingWorktreePrompt>().peek(DIR)?.prompt })
        assertEquals("ses_supplied", edt { service<PendingWorktreePrompt>().peek(DIR)?.session })
        assertEquals(entry.text, edt { prompt().text() })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test deleted bound session creates one recovery session and requires explicit retry`() {
        val entry = bound("ses_deleted", attempted = false)
        missing("ses_deleted")
        rpc.session = session("ses_recovery", updated = 1.0)
        val manager = manager()

        edt { manager.start() }
        flush()

        assertEquals(listOf(DIR to rpc.session.id), created)
        assertEquals(rpc.session.id, edt { manager.currentKey() })
        assertEquals(entry.text, edt { prompt().text() })
        assertEquals(entry.prompt, edt { service<PendingWorktreePrompt>().peek(DIR)?.prompt })
        assertTrue(edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)).attempted })
        assertEquals(1, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())

        rpc.listed += rpc.session
        edt { manager.start() }
        flush()

        assertEquals(1, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
        assertEquals(entry.text, edt { prompt().text() })
    }

    fun `test deleted journal target is not reopened when it was also the supplied session`() {
        val entry = bound("ses_deleted", attempted = false)
        missing("ses_deleted")
        rpc.listed += session("ses_existing", updated = 1.0)
        val manager = manager(session = "ses_deleted")

        edt { manager.start() }
        flush()

        assertEquals("ses_existing", edt { manager.currentKey() })
        assertEquals(listOf(DIR to "ses_existing"), created)
        assertEquals(entry.text, edt { prompt().text() })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())

        edt { manager.start() }
        flush()

        assertEquals("ses_existing", edt { manager.currentKey() })
        assertEquals(listOf(DIR to "ses_existing"), created)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test missing bound session closes its waiting UI before recovering the draft`() {
        queue()
        missing("ses_deleted")
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        rpc.listed += session("ses_deleted", updated = 1.0)
        val manager = manager()
        edt { manager.start() }
        flush()
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        assertFalse(entry.attempted)

        rpc.session = session("ses_existing", updated = 2.0)
        rpc.listed.clear()
        rpc.listed += rpc.session
        edt { manager.start() }
        flush()

        assertEquals(listOf(DIR to "ses_deleted", DIR to rpc.session.id), created)
        assertEquals(listOf(rpc.session.id), edt { ui.map { it.id } })
        assertEquals(entry.text, edt { prompt().text() })
        gate.complete(Unit)
        flush()

        assertEquals(rpc.session.id, edt { manager.currentKey() })
        assertEquals(entry.text, edt { prompt().text() })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test failed first session creation retains prompt for retry`() {
        queue()
        rpc.createThrows = IllegalStateException("create unavailable")
        val manager = manager()
        edt { manager.start() }
        flush()
        assertTrue(rpc.prompts.isEmpty())
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR)?.session })

        rpc.createThrows = null
        edt { manager.start() }
        waitUntil { rpc.prompts.size == 1 }
        assertEquals("initial prompt", rpc.prompts.single().third.parts.first().text)
    }

    fun `test editor opening failure retains prompt for reopen`() {
        queue()
        var fail = true
        val manager = manager(open = {
            if (fail) {
                fail = false
                error("editor unavailable")
            }
        })
        edt { manager.newSession() }
        assertThrows(IllegalStateException::class.java) { flush() }
        assertTrue(rpc.prompts.isEmpty())
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        edt { Disposer.dispose(manager) }

        rpc.listed += rpc.session
        val reopened = manager()
        edt { reopened.start() }
        waitUntil { rpc.prompts.size == 1 }
    }

    fun `test closing while first session create is pending leaves prompt for reopen`() {
        queue()
        val gate = CompletableDeferred<Unit>()
        rpc.createGate = gate
        val manager = manager()
        edt { manager.newSession() }
        waitUntil { rpc.creates == 1 }
        edt { Disposer.dispose(manager) }
        gate.complete(Unit)
        flush()

        assertTrue(created.isEmpty())
        assertTrue(rpc.prompts.isEmpty())
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        rpc.listed += rpc.session
        val reopened = manager()
        edt { reopened.start() }
        waitUntil { rpc.prompts.size == 1 }
    }

    fun `test synchronous initial send failure restores an editable retry with the same correlation`() {
        queue()
        rpc.promptThrows = IllegalStateException("send rejected")
        val manager = manager()
        edt { manager.start() }
        waitUntil { ui.isNotEmpty() && prompt().text() == "initial prompt" }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        assertTrue(entry.attempted)
        assertTrue(rpc.prompts.isEmpty())

        rpc.promptThrows = null
        edt { prompt().send() }
        waitUntil { rpc.prompts.size == 1 }
        assertEquals(entry.id, rpc.prompts.single().third.messageID)
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, "unrelated")))
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, entry.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
    }

    fun `test asynchronous rejection after accepted RPC retains and restores initial prompt`() {
        queue()
        val manager = manager()
        edt { manager.start() }
        waitUntil { rpc.prompts.size == 1 }
        emit(ChatEventDto.Error(rpc.session.id, MessageErrorDto("unknown", message = "not persisted")))

        assertEquals("initial prompt", edt { prompt().text() })
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        emit(ChatEventDto.TurnOpen(rpc.session.id))
        assertEquals("initial prompt", edt { prompt().text() })
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, entry.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals("", edt { prompt().text() })
    }

    fun `test automatic handoff preserves a newer composer draft typed during history loading`() {
        queue()
        val gate = CompletableDeferred<Unit>()
        rpc.historyGate = gate
        val manager = manager()
        edt { manager.start() }
        waitUntil { rpc.historyCalls == 1 }
        edt { prompt().setText("a newer draft") }
        gate.complete(Unit)
        waitUntil { rpc.prompts.size == 1 }

        assertEquals("initial prompt", rpc.prompts.single().third.parts.first().text)
        assertEquals("a newer draft", edt { prompt().text() })
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, requireNotNull(rpc.prompts.single().third.messageID))))
        assertEquals("a newer draft", edt { prompt().text() })
    }

    fun `test pending prompt also hands off into an already loaded retained session UI`() {
        val manager = manager()
        edt { manager.openSession(SessionRef.Local(rpc.session)) }
        flush()
        assertEquals(1, rpc.historyCalls)
        queue()
        rpc.listed += rpc.session

        edt { manager.start() }
        waitUntil { rpc.prompts.size == 1 }
        assertEquals(1, rpc.historyCalls)
        assertEquals("initial prompt", rpc.prompts.single().third.parts.first().text)
    }

    fun `test repeated sends while initial handoff is unconfirmed do not reuse its message id`() {
        queue()
        val manager = manager()
        edt { manager.start() }
        waitUntil { rpc.prompts.size == 1 }
        edt {
            prompt().setText("a followup draft")
            prompt().send()
        }
        flush()
        edt { prompt().send() }
        flush()

        assertEquals(1, rpc.prompts.size)
        assertEquals("a followup draft", edt { prompt().text() })
        assertEquals("initial prompt", edt { service<PendingWorktreePrompt>().peek(DIR)?.text })
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, requireNotNull(rpc.prompts.single().third.messageID))))
        edt { prompt().send() }
        waitUntil { rpc.prompts.size == 2 }
        assertEquals("a followup draft", rpc.prompts.last().third.parts.first().text)
        assertNull(rpc.prompts.last().third.messageID)
    }

    fun `test initial client action is an editable draft and never automatically replays on reopen`() {
        queue("/new")
        val first = manager()
        edt { first.start() }
        waitUntil { ui.isNotEmpty() && prompt().text() == "/new" }
        assertEquals(1, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
        edt { Disposer.dispose(first) }

        val reopened = manager()
        edt { reopened.start() }
        waitUntil { ui.isNotEmpty() && prompt().text() == "/new" }
        assertEquals(1, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        edt { prompt().send() }
        waitUntil { rpc.creates == 2 }
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        edt { Disposer.dispose(reopened) }

        rpc.listed += rpc.session
        val again = manager()
        edt { again.start() }
        flush()
        assertEquals(2, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test thrown explicit client action retains its draft until a synchronous retry succeeds`() {
        val editors = edt { EditorFactory.getInstance().allEditors.size }
        queue("/sessions")
        val manager = manager()
        edt { manager.start() }
        waitUntil { ui.isNotEmpty() && prompt().text() == "/sessions" }
        var calls = 0
        edt {
            manager.onListChanged = { calls++; error("navigation failed") }
            prompt().send()
        }
        waitUntil { calls == 1 && prompt().text() == "/sessions" }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        assertTrue(entry.attempted)

        edt {
            manager.onListChanged = { calls++ }
            prompt().send()
        }
        waitUntil { service<PendingWorktreePrompt>().peek(DIR) == null }
        assertEquals(2, calls)
        assertEquals("", edt { prompt().text() })
        edt { Disposer.dispose(manager) }
        rpc.listed += rpc.session
        val reopened = manager()
        edt { reopened.start() }
        flush()
        assertEquals(2, calls)
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        edt { Disposer.dispose(reopened) }
        flush()
        assertEquals(editors, edt { EditorFactory.getInstance().allEditors.size })
    }

    fun `test initial server command automatically sends with durable correlation and selected choices`() {
        workspaceRpc.state.value = workspaceRpc.state.value.copy(commands = listOf(CommandDto("review")))
        val payload = PendingPrompt("/review changes", "plan", "kilo", "gpt-5", "high")
        edt { service<PendingWorktreePrompt>().put(DIR, DIR, payload) }
        val first = manager()
        edt { first.start() }
        waitUntil { rpc.commands.size == 1 }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        val call = rpc.commands.single()
        assertEquals(entry.id, call.prompt.messageID)
        assertEquals(entry.session, call.id)
        assertEquals(DIR, call.directory)
        assertEquals("review", call.command)
        assertEquals("changes", call.arguments)
        assertEquals(payload.agent, call.prompt.agent)
        assertEquals(payload.provider, call.prompt.providerID)
        assertEquals(payload.model, call.prompt.modelID)
        assertEquals(payload.variant, call.prompt.variant)
        assertTrue(entry.attempted)
        emit(ChatEventDto.MessageUpdated(call.id, message(call.id, "unrelated")))
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        emit(ChatEventDto.MessageUpdated(call.id, message(call.id, entry.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        edt { Disposer.dispose(first) }

        rpc.listed += rpc.session
        val reopened = manager()
        edt { reopened.start() }
        flush()
        assertEquals(1, rpc.commands.size)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test synchronous initial command failure restores draft and retries with the same message id`() {
        workspaceRpc.state.value = workspaceRpc.state.value.copy(commands = listOf(CommandDto("review")))
        rpc.commandThrows = IllegalStateException("command rejected")
        queue("/review changes")
        val manager = manager()
        edt { manager.start() }
        waitUntil { ui.isNotEmpty() && prompt().text() == "/review changes" }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        assertTrue(entry.attempted)
        assertTrue(rpc.commands.isEmpty())

        rpc.commandThrows = null
        edt { prompt().send() }
        waitUntil { rpc.commands.size == 1 }
        assertEquals(entry.id, rpc.commands.single().prompt.messageID)
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, entry.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
    }

    fun `test asynchronous initial command error restores draft without acknowledging transport success`() {
        workspaceRpc.state.value = workspaceRpc.state.value.copy(commands = listOf(CommandDto("review")))
        queue("/review changes")
        val manager = manager()
        edt { manager.start() }
        waitUntil { rpc.commands.size == 1 }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        emit(ChatEventDto.Error(rpc.session.id, MessageErrorDto("unknown", message = "not persisted")))

        assertEquals("/review changes", edt { prompt().text() })
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        edt { prompt().send() }
        waitUntil { rpc.commands.size == 2 }
        assertEquals(listOf(entry.id, entry.id), rpc.commands.map { it.prompt.messageID })
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, entry.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        assertEquals("", edt { prompt().text() })
    }

    fun `test restart reconciles persisted initial command message without replay`() {
        workspaceRpc.state.value = workspaceRpc.state.value.copy(commands = listOf(CommandDto("review")))
        queue("/review changes")
        val first = manager()
        edt { first.start() }
        waitUntil { rpc.commands.size == 1 }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        val xml = edt { XmlSerializer.serialize(service<PendingWorktreePrompt>().getState()) }
        edt {
            Disposer.dispose(first)
            service<PendingWorktreePrompt>().loadState(XmlSerializer.deserialize(xml, PendingWorktreePrompt.State::class.java))
        }
        rpc.history += MessageWithPartsDto(message(rpc.session.id, entry.id), emptyList())

        val reopened = manager()
        edt { reopened.start() }
        waitUntil { service<PendingWorktreePrompt>().peek(DIR) == null }
        assertEquals(entry.session, edt { reopened.currentKey() })
        assertEquals(1, rpc.commands.size)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test restart restores uncertain initial command without automatically repeating it`() {
        workspaceRpc.state.value = workspaceRpc.state.value.copy(commands = listOf(CommandDto("review")))
        queue("/review changes")
        val first = manager()
        edt { first.start() }
        waitUntil { rpc.commands.size == 1 }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        val xml = edt { XmlSerializer.serialize(service<PendingWorktreePrompt>().getState()) }
        edt {
            Disposer.dispose(first)
            service<PendingWorktreePrompt>().loadState(XmlSerializer.deserialize(xml, PendingWorktreePrompt.State::class.java))
        }

        val reopened = manager()
        edt { reopened.start() }
        waitUntil { ui.isNotEmpty() && prompt().text() == "/review changes" }
        assertEquals(1, rpc.commands.size)
        assertEquals(entry.session, edt { reopened.currentKey() })
        edt { prompt().send() }
        waitUntil { rpc.commands.size == 2 }
        assertEquals(listOf(entry.id, entry.id), rpc.commands.map { it.prompt.messageID })
    }

    fun `test restart restores uncertain send into its exact session without automatic replay`() {
        queue()
        val first = manager()
        edt { first.start() }
        waitUntil { rpc.prompts.size == 1 }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        val xml = edt { XmlSerializer.serialize(service<PendingWorktreePrompt>().getState()) }
        edt {
            Disposer.dispose(first)
            service<PendingWorktreePrompt>().loadState(XmlSerializer.deserialize(xml, PendingWorktreePrompt.State::class.java))
        }
        rpc.listed += rpc.session
        rpc.listed += session("ses_unrelated", updated = 100.0)

        val reopened = manager()
        edt { reopened.start() }
        waitUntil { ui.isNotEmpty() && prompt().text() == "initial prompt" }
        assertEquals(entry.session, edt { reopened.currentKey() })
        assertEquals(1, rpc.prompts.size)
        edt { reopened.start() }
        flush()
        assertEquals(1, rpc.prompts.size)

        edt {
            prompt().setText("edited explicit retry")
            prompt().send()
        }
        waitUntil { rpc.prompts.size == 2 }
        assertEquals(entry.id, rpc.prompts.last().third.messageID)
        assertEquals("edited explicit retry", edt { service<PendingWorktreePrompt>().peek(DIR)?.text })
        emit(ChatEventDto.MessageUpdated(rpc.session.id, message(rpc.session.id, entry.id)))
        assertNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
    }

    fun `test restart reconciles an already persisted initial message without sending again`() {
        queue()
        val first = manager()
        edt { first.start() }
        waitUntil { rpc.prompts.size == 1 }
        val entry = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        val xml = edt { XmlSerializer.serialize(service<PendingWorktreePrompt>().getState()) }
        edt {
            Disposer.dispose(first)
            service<PendingWorktreePrompt>().loadState(XmlSerializer.deserialize(xml, PendingWorktreePrompt.State::class.java))
        }
        rpc.history += MessageWithPartsDto(message(rpc.session.id, entry.id), emptyList())
        val reopened = manager()
        edt { reopened.start() }
        waitUntil { service<PendingWorktreePrompt>().peek(DIR) == null }
        assertEquals(entry.session, edt { reopened.currentKey() })
        assertEquals(1, rpc.prompts.size)
        edt { Disposer.dispose(reopened) }

        val again = manager()
        rpc.listed += rpc.session
        edt { again.start() }
        flush()
        assertEquals(1, rpc.prompts.size)
    }

    fun `test history load failure keeps initial prompt and does not send before reconciliation`() {
        queue()
        rpc.historyThrows = IllegalStateException("history unavailable")
        val manager = manager()
        edt { manager.start() }
        waitUntil { created.any { it.second != null } }
        flush()
        assertTrue(rpc.prompts.isEmpty())
        assertNotNull(edt { service<PendingWorktreePrompt>().peek(DIR) })
        edt { Disposer.dispose(manager) }

        rpc.historyThrows = null
        rpc.listed += rpc.session
        val reopened = manager()
        edt { reopened.start() }
        waitUntil { rpc.prompts.size == 1 }
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

    fun `test submit prompt sends into the session already on screen`() {
        val session = session("ses_1", updated = 1.0)
        val manager = manager()
        edt { manager.openSession(SessionRef.Local(session)) }
        flush()

        edt { manager.submitPrompt("update from base", "Update from main") }
        waitUntil { rpc.prompts.any { it.first == "ses_1" } }

        val sent = rpc.prompts.single { it.first == "ses_1" }
        assertEquals(DIR, sent.second)
        val part = sent.third.parts.single { it.text == "update from base" }
        assertEquals("Update from main", part.injectedTitle)
    }

    fun `test submit prompt while the editor starts is sent once the session opens`() {
        rpc.listed += session("ses_1", updated = 1.0)
        val manager = manager()

        edt { manager.submitPrompt("update from base", "Update from main") }
        edt { manager.start() }
        flush()

        waitUntil { rpc.prompts.any { it.first == "ses_1" } }
        assertTrue(rpc.prompts.single { it.first == "ses_1" }.third.parts.any { it.text == "update from base" })
    }

    fun `test the project base update service finds the open worktree editor`() {
        val session = session("ses_1", updated = 1.0)
        val manager = manager()
        edt { manager.openSession(SessionRef.Local(session)) }
        flush()

        val sent = edt { project.service<WorktreeBaseUpdatePrompts>().submit(DIR, "update from base", "Update from main") }
        waitUntil { rpc.prompts.any { it.first == "ses_1" } }

        assertTrue("the project service must see the editor's registration", sent)
        assertTrue(rpc.prompts.single { it.first == "ses_1" }.third.parts.any { it.text == "update from base" })
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
        val gate = CompletableDeferred<Unit>()
        rpc.deleteGate = gate
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
        assertEquals(setOf(first.id), edt { manager.deleting() })
        gate.complete(Unit)
        waitUntil { manager.deleting().isEmpty() }
        assertEquals(listOf(first.id to DIR), rpc.deletes.toList())
        assertTrue(notified.toString(), notified.isEmpty())
    }

    fun `test deleting pending prompt session releases binding into the replacement as explicit draft`() {
        val gate = CompletableDeferred<Unit>()
        rpc.deleteGate = gate
        val first = session("ses_first", updated = 3.0)
        val second = session("ses_second", updated = 2.0)
        rpc.listed += first
        rpc.listed += second
        val entry = bound(first.id)
        val manager = manager(session = first.id)
        edt { manager.start() }
        flush()

        edt { manager.deleteSessions(listOf(first.id)) }
        flush()

        assertEquals(second.id, edt { manager.currentKey() })
        assertEquals(first.id, edt { service<PendingWorktreePrompt>().peek(DIR)?.session })
        gate.complete(Unit)
        flush()

        val recovered = edt { requireNotNull(service<PendingWorktreePrompt>().peek(DIR)) }
        assertEquals(second.id, recovered.session)
        assertEquals(entry.prompt, recovered.prompt)
        assertFalse(entry.id == recovered.id)
        assertTrue(recovered.attempted)
        assertEquals(entry.text, edt { prompt().text() })
        assertEquals(0, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
        assertEquals(listOf(first.id to DIR), rpc.deletes)

        edt { manager.start() }
        flush()

        assertEquals(second.id, edt { manager.currentKey() })
        assertEquals(listOf(DIR to first.id, DIR to second.id), created)
        assertTrue(rpc.prompts.isEmpty())
    }

    fun `test deleting only prompt session recovers in newly created session without resend`() {
        val gate = CompletableDeferred<Unit>()
        rpc.deleteGate = gate
        val first = session("ses_first", updated = 1.0)
        rpc.listed += first
        val entry = bound(first.id)
        val manager = manager()
        edt { manager.start() }
        flush()
        rpc.session = session("ses_recovery", updated = 2.0)

        edt { manager.deleteSessions(listOf(first.id)) }
        flush()

        assertEquals(rpc.session.id, edt { manager.currentKey() })
        assertEquals(first.id, edt { service<PendingWorktreePrompt>().peek(DIR)?.session })
        gate.complete(Unit)
        flush()

        assertEquals(listOf(DIR to first.id, DIR to rpc.session.id), created)
        assertEquals(rpc.session.id, edt { service<PendingWorktreePrompt>().peek(DIR)?.session })
        assertEquals(entry.prompt, edt { service<PendingWorktreePrompt>().peek(DIR)?.prompt })
        assertEquals(entry.text, edt { prompt().text() })
        assertEquals(1, rpc.creates)
        assertTrue(rpc.prompts.isEmpty())
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

    fun `test fork opens the forked session and lists it alongside the source`() {
        val session = session("ses_1", updated = 1.0)
        rpc.listed += session
        val controller = WorktreeSessionListController(sessions, DIR, coroutines.scope, telemetry = { _, _ -> })
        val manager = manager(controller = controller)
        edt { manager.start() }
        flush()

        edt { manager.forkSession(session.id) }
        flush()

        assertEquals(FakeSessionRpcApi.ForkCall(session.id, DIR, null), rpc.forks.single())
        assertEquals(listOf(DIR to session.id, DIR to "ses_1_fork"), created)
        assertEquals("ses_1_fork", edt { manager.currentKey() })
        assertEquals(listOf("ses_1_fork", session.id), edt { controller.sessions().map { it.id } })
        assertTrue(notified.isEmpty())
    }

    fun `test fork forwards the message id for a per-message fork`() {
        val session = session("ses_1", updated = 1.0)
        rpc.listed += session
        val manager = manager()
        edt { manager.start() }
        flush()

        edt { manager.forkSession(session.id, "msg_3") }
        flush()

        assertEquals(FakeSessionRpcApi.ForkCall(session.id, DIR, "msg_3"), rpc.forks.single())
    }

    fun `test a second fork of the same session is ignored while the first is in flight`() {
        val session = session("ses_1", updated = 1.0)
        rpc.listed += session
        val gate = CompletableDeferred<Unit>()
        rpc.forkGate = gate
        val manager = manager()
        edt { manager.start() }
        flush()

        // A hover icon or menu item is easy to hit twice before the RPC answers.
        edt { manager.forkSession(session.id) }
        // The first fork's RPC is recorded on the background dispatcher, so pump() alone can return
        // before it lands. Wait for the in-flight call before firing the duplicate.
        waitUntil { rpc.forks.size == 1 }
        edt { manager.forkSession(session.id) }
        flush()

        assertEquals(1, rpc.forks.size)

        gate.complete(Unit)
        waitUntil { rpc.forks.size == 1 && created.any { it.second == "ses_1_fork" } }

        // Once the first settles the latch is released, so a later fork is allowed again.
        edt { manager.forkSession(session.id) }
        flush()
        assertEquals(2, rpc.forks.size)
    }

    fun `test fork failure notifies and keeps the current session shown`() {
        val session = session("ses_1", updated = 1.0)
        rpc.listed += session
        rpc.forkThrows = IllegalStateException("fork unavailable")
        val manager = manager()
        edt { manager.start() }
        flush()

        edt { manager.forkSession(session.id) }
        flush()

        assertEquals(session.id, edt { manager.currentKey() })
        assertEquals(listOf("Failed to fork session \"Session ses_1\"" to "fork unavailable"), notified)
    }

    fun `test fork ignores the pending new row and a session being deleted`() {
        val session = session("ses_1", updated = 1.0)
        rpc.listed += session
        val gate = CompletableDeferred<Unit>()
        rpc.deleteGate = gate
        val manager = manager()
        edt { manager.start() }
        flush()

        edt { manager.forkSession(SessionHost.NEW) }
        edt { manager.deleteSessions(listOf(session.id)) }
        pump()
        edt { manager.forkSession(session.id) }
        flush()

        assertTrue(rpc.forks.isEmpty())
        gate.complete(Unit)
        waitUntil { manager.deleting().isEmpty() }
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

    fun `test base defaults to false until resolved`() {
        val manager = manager(resolveBase = { false })

        assertFalse(edt { manager.base() })
        assertFalse(edt { manager.showsBranchDock })
        assertFalse(edt { manager.supportsMoveToWorktree })
        assertFalse(edt { manager.supportsNewWorktree })
    }

    fun `test base editor enables the branch dock and worktree flows once resolved`() {
        val manager = manager(resolveBase = { true })

        edt { manager.start() }
        flush()

        assertTrue(edt { manager.base() })
        assertTrue(edt { manager.showsBranchDock })
        assertTrue(edt { manager.supportsMoveToWorktree })
        assertTrue(edt { manager.supportsNewWorktree })
    }

    fun `test a linked worktree tab keeps the dock and worktree flows off`() {
        val manager = manager(resolveBase = { false })

        edt { manager.start() }
        flush()

        assertFalse(edt { manager.base() })
        assertFalse(edt { manager.showsBranchDock })
        assertFalse(edt { manager.supportsMoveToWorktree })
        assertFalse(edt { manager.supportsNewWorktree })
    }

    fun `test base is resolved only once across repeated start calls`() {
        var calls = 0
        val manager = manager(resolveBase = { calls++; true })

        edt { manager.start() }
        flush()
        edt { manager.start() }
        flush()

        assertEquals(1, calls)
        assertTrue(edt { manager.base() })
    }

    fun `test a start during the lookup neither repeats it nor opens a second session`() {
        rpc.listed += session("ses_1", updated = 1.0)
        var calls = 0
        val gate = CompletableDeferred<Unit>()
        val manager = manager(resolveBase = { calls++; gate.await(); true })

        edt { manager.start() }
        flush()
        // The migration path calls start() again, and a tab shown twice can too, both while the lookup
        // is still out.
        edt { manager.start() }
        flush()
        gate.complete(Unit)
        flush()

        assertEquals(1, calls)
        assertEquals(listOf(DIR to "ses_1"), created)
        assertTrue(edt { manager.base() })
    }

    fun `test a lookup that lands after disposal opens nothing`() {
        rpc.listed += session("ses_1", updated = 1.0)
        val gate = CompletableDeferred<Unit>()
        val manager = manager(resolveBase = { gate.await(); true })

        edt { manager.start() }
        flush()
        edt { Disposer.dispose(manager) }
        gate.complete(Unit)
        flush()

        assertTrue("no session may open for a disposed editor, opened $created", created.isEmpty())
        assertFalse(edt { manager.base() })
    }

    fun `test the first session still opens once base resolution settles`() {
        rpc.listed += session("ses_old", updated = 1.0)
        rpc.listed += session("ses_new", updated = 3.0)
        val manager = manager(resolveBase = { true })

        edt { manager.start() }
        flush()

        assertEquals(listOf(DIR to "ses_new"), created)
    }

    fun `test move to worktree delegates to the injected host only from the base editor`() {
        val session = session("ses_1", updated = 1.0)
        val base = manager(resolveBase = { true })
        edt { base.start() }
        flush()

        edt { base.moveToWorktree(session.id, DIR) }

        assertEquals(listOf(Triple(session.id, DIR, "worktree_editor")), movedTo)
    }

    fun `test move to worktree is a no-op from a linked worktree tab`() {
        val session = session("ses_1", updated = 1.0)
        val worktree = manager(resolveBase = { false })
        edt { worktree.start() }
        flush()

        edt { worktree.moveToWorktree(session.id, DIR) }

        assertTrue(movedTo.isEmpty())
    }

    fun `test new worktree delegates to the injected host only from the base editor`() {
        val base = manager(resolveBase = { true })
        edt { base.start() }
        flush()

        edt { base.newWorktree() }

        assertEquals(1, newWorktreeCalls)
    }

    fun `test new worktree is a no-op from a linked worktree tab`() {
        val worktree = manager(resolveBase = { false })
        edt { worktree.start() }
        flush()

        edt { worktree.newWorktree() }

        assertEquals(0, newWorktreeCalls)
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
        // Real hosts resolve this from KiloWorktreeService.list(dir); tests answer instantly and never
        // touch the platform RPC layer, matching every other seam this manager already accepts.
        resolveBase: suspend (String) -> Boolean = { false },
        moveHost: (String?, String, String) -> Unit = { id, dir, surface -> movedTo += Triple(id, dir, surface) },
        newWorktreeHost: () -> Unit = { newWorktreeCalls++ },
        open: () -> Unit = {},
        session: String? = null,
    ): WorktreeSessionEditorManager {
        return WorktreeSessionEditorManager(
            parent = testRootDisposable,
            project = project,
            worktree = workspace,
            list = controller,
            session = session,
            del = del,
            create = { project, workspace, owner, ref, timers ->
                open()
                val id = when (ref) {
                    is SessionRef.Local -> ref.id
                    is SessionRef.Cloud -> ref.key
                    is SessionRef.Hosted -> ref.key
                    null -> null
                }
                created.add(workspace.directory to id)
                SessionUi(
                    project,
                    workspace,
                    sessions,
                    app,
                    SessionUiFactory(coroutines.scope).scope(),
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
            resolveBase = resolveBase,
            moveHost = moveHost,
            newWorktreeHost = newWorktreeHost,
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

    private fun queue(text: String = "initial prompt") = edt { service<PendingWorktreePrompt>().put(DIR, DIR, PendingPrompt(text)) }

    private fun bound(
        id: String,
        payload: PendingPrompt = PendingPrompt("initial prompt"),
        attempted: Boolean = true,
    ) = edt {
        val store = service<PendingWorktreePrompt>()
        store.put(DIR, DIR, payload)
        val entry = requireNotNull(store.claim(DIR, id, testRootDisposable))
        if (attempted) store.attempted(entry.id, entry.text)
        store.loadState(store.getState())
        requireNotNull(store.peek(DIR))
    }

    private fun missing(gone: String, sent: CompletableDeferred<Unit>? = null) {
        rpc.missing += gone
        val api = object : KiloSessionRpcApi by rpc {
            override suspend fun prompt(id: String, directory: String, prompt: PromptDto) {
                rpc.prompt(id, directory, prompt)
                sent?.complete(Unit)
            }
        }
        sessions = KiloSessionService(project, coroutines.scope, api)
    }

    private fun await(signal: CompletableDeferred<Unit>) {
        val deadline = System.nanoTime() + TEST_WAIT_MS * 1_000_000
        while (!signal.isCompleted && System.nanoTime() < deadline) {
            flush()
            Thread.yield()
        }
        assertTrue("prompt RPC never completed; created=$created, prompts=${rpc.prompts}", signal.isCompleted)
        flush()
    }

    private fun prompt(): PromptPanel {
        fun find(root: Container): PromptPanel? {
            if (root is PromptPanel) return root
            return root.components.filterIsInstance<Container>().firstNotNullOfOrNull(::find)
        }
        return requireNotNull(find(ui.last()))
    }

    private fun message(session: String, id: String) = MessageDto(id, session, "user", MessageTimeDto(0.0))

    private fun emit(event: ChatEventDto) {
        assertTrue(rpc.events.tryEmit(event))
        flush()
        edt {
            ui.forEach {
                val field = SessionUi::class.java.getDeclaredField("controller").apply { isAccessible = true }
                (field.get(it) as SessionController).flushEvents()
            }
        }
        flush()
    }

    private fun waitUntil(block: () -> Boolean) {
        val done = coroutines.pumpUntil { edt(block) }
        assertTrue("created=$created, deletes=${rpc.deletes}, notified=$notified", done)
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
