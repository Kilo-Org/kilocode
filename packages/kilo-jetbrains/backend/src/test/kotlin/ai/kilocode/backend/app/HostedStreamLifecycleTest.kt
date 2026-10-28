package ai.kilocode.backend.app

import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
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

    private suspend fun next(predicate: (ChatEventDto) -> Boolean): ChatEventDto = withTimeout(TIMEOUT) {
        while (true) {
            val event = events.receive()
            if (predicate(event)) return@withTimeout event
        }
        error("unreachable")
    }

    private suspend fun open() {
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
        mock.closeFeed(path)
        assertTrue(mock.awaitRequestCount(attach, 2))
        mock.pushFeed(system, """{"type":"cloud.status","properties":{"sessionId":"ses_cloud","cloudStatus":{"type":"running"}}}""")
        mock.hostedAttach = """{"attachmentID":"wrk_att_next","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
        val renewed = "/event?workspace=wrk_att_next"
        assertTrue(mock.awaitFeed(renewed), "replacement stream never recovered")
        next { it is ChatEventDto.Resnapshot && it.phase == "start" }
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
    fun `native fences and status maps isolate colliding sessions across workspaces`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        val other = HostedIDs.session("cloud", "wrk_2", "ses_cloud")
        mock.hostedAttach = """{"attachmentID":"wrk_att_other","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
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
        assertTrue(app.hosted.statuses.value.isEmpty())
    }

    private companion object {
        const val TIMEOUT = 10_000L
    }
}
