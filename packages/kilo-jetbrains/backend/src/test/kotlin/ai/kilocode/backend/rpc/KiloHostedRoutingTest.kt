package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class KiloHostedRoutingTest {
    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()
    private val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
    private val session = HostedIDs.session("cloud", "wrk_1", "ses_cloud")

    @AfterTest
    fun tearDown() = runBlocking {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
    }

    private fun app(log: TestLog): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }

    private suspend fun ready(app: KiloBackendAppService) {
        app.connect()
        withTimeout(10_000) { app.appState.first { it is KiloAppState.Ready } }
    }

    @Test
    fun `hosted session messages attach once and remap native ids`() = runBlocking(Dispatchers.Default) {
        mock.hostedMessages = """[{"info":{"id":"msg_1","sessionID":"ses_cloud","role":"user","time":{"created":1.0}},"parts":[{"id":"prt_1","sessionID":"ses_cloud","messageID":"msg_1","type":"text","text":"hello"}]}]"""
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())

        val items = api.messages(session, ref.key)
        val again = api.messages(session, ref.key)

        assertEquals(session, items.single().info.sessionID)
        assertEquals(session, items.single().parts.single().sessionID)
        assertEquals(1, items.size)
        assertEquals(session, again.single().info.sessionID)
        assertTrue(mock.lastHostedAttachPath.orEmpty().contains("/kilocode/session-host/session/cloud/ses_cloud/attach"))
        assertTrue(mock.lastHostedMessagePath.orEmpty().contains("/session/ses_cloud/message?"))
        assertTrue(mock.lastHostedMessagePath.orEmpty().contains("workspace=wrk_att_test"))
        // A second read reuses the live attachment instead of minting another one.
        assertEquals(1, mock.requestCount("/kilocode/session-host/session/cloud/ses_cloud/attach"))
    }

    @Test
    fun `hosted prompt and abort use the attachment selector`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())

        api.prompt(session, ref.key, ai.kilocode.rpc.dto.PromptDto(parts = emptyList()))
        api.abort(session, ref.key)

        assertTrue(mock.lastHostedPromptPath.orEmpty().contains("/session/ses_cloud/prompt_async?"))
        assertTrue(mock.lastHostedPromptPath.orEmpty().contains("workspace=wrk_att_test"))
        assertEquals("/session/ses_cloud/abort?workspace=wrk_att_test", mock.paths.lastOrNull { it.startsWith("/session/ses_cloud/abort") })
    }

    @Test
    fun `hosted session reads the workspace title without a local session`() = runBlocking(Dispatchers.Default) {
        mock.hostedWorkspace = """{"id":{"providerID":"cloud","workspaceID":"wrk_1"},"name":"Cloud Workspace","repository":{"provider":"github","url":"https://github.com/Kilo-Org/kilocode","branch":"main"},"deletionState":"active","created":1.0,"updated":2.0,"lastActivity":3.0,"sessions":[{"id":{"providerID":"cloud","workspaceID":"wrk_1","sessionID":"ses_cloud"},"title":"Cloud one","createdOnPlatform":"cloud","created":10.0,"updated":20.0}]}"""
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())

        val loaded = api.get(session, ref.key)

        assertEquals(session, loaded.id)
        assertEquals(ref.key, loaded.directory)
        assertEquals("Cloud one", loaded.title)
        assertEquals("cloud", loaded.version)
    }

    @Test
    fun `hosted pending permissions are remapped and scoped to the attachment`() = runBlocking(Dispatchers.Default) {
        mock.pendingPermissions = """[{"id":"per_1","sessionID":"ses_cloud","permission":"bash","patterns":[]}]"""
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())

        api.messages(session, ref.key)
        val pending = api.pendingPermissions(ref.key)

        assertEquals(session, pending.single().sessionID)
        assertTrue(mock.paths.any { it.contains("/permission?workspace=wrk_att_test") })
    }

    @Test
    fun `hosted sessions reject local-only operations`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())

        assertFailsWith<UnsupportedOperationException> { api.fork(session, ref.key, null) }
        assertFailsWith<UnsupportedOperationException> { api.delete(session, ref.key) }
        assertFailsWith<UnsupportedOperationException> { api.share(session, ref.key) }
        assertFailsWith<UnsupportedOperationException> { api.compact(session, ref.key, ai.kilocode.rpc.dto.ModelSelectionDto("", "")) }
        assertFailsWith<UnsupportedOperationException> { api.create(ref.key) }
    }

    @Test
    fun `hosted status merges with local statuses`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())

        app.chat.publish(
            ai.kilocode.rpc.dto.ChatEventDto.SessionStatusChanged(
                session,
                ai.kilocode.rpc.dto.SessionStatusDto("busy"),
            ),
        )

        val statuses = withTimeout(5_000) { api.statuses().first { it[session] != null } }
        assertEquals("busy", statuses[session]?.type)
        assertNotNull(HostedWorkspaceRefDto.parse(ref.key))
    }

    @Test
    fun `hosted ids keep colliding native ids isolated`() {
        val other = HostedIDs.session("cloud", "wrk_2", "ses_cloud")
        assertEquals("hosted:cloud:wrk_1:ses_cloud", session)
        assertEquals("hosted:cloud:wrk_2:ses_cloud", other)
        assertTrue(session != other)
        assertEquals(Triple("cloud", "wrk_1", "ses_cloud"), HostedIDs.parseSession(session))
        assertEquals("cloud" to "wrk_1", HostedIDs.parseWorkspace(ref.key))
    }
}
