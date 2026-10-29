package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.EditorContextDto
import ai.kilocode.rpc.dto.PartSourceDto
import ai.kilocode.rpc.dto.PartSourceTextDto
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.PromptPartDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
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
    private val prompt = PromptDto(
        parts = listOf(PromptPartDto("text", text = "Explain this project")),
        providerID = "kilo",
        modelID = "kilo-auto/free",
        agent = "code",
    )

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
        val events = launch { api.events(session, ref.key).collect {} }
        assertTrue(mock.awaitFeed("/event?workspace=wrk_att_test"))

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
        events.cancelAndJoin()
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_test", 1))
        assertTrue(app.hosted.statuses.value[session] == null)
    }

    @Test
    fun `hosted prompt and abort use the attachment selector`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())

        api.prompt(session, ref.key, prompt)
        api.abort(session, ref.key)

        assertTrue(mock.lastHostedPromptPath.orEmpty().contains("/session/ses_cloud/prompt_async?"))
        assertTrue(mock.lastHostedPromptPath.orEmpty().contains("workspace=wrk_att_test"))
        val body = Json.parseToJsonElement(assertNotNull(mock.lastHostedPromptBody)).jsonObject
        assertEquals(setOf("parts", "model", "agent"), body.keys)
        assertEquals(
            Json.parseToJsonElement("""{"parts":[{"type":"text","text":"Explain this project"}],"model":{"providerID":"kilo","modelID":"kilo-auto/free"},"agent":"code"}"""),
            body,
        )
        assertEquals("/session/ses_cloud/abort?workspace=wrk_att_test", mock.paths.lastOrNull { it.startsWith("/session/ses_cloud/abort") })
    }

    @Test
    fun `hosted input rejects rich fields and invalid identifiers before attachment`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())
        val part = prompt.parts.single()
        val cases = listOf(
            "editor context" to prompt.copy(editorContext = EditorContextDto(shell = "/bin/zsh")),
            "empty editor context" to prompt.copy(editorContext = EditorContextDto()),
            "variant" to prompt.copy(variant = "high"),
            "empty variant" to prompt.copy(variant = ""),
            "noReply true" to prompt.copy(noReply = true),
            "noReply false" to prompt.copy(noReply = false),
            "file" to prompt.copy(parts = listOf(PromptPartDto("file", mime = "text/plain", url = "file:///project/main.kt"))),
            "mixed parts" to prompt.copy(parts = listOf(part, PromptPartDto("file", url = "data:text/plain,hello"))),
            "unknown part" to prompt.copy(parts = listOf(PromptPartDto("agent", text = "code"))),
            "missing text" to prompt.copy(parts = listOf(PromptPartDto("text"))),
            "synthetic true" to prompt.copy(parts = listOf(part.copy(synthetic = true))),
            "synthetic false" to prompt.copy(parts = listOf(part.copy(synthetic = false))),
            "source" to prompt.copy(parts = listOf(part.copy(source = PartSourceDto("file", PartSourceTextDto("@main.kt", 0.0, 8.0), path = "main.kt")))),
            "url" to prompt.copy(parts = listOf(part.copy(url = "file:///project/main.kt"))),
            "mime" to prompt.copy(parts = listOf(part.copy(mime = "text/plain"))),
            "filename" to prompt.copy(parts = listOf(part.copy(filename = "main.kt"))),
            "provider" to prompt.copy(providerID = "anthropic"),
            "missing provider" to prompt.copy(providerID = null),
            "missing model" to prompt.copy(modelID = null),
            "empty model" to prompt.copy(modelID = ""),
            "model syntax" to prompt.copy(modelID = "model with spaces"),
            "model length" to prompt.copy(modelID = "a".repeat(256)),
            "empty agent" to prompt.copy(agent = ""),
            "agent syntax" to prompt.copy(agent = "Code"),
            "agent length" to prompt.copy(agent = "a".repeat(51)),
            "message ID" to prompt.copy(messageID = "msg_1"),
            "message timestamp" to prompt.copy(messageID = "msg_ABCDEF000001AbCdEfGhIjKlMn"),
            "message suffix" to prompt.copy(messageID = "msg_000000000001AbCdEfGhIjKlM_"),
        )
        for ((name, input) in cases) {
            assertFailsWith<IllegalArgumentException>(name) { api.prompt(session, ref.key, input) }
            assertFailsWith<IllegalArgumentException>(name) { api.command(session, ref.key, "review", "changes", input) }
            assertEquals(0, mock.requestCount("/kilocode/session-host/session/cloud/ses_cloud/attach"), name)
            assertEquals(0, mock.requestCount("/session/ses_cloud/prompt_async"), name)
            assertEquals(0, mock.requestCount("/session/ses_cloud/command"), name)
        }
    }

    @Test
    fun `hosted prompt rejects empty and oversized text before attachment`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())
        val cases = listOf(
            prompt.copy(parts = emptyList()),
            prompt.copy(parts = listOf(PromptPartDto("text", text = ""))),
            prompt.copy(parts = listOf(PromptPartDto("text", text = "a".repeat(50_001)), PromptPartDto("text", text = "b".repeat(50_000)))),
        )
        for (input in cases) {
            assertFailsWith<IllegalArgumentException> { api.prompt(session, ref.key, input) }
        }
        assertEquals(0, mock.requestCount("/kilocode/session-host/session/cloud/ses_cloud/attach"))
        assertEquals(0, mock.requestCount("/session/ses_cloud/prompt_async"))
    }

    @Test
    fun `hosted prompt preserves canonical message IDs and optional selectors`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())
        api.prompt(session, ref.key, prompt.copy(
            parts = listOf(PromptPartDto("text", text = ""), PromptPartDto("text", text = "hello")),
            messageID = "msg_000000000001AbCdEfGhIjKlMn",
            modelID = "org/model-v1.2_3:free~latest",
            agent = "custom-agent-1",
        ))
        assertEquals(
            Json.parseToJsonElement("""{"parts":[{"type":"text","text":""},{"type":"text","text":"hello"}],"messageID":"msg_000000000001AbCdEfGhIjKlMn","model":{"providerID":"kilo","modelID":"org/model-v1.2_3:free~latest"},"agent":"custom-agent-1"}"""),
            Json.parseToJsonElement(assertNotNull(mock.lastHostedPromptBody)),
        )
        api.prompt(session, ref.key, PromptDto(parts = listOf(PromptPartDto("text", text = "hello"))))
        assertEquals(setOf("parts"), Json.parseToJsonElement(assertNotNull(mock.lastHostedPromptBody)).jsonObject.keys)
    }

    @Test
    fun `hosted text commands preserve selectors and contain only Cloud command keys`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())
        api.command(session, ref.key, "review", "current changes", prompt.copy(messageID = "msg_000000000001AbCdEfGhIjKlMn"))
        assertEquals("/session/ses_cloud/command?workspace=wrk_att_test", mock.lastHostedCommandPath)
        assertEquals(
            Json.parseToJsonElement("""{"command":"review","arguments":"current changes","agent":"code","model":"kilo/kilo-auto/free","messageID":"msg_000000000001AbCdEfGhIjKlMn"}"""),
            Json.parseToJsonElement(assertNotNull(mock.lastHostedCommandBody)),
        )
        api.command(session, ref.key, "review", "", PromptDto(parts = emptyList()))
        assertEquals(
            Json.parseToJsonElement("""{"command":"review","arguments":""}"""),
            Json.parseToJsonElement(assertNotNull(mock.lastHostedCommandBody)),
        )
        assertEquals(2, mock.requestCount("/kilocode/session-host/session/cloud/ses_cloud/attach"))
    }

    @Test
    fun `hosted commands reject oversized selectors and arguments before attachment`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())
        assertFailsWith<IllegalArgumentException> { api.command(session, ref.key, "", "", prompt) }
        assertFailsWith<IllegalArgumentException> { api.command(session, ref.key, "a".repeat(257), "", prompt) }
        assertFailsWith<IllegalArgumentException> { api.command(session, ref.key, "review", "a".repeat(10_001), prompt) }
        assertFailsWith<IllegalArgumentException> { api.command(session, ref.key, "review", "", prompt.copy(modelID = "a".repeat(252))) }
        assertEquals(0, mock.requestCount("/kilocode/session-host/session/cloud/ses_cloud/attach"))
        assertEquals(0, mock.requestCount("/session/ses_cloud/command"))
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
        val events = launch { api.events(session, ref.key).collect {} }
        assertTrue(mock.awaitFeed("/event?workspace=wrk_att_test"))

        api.messages(session, ref.key)
        val pending = api.pendingPermissions(ref.key)

        assertEquals(session, pending.single().sessionID)
        assertTrue(mock.paths.any { it.contains("/permission?workspace=wrk_att_test") })
        events.cancelAndJoin()
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

        withTimeout(5_000) { app.chat.subscriptionCount.first { it > 0 } }
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
    fun `hosted permission rules are ignored so the reply can continue`() = runBlocking(Dispatchers.Default) {
        val app = app(TestLog())
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())

        api.savePermissionRules("per_1", ref.key, PermissionAlwaysRulesDto(approvedAlways = listOf("pwd")))

        assertEquals(0, mock.requestCount("/permission/per_1/always-rules"))
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
