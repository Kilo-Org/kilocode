package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking

/**
 * Base class for [SessionController] tests.
 *
 * Provides real IntelliJ Application/EDT/Disposer via [BasePlatformTestCase],
 * real frontend services wired to fake RPC backends, and shared helpers.
 */
abstract class SessionControllerTestBase : BasePlatformTestCase() {

    protected lateinit var rpc: FakeSessionRpcApi
    protected lateinit var appRpc: FakeAppRpcApi
    protected lateinit var projectRpc: FakeWorkspaceRpcApi

    protected lateinit var sessions: KiloSessionService
    protected lateinit var app: KiloAppService
    protected lateinit var workspaces: KiloWorkspaceService
    protected lateinit var workspace: Workspace

    protected lateinit var scope: CoroutineScope
    protected lateinit var parent: Disposable

    override fun setUp() {
        super.setUp()
        rpc = FakeSessionRpcApi()
        appRpc = FakeAppRpcApi()
        projectRpc = FakeWorkspaceRpcApi()

        scope = CoroutineScope(SupervisorJob())
        parent = Disposer.newDisposable("test")

        sessions = KiloSessionService(project, scope, rpc)
        app = KiloAppService(scope, appRpc)
        workspaces = KiloWorkspaceService(scope, projectRpc)
        workspace = workspaces.workspace("/test")
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    // ------ Controller creation ------

    protected fun controller(id: String? = null) =
        SessionController(parent, id, sessions, workspace, app, scope)

    // ------ Event collection ------

    /** Attach a listener that collects lifecycle events and asserts EDT. */
    protected fun collect(m: SessionController): MutableList<SessionControllerEvent> {
        val events = mutableListOf<SessionControllerEvent>()
        val disposable = Disposer.newDisposable("listener")
        Disposer.register(parent, disposable)
        m.addListener(disposable) { event ->
            assertTrue("Listener must be called on EDT", ApplicationManager.getApplication().isDispatchThread)
            events.add(event)
        }
        return events
    }

    /** Attach a listener that collects model events (messages, parts, phase). */
    protected fun collectModelEvents(m: SessionController): MutableList<SessionModelEvent> {
        val events = mutableListOf<SessionModelEvent>()
        val disposable = Disposer.newDisposable("model-listener")
        Disposer.register(parent, disposable)
        m.model.addListener(disposable) { event ->
            events.add(event)
        }
        return events
    }

    // ------ EDT + coroutine helpers ------

    /** Let coroutines settle, then drain all pending EDT events. */
    protected fun flush() = runBlocking {
        repeat(5) {
            delay(100)
            edt { UIUtil.dispatchAllInvocationEvents() }
        }
    }

    protected fun edt(block: () -> Unit) {
        ApplicationManager.getApplication().invokeAndWait(block)
    }

    /** Emit a chat event into the fake RPC flow. */
    protected fun emit(event: ChatEventDto, flush: Boolean = true) {
        runBlocking { rpc.events.emit(event) }
        if (flush) flush()
    }

    /** Create a controller, attach both listeners, send initial prompt, and flush. */
    protected fun prompted(): Triple<SessionController, MutableList<SessionControllerEvent>, MutableList<SessionModelEvent>> {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady()
        val m = controller()
        val events = collect(m)
        val modelEvents = collectModelEvents(m)
        flush()
        edt { m.prompt("go") }
        flush()
        return Triple(m, events, modelEvents)
    }

    protected fun assertModel(expected: String, model: SessionModel) {
        assertEquals(expected.trimIndent().trim(), model.toString().trim())
    }

    protected fun assertModel(expected: String, c: SessionController) {
        assertModel(expected, c.model)
    }

    protected fun assertSession(expected: String, c: SessionController, show: Boolean = true) {
        assertEquals(expected.trimIndent().trim(), c.toString().trim())
        assertEquals(show, c.model.showMessages)
    }

    protected fun assertControllerEvents(expected: String, events: List<SessionControllerEvent>) {
        assertEquals(expected.trimIndent().trim(), events.joinToString("\n"))
    }

    protected fun assertModelEvents(expected: String, events: List<SessionModelEvent>) {
        assertEquals(expected.trimIndent().trim(), events.joinToString("\n"))
    }

    // ------ DTO factories ------

    protected fun msg(id: String, sid: String, role: String) = MessageDto(
        id = id,
        sessionID = sid,
        role = role,
        time = MessageTimeDto(created = 0.0),
    )

    protected fun part(
        id: String,
        sid: String,
        mid: String,
        type: String,
        text: String? = null,
        tool: String? = null,
    ) = PartDto(
        id = id,
        sessionID = sid,
        messageID = mid,
        type = type,
        text = text,
        tool = tool,
    )

    protected fun workspaceReady(
        agents: List<AgentDto> = listOf(AgentDto(name = "code", displayName = "Code", mode = "code")),
        default: String = "code",
        providers: List<ProviderDto> = listOf(
            ProviderDto(
                id = "kilo",
                name = "Kilo",
                models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5")),
            ),
        ),
        connected: List<String> = listOf("kilo"),
        defaults: Map<String, String> = mapOf("kilo" to "gpt-5"),
    ) = KiloWorkspaceStateDto(
        status = KiloWorkspaceStatusDto.READY,
        agents = AgentsDto(agents = agents, all = agents, default = default),
        providers = ProvidersDto(providers = providers, connected = connected, defaults = defaults),
    )
}
