package ai.kilocode.client.session.model

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.ChatEventDto
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
 * Base class for [SessionModel] tests.
 *
 * Provides real IntelliJ Application/EDT/Disposer via [BasePlatformTestCase],
 * real frontend services wired to fake RPC backends, and shared helpers.
 */
abstract class SessionModelTestBase : BasePlatformTestCase() {

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

    // ------ Model creation ------

    protected fun model(id: String? = null) =
        SessionModel(parent, id, sessions, workspace, app, scope)

    // ------ Event collection ------

    /** Attach a listener that collects events and asserts EDT. */
    protected fun collect(m: SessionModel): MutableList<SessionEvent> {
        val events = mutableListOf<SessionEvent>()
        val disposable = Disposer.newDisposable("listener")
        Disposer.register(parent, disposable)
        m.addListener(disposable) { event ->
            assertTrue("Listener must be called on EDT", ApplicationManager.getApplication().isDispatchThread)
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
    protected fun emit(event: ChatEventDto) = runBlocking {
        rpc.events.emit(event)
    }

    /** Create a model, attach listener, send initial prompt, and flush. */
    protected fun prompted(): Pair<SessionModel, MutableList<SessionEvent>> {
        val m = model()
        val events = collect(m)
        edt { m.prompt("go") }
        flush()
        return m to events
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
