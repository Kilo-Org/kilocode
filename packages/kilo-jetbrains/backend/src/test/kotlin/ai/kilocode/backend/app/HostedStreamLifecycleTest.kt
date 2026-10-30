package ai.kilocode.backend.app

import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.backend.cli.KiloBackendHttpClients
import ai.kilocode.backend.rpc.KiloSessionRpcApiImpl
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CountDownLatch
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class HostedStreamLifecycleTest {
    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val app = KiloBackendAppService.create(scope, FakeCliServer(mock), TestLog())
    private val session = HostedIDs.session("cloud", "wrk_1", "ses_cloud")
    private val events = Channel<ChatEventDto>(Channel.UNLIMITED)
    private val path = "/event?workspace=wrk_att_test"
    private val system = "/cloud-agent/event?workspace=wrk_att_test"
    private val attach = "/kilocode/session-host/session/cloud/ses_cloud/attach"

    @AfterTest
    fun cleanup() {
        mock.statusGate?.countDown()
        app.dispose()
        scope.cancel()
        mock.close()
    }

    private suspend fun ready() {
        app.connect()
        withTimeout(TIMEOUT) { app.appState.first { it is KiloAppState.Ready } }
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.chat.events.collect { events.send(it) }
        }
    }

    private suspend fun next(
        source: Channel<ChatEventDto> = events,
        predicate: (ChatEventDto) -> Boolean,
    ): ChatEventDto = withTimeout(TIMEOUT) {
        while (true) {
            val event = source.receive()
            if (predicate(event)) return@withTimeout event
        }
        error("unreachable")
    }

    private suspend fun open() {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.hosted.systemEvents(HostedWorkspaceRefDto("cloud", "wrk_1"), "ses_cloud", null).collect {}
        }
        app.hosted.retain(session, null)
        app.hosted.messages(session, null)
        assertTrue(mock.awaitFeed(path), "native stream did not open")
        assertTrue(mock.awaitFeed(system), "system stream did not open")
        next { it is ChatEventDto.Resnapshot && it.phase == "start" }
    }

    private fun fence(path: String = this.path, generation: Int = 1) {
        mock.pushFeed(path, """{"type":"kilo.native.fence","properties":{"fence":3,"generation":$generation,"snapshotComplete":true}}""")
    }

    @Test
    fun `expired provider descriptor resnapshots same opaque attachment and delivers terminal without external read`() = runBlocking(Dispatchers.Default) {
        mock.hostedAttach = """{"attachmentID":"wrk_att_test","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
        mock.sessionStatuses = """{"ses_cloud":{"type":"busy"}}"""
        ready()
        open()
        fence()
        next { it is ChatEventDto.Resnapshot && it.phase == "complete" }
        mock.pushFeed(path, """{"type":"kilo.native.resnapshot","properties":{"reason":"continuity_unproven"}}""")
        assertTrue(mock.awaitFeed(path, 2))
        next { it is ChatEventDto.Resnapshot && it.phase == "start" }
        mock.pushFeed(path, """{"type":"message.part.updated","properties":{"sessionID":"ses_cloud","part":{"id":"prt_bash","messageID":"msg_1","sessionID":"ses_cloud","type":"tool","tool":"bash","callID":"call_1","state":{"status":"completed","input":{},"output":"complete","time":{"start":1,"end":2}}}}}""")
        next { it is ChatEventDto.PartUpdated && it.part.id == "prt_bash" }
        mock.pushFeed(path, """{"type":"message.part.updated","properties":{"sessionID":"ses_cloud","part":{"id":"prt_text","messageID":"msg_1","sessionID":"ses_cloud","type":"text","text":"final text"}}}""")
        next { it is ChatEventDto.PartUpdated && it.part.text == "final text" }
        mock.sessionStatuses = """{"ses_cloud":{"type":"idle"}}"""
        fence(generation = 2)
        next { it is ChatEventDto.Resnapshot && it.phase == "complete" }
        assertEquals("idle", app.hosted.statuses.value[session]?.type)
        assertEquals(1, mock.requestCount(attach))
    }

    @Test
    fun `completed fence waits for authoritative status before buffered live events`() = runBlocking(Dispatchers.Default) {
        mock.sessionStatuses = """{"ses_cloud":{"type":"idle"}}"""
        ready()
        open()
        mock.statusGate = CountDownLatch(1)
        val target = mock.requestCount("/session/status") + 1
        fence()
        assertTrue(mock.awaitRequestCount("/session/status", target))
        mock.pushFeed(path, """{"type":"session.status","properties":{"sessionID":"ses_cloud","status":{"type":"busy"}}}""")
        mock.statusGate!!.countDown()
        assertEquals("idle", (next { it is ChatEventDto.SessionStatusChanged } as ChatEventDto.SessionStatusChanged).status.type)
        next { it is ChatEventDto.Resnapshot && it.phase == "complete" }
        assertEquals("busy", (next { it is ChatEventDto.SessionStatusChanged } as ChatEventDto.SessionStatusChanged).status.type)
        withTimeout(TIMEOUT) { app.hosted.statuses.first { it[session]?.type == "busy" } }
        Unit
    }

    @Test
    fun `unknown native attachment retries failed replacement without cancelling caller or healthy system stream`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        mock.hostedStreamStatus[path] = 410
        mock.hostedAttachStatuses.add(500)
        mock.pushFeed(path, """{"type":"session.status","properties":{"sessionID":"ses_cloud","status":{"type":"busy"}}}""")
        assertEquals("busy", (next { it is ChatEventDto.SessionStatusChanged } as ChatEventDto.SessionStatusChanged).status.type)
        withTimeout(TIMEOUT) { app.hosted.statuses.first { it[session]?.type == "busy" } }
        mock.closeFeed(path)
        assertTrue(mock.awaitRequestCount(attach, 2))
        mock.pushFeed(system, """{"type":"cloud.status","properties":{"sessionId":"ses_cloud","cloudStatus":{"type":"running"}}}""")
        mock.hostedAttach = """{"attachmentID":"wrk_att_next","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
        val renewed = "/event?workspace=wrk_att_next"
        assertTrue(mock.awaitFeed(renewed), "replacement stream never recovered")
        next { it is ChatEventDto.Resnapshot && it.phase == "start" }
        assertEquals("busy", app.hosted.statuses.value[session]?.type)
        fence(renewed)
        next { it is ChatEventDto.Resnapshot && it.phase == "complete" }
        app.hosted.messages(session, null)
        assertTrue(mock.lastHostedMessagePath.orEmpty().contains("workspace=wrk_att_next"))
        assertTrue(mock.requestCount(attach) >= 3)
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_test", 1))
    }

    @Test
    fun `passive system unknown attachment recreates and final subscriber releases streams`() = runBlocking(Dispatchers.Default) {
        ready()
        val received = Channel<String>(Channel.UNLIMITED)
        val job = scope.launch {
            app.hosted.systemEvents(HostedWorkspaceRefDto("cloud", "wrk_1"), "ses_cloud", null).collect {
                received.send(it.sessionID)
            }
        }
        assertTrue(mock.awaitFeed(system))
        assertEquals(0, mock.requestCount("/event"))
        mock.hostedStreamStatus[system] = 410
        mock.hostedAttach = """{"attachmentID":"wrk_att_next","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
        mock.closeFeed(system)
        val renewed = "/cloud-agent/event?workspace=wrk_att_next"
        assertTrue(mock.awaitFeed(renewed))
        mock.pushFeed(renewed, """{"type":"cloud.status","properties":{"sessionId":"ses_cloud","cloudStatus":{"type":"running"}}}""")
        assertEquals(session, withTimeout(TIMEOUT) { received.receive() })
        job.cancel()
        job.join()
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_next", 1))
        assertEquals(0, mock.requestCount("/event"), "passive renewal unexpectedly opened native stream")
    }

    @Test
    fun `abort reads authoritative busy status instead of forcing idle`() = runBlocking(Dispatchers.Default) {
        mock.sessionStatuses = """{"ses_cloud":{"type":"busy"}}"""
        ready()
        open()
        app.hosted.abort(session, null)
        assertEquals("busy", app.hosted.statuses.value[session]?.type)
        mock.sessionStatuses = """{"ses_cloud":{"type":"idle"}}"""
        app.hosted.abort(session, null)
        assertEquals("idle", app.hosted.statuses.value[session]?.type)
    }

    @Test
    fun `unknown attachment during pending HTTP read recreates without cancelling request caller`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        mock.hostedMessageStatuses.add(410)
        mock.hostedAttach = """{"attachmentID":"wrk_att_next","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
        app.hosted.messages(session, null)
        assertEquals(2, mock.requestCount(attach))
        assertTrue(mock.awaitFeed("/event?workspace=wrk_att_next"))
    }

    @Test
    fun `pending reads without an attachment are unavailable rather than empty`() = runBlocking(Dispatchers.Default) {
        ready()
        val directory = HostedIDs.workspace("cloud", "wrk_1")
        assertFailsWith<IllegalStateException> { app.hosted.pendingPermissions(directory, null) }
        assertFailsWith<IllegalStateException> { app.hosted.pendingQuestions(directory, null) }
        open()
        val other = HostedIDs.workspace("cloud", "wrk_2")
        assertFailsWith<IllegalStateException> { app.hosted.pendingPermissions(other, null) }
        assertFailsWith<IllegalStateException> { app.hosted.pendingQuestions(other, null) }
        Unit
    }

    @Test
    fun `successful empty pending arrays are authoritative`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        val directory = HostedIDs.workspace("cloud", "wrk_1")
        assertTrue(app.hosted.pendingPermissions(directory, null).isEmpty())
        assertTrue(app.hosted.pendingQuestions(directory, null).isEmpty())
        assertTrue(mock.paths.contains("/permission?workspace=wrk_att_test"))
        assertTrue(mock.paths.contains("/question?workspace=wrk_att_test"))
    }

    @Test
    fun `HTTP failures cannot clear hosted pending requests`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        val directory = HostedIDs.workspace("cloud", "wrk_1")
        mock.pendingPermissionsStatus = 500
        mock.pendingQuestionsStatus = 500
        val permission = assertFailsWith<RuntimeException> { app.hosted.pendingPermissions(directory, null) }
        val question = assertFailsWith<RuntimeException> { app.hosted.pendingQuestions(directory, null) }
        assertTrue(permission.message.orEmpty().contains("HTTP 500"))
        assertTrue(question.message.orEmpty().contains("HTTP 500"))
        assertEquals(1, mock.requestCount(attach))
    }

    @Test
    fun `missing malformed and non-array pending bodies fail`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        val directory = HostedIDs.workspace("cloud", "wrk_1")
        listOf("", "{", "{}", "null", "true").forEach { body ->
            mock.pendingPermissions = body
            mock.pendingQuestions = body
            assertFailsWith<IllegalArgumentException>(body) { app.hosted.pendingPermissions(directory, null) }
            assertFailsWith<IllegalArgumentException>(body) { app.hosted.pendingQuestions(directory, null) }
        }
    }

    @Test
    fun `invalid pending entry fails entire read without dropping valid requests`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        val directory = HostedIDs.workspace("cloud", "wrk_1")
        listOf("{}", "null", "true", """{"id":"invalid"}""").forEach { entry ->
            mock.pendingPermissions = "[$PERMISSION,$entry]"
            mock.pendingQuestions = "[$QUESTION,$entry]"
            assertFailsWith<IllegalArgumentException>(entry) { app.hosted.pendingPermissions(directory, null) }
            assertFailsWith<IllegalArgumentException>(entry) { app.hosted.pendingQuestions(directory, null) }
        }
        mock.pendingPermissions = "[$PERMISSION]"
        mock.pendingQuestions = "[$QUESTION]"
        val permission = app.hosted.pendingPermissions(directory, null).single()
        val question = app.hosted.pendingQuestions(directory, null).single()
        assertEquals("per_1", permission.id)
        assertEquals(session, permission.sessionID)
        assertEquals("que_1", question.id)
        assertEquals(session, question.sessionID)
    }

    @Test
    fun `pending permission 404 renews attachment before returning valid response`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        mock.pendingPermissions = "[$PERMISSION]"
        mock.pendingPermissionsStatuses.add(404)
        mock.hostedAttach = """{"attachmentID":"wrk_att_next","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
        val request = app.hosted.pendingPermissions(HostedIDs.workspace("cloud", "wrk_1"), null).single()
        assertEquals(session, request.sessionID)
        assertEquals(2, mock.requestCount(attach))
        assertEquals(2, mock.requestCount("/permission"))
        assertTrue(mock.paths.contains("/permission?workspace=wrk_att_next"))
    }

    @Test
    fun `pending question 410 renews attachment before returning valid response`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        mock.pendingQuestions = "[$QUESTION]"
        mock.pendingQuestionsStatuses.add(410)
        mock.hostedAttach = """{"attachmentID":"wrk_att_next","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
        val request = app.hosted.pendingQuestions(HostedIDs.workspace("cloud", "wrk_1"), null).single()
        assertEquals(session, request.sessionID)
        assertEquals(2, mock.requestCount(attach))
        assertEquals(2, mock.requestCount("/question"))
        assertTrue(mock.paths.contains("/question?workspace=wrk_att_next"))
    }

    @Test
    fun `native fences and status maps isolate colliding sessions across workspaces`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        val other = HostedIDs.session("cloud", "wrk_2", "ses_cloud")
        mock.hostedAttach = """{"attachmentID":"wrk_att_other","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
        app.hosted.retain(other, null)
        app.hosted.messages(other, null)
        val feed = "/event?workspace=wrk_att_other"
        assertTrue(mock.awaitFeed(feed))
        next { it is ChatEventDto.Resnapshot && it.sessionID == other && it.phase == "start" }
        mock.sessionStatuses = """{"ses_cloud":{"type":"busy"}}"""
        fence(feed, 7)
        next { it is ChatEventDto.Resnapshot && it.sessionID == other && it.phase == "complete" }
        assertEquals("busy", app.hosted.statuses.value[other]?.type)
        assertEquals(null, app.hosted.statuses.value[session])
        mock.sessionStatuses = """{"ses_cloud":{"type":"idle"}}"""
        fence()
        next { it is ChatEventDto.Resnapshot && it.sessionID == session && it.phase == "complete" }
        assertEquals("idle", app.hosted.statuses.value[session]?.type)
        assertEquals("busy", app.hosted.statuses.value[other]?.type)
        app.hosted.stop()
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_test", 1))
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_other", 1))
        assertTrue(app.hosted.statuses.value.isEmpty())
    }

    @Test
    fun `transient retain failure keeps the transcript subscription and recovers streaming`() = runBlocking(Dispatchers.Default) {
        ready()
        mock.hostedAttachStatuses.add(500)
        val received = Channel<ChatEventDto>(Channel.UNLIMITED)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())
        val job = scope.launch {
            api.events(session, HostedIDs.workspace("cloud", "wrk_1")).collect { received.send(it) }
        }
        try {
            assertTrue(mock.awaitRequestCount(attach, 1), "initial attach was not attempted")
            // The events flow must stay alive and restore() must retry the attachment on its own.
            assertTrue(mock.awaitFeed(path), "native stream did not recover after a transient retain failure")
            next(received) { it is ChatEventDto.Resnapshot && it.phase == "start" }
            mock.pushFeed(path, """{"type":"session.status","properties":{"sessionID":"ses_cloud","status":{"type":"busy"}}}""")
            assertEquals(
                "busy",
                (next(received) { it is ChatEventDto.SessionStatusChanged } as ChatEventDto.SessionStatusChanged).status.type,
            )
        } finally {
            job.cancel()
            job.join()
        }
    }

    @Test
    fun `start reopens owned streams on a replacement CLI without an external read`() = runBlocking(Dispatchers.Default) {
        mock.profile = """{"profile":{"email":"test@test.com","name":"Test"},"balance":null,"currentOrgId":"org_1"}"""
        ready()
        val systems = Channel<String>(Channel.UNLIMITED)
        val received = Channel<ChatEventDto>(Channel.UNLIMITED)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())
        val systemJob = scope.launch {
            app.hosted.systemEvents(HostedWorkspaceRefDto("cloud", "wrk_1"), "ses_cloud", "org_1").collect {
                systems.send(it.sessionID)
            }
        }
        val nativeJob = scope.launch {
            api.events(session, HostedIDs.workspace("cloud", "wrk_1")).collect { received.send(it) }
        }
        assertTrue(mock.awaitFeed(path), "initial native stream did not open")
        assertTrue(mock.awaitFeed(system), "initial system stream did not open")
        next(received) { it is ChatEventDto.Resnapshot && it.phase == "start" }
        mock.pushFeed(path, """{"type":"session.status","properties":{"sessionID":"ses_cloud","status":{"type":"busy"}}}""")
        assertEquals("busy", (next(received) { it is ChatEventDto.SessionStatusChanged } as ChatEventDto.SessionStatusChanged).status.type)
        withTimeout(TIMEOUT) { app.hosted.statuses.first { it[session]?.type == "busy" } }
        val replacement = MockCliServer()
        val http = KiloBackendHttpClients.api("")
        try {
            replacement.hostedAttach = """{"attachmentID":"wrk_att_next","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
            val port = replacement.start()
            val api = DefaultApi(basePath = "http://127.0.0.1:$port", client = http)
            app.hosted.start(api, http, port, app.chat)

            assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_test", 1))
            val native = "/event?workspace=wrk_att_next"
            val cloud = "/cloud-agent/event?workspace=wrk_att_next"
            assertTrue(replacement.awaitFeed(native), "replacement native stream did not reopen")
            assertTrue(replacement.awaitFeed(cloud), "replacement system stream did not reopen")
            assertEquals("busy", app.hosted.statuses.value[session]?.type)
            next(received) { it is ChatEventDto.Resnapshot && it.phase == "start" }
            replacement.pushFeed(native, """{"type":"session.status","properties":{"sessionID":"ses_cloud","status":{"type":"idle"}}}""")
            assertEquals("idle", (next(received) { it is ChatEventDto.SessionStatusChanged } as ChatEventDto.SessionStatusChanged).status.type)
            replacement.pushFeed(cloud, """{"type":"cloud.status","properties":{"sessionId":"ses_cloud","cloudStatus":{"type":"running"}}}""")
            assertEquals(session, withTimeout(TIMEOUT) { systems.receive() })
            assertEquals(1, replacement.requestCount(attach))
            assertEquals(1, mock.requestCount(attach))
            assertEquals(0, replacement.requestCount("/session/ses_cloud/message"))
            assertTrue(replacement.lastHostedAttachPath.orEmpty().contains("organizationID=org_1"))

            systemJob.cancel()
            systemJob.join()
            nativeJob.cancel()
            nativeJob.join()
            assertTrue(replacement.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_next", 1))
        } finally {
            app.hosted.stop()
            KiloBackendHttpClients.shutdown(http)
            replacement.close()
        }
    }

    @Test
    fun `stop then start reopens streams for collectors that survived a CLI restart`() = runBlocking(Dispatchers.Default) {
        mock.profile = """{"profile":{"email":"test@test.com","name":"Test"},"balance":null,"currentOrgId":"org_1"}"""
        ready()
        val received = Channel<ChatEventDto>(Channel.UNLIMITED)
        val systems = Channel<String>(Channel.UNLIMITED)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = TestLog())
        val systemJob = scope.launch {
            app.hosted.systemEvents(HostedWorkspaceRefDto("cloud", "wrk_1"), "ses_cloud", "org_1").collect {
                systems.send(it.sessionID)
            }
        }
        val nativeJob = scope.launch {
            api.events(session, HostedIDs.workspace("cloud", "wrk_1")).collect { received.send(it) }
        }
        assertTrue(mock.awaitFeed(path), "initial native stream did not open")
        assertTrue(mock.awaitFeed(system), "initial system stream did not open")
        next(received) { it is ChatEventDto.Resnapshot && it.phase == "start" }
        mock.pushFeed(path, """{"type":"session.status","properties":{"sessionID":"ses_cloud","status":{"type":"busy"}}}""")
        next(received) { it is ChatEventDto.SessionStatusChanged }

        // Production restart/reinstall calls stop() before start(); the RPC collectors above stay
        // subscribed throughout, so retained ownership must not be erased with the transport.
        app.hosted.stop()
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_test", 1))

        val replacement = MockCliServer()
        val http = KiloBackendHttpClients.api("")
        try {
            replacement.hostedAttach = """{"attachmentID":"wrk_att_next","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
            val port = replacement.start()
            val client = DefaultApi(basePath = "http://127.0.0.1:$port", client = http)
            app.hosted.start(client, http, port, app.chat)

            val native = "/event?workspace=wrk_att_next"
            val cloud = "/cloud-agent/event?workspace=wrk_att_next"
            assertTrue(replacement.awaitFeed(native), "native stream was not restored after stop/start")
            assertTrue(replacement.awaitFeed(cloud), "system stream was not restored after stop/start")
            next(received) { it is ChatEventDto.Resnapshot && it.phase == "start" }
            replacement.pushFeed(native, """{"type":"session.status","properties":{"sessionID":"ses_cloud","status":{"type":"busy"}}}""")
            assertEquals("busy", (next(received) { it is ChatEventDto.SessionStatusChanged } as ChatEventDto.SessionStatusChanged).status.type)
            replacement.pushFeed(cloud, """{"type":"cloud.status","properties":{"sessionId":"ses_cloud","cloudStatus":{"type":"running"}}}""")
            assertEquals(session, withTimeout(TIMEOUT) { systems.receive() })
            assertTrue(replacement.lastHostedAttachPath.orEmpty().contains("organizationID=org_1"))
        } finally {
            systemJob.cancel()
            nativeJob.cancel()
            app.hosted.stop()
            KiloBackendHttpClients.shutdown(http)
            replacement.close()
        }
    }

    private companion object {
        const val TIMEOUT = 10_000L
        const val PERMISSION = """{"id":"per_1","sessionID":"ses_cloud","permission":"bash","patterns":["pwd"],"always":[],"metadata":{}}"""
        const val QUESTION = """{"id":"que_1","sessionID":"ses_cloud","questions":[{"question":"Continue?","header":"Confirm","options":[{"label":"Yes","description":"Continue"}]}]}"""
    }
}
