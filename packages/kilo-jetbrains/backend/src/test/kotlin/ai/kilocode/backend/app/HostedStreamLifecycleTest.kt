package ai.kilocode.backend.app

import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.backend.cli.KiloBackendHttpClients
import ai.kilocode.backend.rpc.KiloSessionRpcApiImpl
import ai.kilocode.jetbrains.api.client.DefaultApi
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
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
    fun `hosted turn lifecycle drives busy and idle when no session status is emitted`() = runBlocking(Dispatchers.Default) {
        mock.sessionStatuses = """{"ses_cloud":{"type":"idle"}}"""
        ready()
        open()
        fence()
        next { it is ChatEventDto.Resnapshot && it.phase == "complete" }
        assertEquals("idle", app.hosted.statuses.value[session]?.type)

        // Cloud streams the turn but not session.status; the running indicator must still light up
        // through the shared statuses map, exactly like a local session's busy status.
        mock.pushFeed(path, """{"type":"session.turn.open","properties":{"sessionID":"ses_cloud"}}""")
        next { it is ChatEventDto.TurnOpen && it.sessionID == session }
        withTimeout(TIMEOUT) { app.hosted.statuses.first { it[session]?.type == "busy" } }

        mock.pushFeed(path, """{"type":"session.turn.close","properties":{"sessionID":"ses_cloud","reason":"completed"}}""")
        next { it is ChatEventDto.TurnClose && it.sessionID == session }
        withTimeout(TIMEOUT) { app.hosted.statuses.first { it[session]?.type == "idle" } }
        Unit
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
    fun `passive discovery does not starve new native and preparation failure streams`() = runBlocking(Dispatchers.Default) {
        ready()
        val jobs = mutableListOf<Job>()
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        try {
            repeat(8) { index ->
                val native = "ses_watch_$index"
                val id = "wrk_att_$index"
                val ref = HostedWorkspaceRefDto("cloud", "wrk_watch_$index")
                mock.hostedAttachments["/kilocode/session-host/session/cloud/$native/attach"] =
                    """{"attachmentID":"$id","session":{"providerID":"cloud","sessionID":"$native"},"expiresAt":1}"""
                jobs += scope.launch(start = CoroutineStart.UNDISPATCHED) {
                    app.hosted.systemEvents(ref, native, null).collect {}
                }
                assertTrue(
                    mock.awaitFeed("/cloud-agent/event?workspace=$id"),
                    "passive stream $index was queued behind existing long-lived streams",
                )
            }
            jobs += scope.launch(start = CoroutineStart.UNDISPATCHED) {
                app.hosted.systemEvents(HostedWorkspaceRefDto("cloud", "wrk_1"), "ses_cloud", null)
                    .collect { received.send(it) }
            }
            open()
            mock.pushFeed(system, COMMAND)
            val failure = withTimeout(TIMEOUT) { received.receive() }
            assertEquals(session, failure.sessionID)
            assertEquals("failed", failure.action)
            assertEquals(
                "Setup command 1 failed (exit code 1)\nbash: line 1: cd: cloud-agent: No such file or directory\n",
                failure.detail,
            )
            assertEquals(1, mock.requestCount("/event"))
        } finally {
            jobs.forEach { it.cancel() }
            jobs.forEach { it.join() }
        }
    }

    @Test
    fun `initial passive replay survives a collector delayed until after the feed starts`() = runBlocking(Dispatchers.Default) {
        ready()
        val gate = CountDownLatch(1)
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        mock.responseGate = CountDownLatch(1)
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { dispatcher ->
            dispatcher.executor.execute { gate.await() }
            // Start collection synchronously, then hold its ensure() continuation while the
            // independently owned system feed receives the provider's complete initial replay.
            val job = scope.launch(dispatcher, start = CoroutineStart.UNDISPATCHED) {
                app.hosted.systemEvents(ref, "ses_cloud", null).collect { received.send(it) }
            }
            try {
                assertTrue(mock.awaitRequestCount(attach, 1))
                mock.responseGate!!.countDown()
                assertTrue(mock.awaitFeed(system))
                val rows = snapshots()
                rows.forEach { mock.pushFeed(system, it) }
                withTimeout(TIMEOUT) {
                    app.hosted.systemEvents(ref, "ses_cloud", null).first { it.stepID == "phase:setup_commands" }
                }
                gate.countDown()
                val replay = withTimeout(TIMEOUT) { List(rows.size) { received.receive() } }
                assertEquals("attempt_failed", replay.first().action)
                assertEquals("workspace_setup_failed", replay.first().failure)
                assertEquals("setup_command:0", replay.getOrNull(replay.lastIndex - 1)?.stepID)
                assertEquals("phase:setup_commands", replay.last().stepID)
                mock.pushFeed(system, """{"type":"cloud.status","properties":{"cloudStatus":{"type":"error","message":"Private server error"}}}""")
                assertEquals("error", withTimeout(TIMEOUT) { received.receive() }.cloudStatus)
                assertEquals(0, mock.requestCount("/event"))
                assertEquals(0, mock.requestCount("/session/ses_cloud/message"))
            } finally {
                gate.countDown()
                mock.responseGate?.countDown()
                job.cancel()
                job.join()
            }
        }
    }

    @Test
    fun `late passive collectors replay every session step after interleaved sessions and continue live`() = runBlocking(Dispatchers.Default) {
        ready()
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        val jobs = mutableListOf<Job>()
        jobs += scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.hosted.systemEvents(ref, "ses_cloud", null).collect { received.send(it) }
        }
        try {
            assertTrue(mock.awaitFeed(system))
            val rows = snapshots()
            rows.forEach { mock.pushFeed(system, it) }
            val initial = withTimeout(TIMEOUT) { List(rows.size) { received.receive() } }
            val other = HostedWorkspaceRefDto("cloud", "wrk_2")
            val feed = "/cloud-agent/event?workspace=wrk_att_other"
            val interleaved = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
            mock.hostedAttach = """{"attachmentID":"wrk_att_other","session":{"providerID":"cloud","sessionID":"ses_cloud"},"expiresAt":1}"""
            jobs += scope.launch(start = CoroutineStart.UNDISPATCHED) {
                app.hosted.systemEvents(other, "ses_cloud", null).collect { interleaved.send(it) }
            }
            assertTrue(mock.awaitFeed(feed))
            repeat(16) {
                mock.pushFeed(feed, """{"type":"cloud.sandbox.status","properties":{"sessionID":"ses_cloud","sandbox":{"status":"unavailable","observedAt":${it + 1}}}}""")
            }
            withTimeout(TIMEOUT) {
                repeat(16) { assertEquals(HostedIDs.session("cloud", "wrk_2", "ses_cloud"), interleaved.receive().sessionID) }
            }

            val late = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
            jobs += scope.launch(start = CoroutineStart.UNDISPATCHED) {
                app.hosted.systemEvents(ref, "ses_cloud", null).collect { late.send(it) }
            }
            assertEquals(initial, withTimeout(TIMEOUT) { List(rows.size) { late.receive() } })
            mock.pushFeed(system, """{"type":"cloud.status","properties":{"cloudStatus":{"type":"ready"}}}""")
            val live = withTimeout(TIMEOUT) { late.receive() }
            assertEquals(session, live.sessionID)
            assertEquals("ready", live.cloudStatus)
            assertEquals(2, mock.requestCount("/cloud-agent/event"), "late collection reopened an existing passive feed")
            assertEquals(0, mock.requestCount("/event"))
        } finally {
            jobs.forEach { it.cancel() }
            jobs.forEach { it.join() }
        }
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_test", 1))
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_other", 1))
    }

    @Test
    fun `slow passive collector loses no live events and does not block another collector`() = runBlocking(Dispatchers.Default) {
        ready()
        val gate = CompletableDeferred<Unit>()
        val blocked = CompletableDeferred<Unit>()
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        val job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.hosted.systemEvents(ref, "ses_cloud", null).collect {
                if (blocked.complete(Unit)) gate.await()
                received.send(it)
            }
        }
        try {
            assertTrue(mock.awaitFeed(system))
            mock.pushFeed(system, ATTEMPT)
            withTimeout(TIMEOUT) { blocked.await() }
            val observer = scope.async(start = CoroutineStart.UNDISPATCHED) {
                app.hosted.systemEvents(ref, "ses_cloud", null).first { it.observedAt == 96.0 }
            }
            try {
                repeat(96) {
                    mock.pushFeed(system, """{"type":"cloud.sandbox.status","properties":{"sandbox":{"status":"unavailable","observedAt":${it + 1}}}}""")
                }
                withTimeout(TIMEOUT) { observer.await() }
                gate.complete(Unit)
                assertEquals("attempt_failed", withTimeout(TIMEOUT) { received.receive() }.action)
                val observed = withTimeout(TIMEOUT) { List(96) { received.receive().observedAt } }
                assertEquals((1..96).map(Int::toDouble), observed)
            } finally {
                observer.cancel()
                observer.join()
            }
        } finally {
            gate.complete(Unit)
            job.cancel()
            job.join()
        }
    }

    @Test
    fun `final passive subscriber discards its replay before the session is observed again`() = runBlocking(Dispatchers.Default) {
        ready()
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        val first = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.hosted.systemEvents(ref, "ses_cloud", null).collect { received.send(it) }
        }
        try {
            assertTrue(mock.awaitFeed(system))
            mock.pushFeed(system, ATTEMPT)
            assertEquals("attempt_failed", withTimeout(TIMEOUT) { received.receive() }.action)
        } finally {
            first.cancel()
            first.join()
        }
        assertTrue(mock.awaitRequestCount("/kilocode/session-host/attachment/wrk_att_test", 1))
        val second = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.hosted.systemEvents(ref, "ses_cloud", null).collect { received.send(it) }
        }
        try {
            assertTrue(mock.awaitFeed(system, 2))
            mock.pushFeed(system, """{"type":"cloud.status","properties":{"cloudStatus":{"type":"ready"}}}""")
            assertEquals("ready", withTimeout(TIMEOUT) { received.receive() }.cloudStatus)
            assertEquals(2, mock.requestCount(attach))
            assertEquals(0, mock.requestCount("/event"))
        } finally {
            second.cancel()
            second.join()
        }
    }

    @Test
    fun `live creation failure includes full multiline command output and retains it for late collectors`() = runBlocking(Dispatchers.Default) {
        ready()
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        val job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.hosted.systemEvents(ref, "ses_cloud", null).collect { received.send(it) }
        }
        try {
            assertTrue(mock.awaitFeed(system))
            mock.pushFeed(system, preparing(1) {
                put("action", "step_started")
                put("stepId", "phase:setup_commands")
                put("kind", "phase")
                put("label", "setup commands")
            })
            assertEquals("phase", withTimeout(TIMEOUT) { received.receive() }.stepKind)
            mock.pushFeed(system, preparing(2) {
                put("action", "step_started")
                put("kind", "setup_command")
                put("label", "Setup command 1")
            })
            assertEquals("setup_command", withTimeout(TIMEOUT) { received.receive() }.stepKind)
            val first = "First line\n  ${"command detail ".repeat(40)}\n"
            val last = "bash: line 1: cd: cloud-agent: No such file or directory\n"
            val chunk = preparing(3) {
                put("action", "step_output")
                put("output", first)
            }
            mock.pushFeed(system, chunk)
            assertEquals(first, withTimeout(TIMEOUT) { received.receive() }.output)
            mock.pushFeed(system, preparing(4) {
                put("action", "step_output")
                put("stepId", "phase:setup_commands")
                put("output", "Independent phase log\n")
            })
            assertEquals("Independent phase log\n", withTimeout(TIMEOUT) { received.receive() }.output)
            mock.pushFeed(system, chunk)
            mock.pushFeed(system, preparing(5) {
                put("action", "step_output")
                put("output", last)
            })
            val output = first + last
            assertEquals(output, withTimeout(TIMEOUT) { received.receive() }.output)
            mock.pushFeed(system, preparing(6) {
                put("action", "step_failed")
                put("safeError", "Setup command 1 failed")
                put("exitCode", 1)
            })
            val failed = withTimeout(TIMEOUT) { received.receive() }
            assertEquals("setup_command", failed.stepKind)
            assertEquals("setup_command:0", failed.stepID)
            assertEquals("Setup command 1 failed (exit code 1)\n$output", failed.detail)
            assertEquals(output, failed.output)
            assertFalse(failed.outputTruncated)
            mock.pushFeed(system, preparing(7) {
                put("action", "step_failed")
                put("stepId", "phase:setup_commands")
                put("safeError", "workspace_setup_failed")
            })
            val phase = withTimeout(TIMEOUT) { received.receive() }
            assertEquals("phase", phase.stepKind)
            assertEquals("Independent phase log\n", phase.output)
            mock.pushFeed(system, preparing(8) {
                put("action", "step_progress")
                put("detail", "Generic progress after failure")
            })
            mock.pushFeed(system, """{"type":"cloud.status","properties":{"cloudStatus":{"type":"error","safeError":"Private error","message":"Private server error"}}}""")
            val status = withTimeout(TIMEOUT) { received.receive() }
            assertEquals("error", status.cloudStatus)
            assertNull(status.message)
            assertNull(status.detail)
            assertNull(status.output)
            mock.pushFeed(system, preparing(9) {
                put("action", "attempt_failed")
                put("stepId", JsonNull)
                put("safeError", "workspace_setup_failed")
            })
            assertEquals("attempt_failed", withTimeout(TIMEOUT) { received.receive() }.action)

            val replay = withTimeout(TIMEOUT) {
                app.hosted.systemEvents(ref, "ses_cloud", null).first { it.stepID == "setup_command:0" }
            }
            assertEquals(failed, replay)
            assertEquals(1, mock.requestCount("/cloud-agent/event"))
            assertEquals(0, mock.requestCount("/event"))
            assertEquals(0, mock.requestCount("/session/ses_cloud/message"))
        } finally {
            job.cancel()
            job.join()
        }
    }

    @Test
    fun `live output retains at most 65536 UTF8 bytes without splitting characters or duplicating snapshot tails`() = runBlocking(Dispatchers.Default) {
        ready()
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        val job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.hosted.systemEvents(ref, "ses_cloud", null).collect { received.send(it) }
        }
        try {
            assertTrue(mock.awaitFeed(system))
            mock.pushFeed(system, preparing(1) {
                put("action", "step_started")
                put("kind", "setup_command")
                put("label", "Setup command 1")
            })
            withTimeout(TIMEOUT) { received.receive() }
            mock.pushFeed(system, preparing(2) {
                put("action", "step_output")
                put("output", "\u20ac".repeat(22_000))
            })
            val first = withTimeout(TIMEOUT) { received.receive() }
            assertEquals("\u20ac".repeat(21_845), first.output)
            assertEquals(65_535, assertNotNull(first.output).toByteArray(Charsets.UTF_8).size)
            assertTrue(first.outputTruncated)
            mock.pushFeed(system, preparing(3) {
                put("action", "step_output")
                put("output", "AB")
            })
            val tail = "\u20ac".repeat(21_844) + "AB"
            val output = withTimeout(TIMEOUT) { received.receive() }
            assertEquals(tail, output.output)
            assertEquals(65_534, assertNotNull(output.output).toByteArray(Charsets.UTF_8).size)
            assertTrue(output.outputTruncated)
            assertFalse(assertNotNull(output.output).contains('\uFFFD'))
            mock.pushFeed(system, preparing(4) {
                put("action", "step_failed")
                put("safeError", "Setup command 1 failed")
                put("exitCode", 1)
            })
            val failed = withTimeout(TIMEOUT) { received.receive() }
            assertEquals("Setup command 1 failed (exit code 1)\n$tail", failed.detail)
            assertTrue(failed.outputTruncated)
            mock.pushFeed(system, preparing(4) {
                put("action", "step_snapshot")
                putJsonObject("stepSnapshot") {
                    put("id", "setup_command:0")
                    put("key", "setup_commands")
                    put("kind", "setup_command")
                    put("label", "Setup command 1")
                    put("status", "failed")
                    put("safeError", "Setup command 1 failed")
                    put("exitCode", 1)
                    put("outputTail", tail)
                    put("outputTruncated", true)
                }
            })
            val snapshot = withTimeout(TIMEOUT) { received.receive() }
            assertEquals(failed.detail, snapshot.detail)
            assertEquals(tail, snapshot.output)
            assertTrue(snapshot.outputTruncated)
            mock.pushFeed(system, preparing(5) {
                put("action", "step_snapshot")
                putJsonObject("stepSnapshot") {
                    put("id", "setup_command:0")
                    put("key", "setup_commands")
                    put("kind", "setup_command")
                    put("label", "Setup command 1")
                    put("status", "failed")
                    put("safeError", "Setup command 1 failed")
                    put("exitCode", 1)
                }
            })
            val retained = withTimeout(TIMEOUT) { received.receive() }
            assertEquals(failed.detail, retained.detail)
            assertEquals(tail, retained.output)
            assertTrue(retained.outputTruncated)
            assertEquals(retained, withTimeout(TIMEOUT) {
                app.hosted.systemEvents(ref, "ses_cloud", null).first { it.stepID == "setup_command:0" }
            })
        } finally {
            job.cancel()
            job.join()
        }
    }

    @Test
    fun `output and replay stay isolated across attempts and evict old preparation history`() = runBlocking(Dispatchers.Default) {
        ready()
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        val job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
            app.hosted.systemEvents(ref, "ses_cloud", null).collect { received.send(it) }
        }
        try {
            assertTrue(mock.awaitFeed(system))
            for (index in 1..4) {
                val attempt = "attempt_$index"
                val revision = index * 10
                mock.pushFeed(system, preparing(revision + 1, attempt) {
                    put("action", "step_started")
                    put("kind", "setup_command")
                    put("label", "Setup command 1")
                })
                assertNull(withTimeout(TIMEOUT) { received.receive() }.output)
                mock.pushFeed(system, preparing(revision + 2, attempt) {
                    put("action", "step_output")
                    put("output", "Attempt $index\n")
                })
                assertEquals("Attempt $index\n", withTimeout(TIMEOUT) { received.receive() }.output)
                mock.pushFeed(system, preparing(revision + 3, attempt) {
                    put("action", "step_failed")
                    put("safeError", "Setup command 1 failed")
                    put("exitCode", 1)
                })
                assertEquals("Setup command 1 failed (exit code 1)\nAttempt $index\n", withTimeout(TIMEOUT) { received.receive() }.detail)
                mock.pushFeed(system, preparing(revision + 4, attempt) {
                    put("action", "attempt_failed")
                    put("stepId", JsonNull)
                    put("safeError", "workspace_setup_failed")
                })
                assertEquals(attempt, withTimeout(TIMEOUT) { received.receive() }.attemptID)
            }
            mock.pushFeed(system, preparing(1, "attempt_1") {
                put("action", "step_snapshot")
                putJsonObject("stepSnapshot") {
                    put("id", "setup_command:0")
                    put("status", "failed")
                    put("outputTail", "Evicted attempt output\n")
                }
            })
            mock.pushFeed(system, """{"type":"cloud.status","properties":{"cloudStatus":{"type":"ready"}}}""")
            assertEquals("ready", withTimeout(TIMEOUT) { received.receive() }.cloudStatus)
            val replay = withTimeout(TIMEOUT) {
                app.hosted.systemEvents(ref, "ses_cloud", null).take(5).toList()
            }
            assertEquals(setOf("attempt_3", "attempt_4"), replay.mapNotNull { it.attemptID }.toSet())
            assertEquals(listOf("Attempt 3\n", "Attempt 4\n"), replay.filter { it.stepID == "setup_command:0" }.map { it.output })
            assertEquals("ready", replay.last().cloudStatus)
            assertEquals(1, mock.requestCount("/cloud-agent/event"))
        } finally {
            job.cancel()
            job.join()
        }
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
    fun `unavailable hosted history is an error rather than an empty transcript`() = runBlocking(Dispatchers.Default) {
        ready()
        open()
        mock.hostedMessageStatuses.add(503)
        val failure = assertFailsWith<RuntimeException> { app.hosted.messages(session, null) }
        assertTrue(failure.message.orEmpty().contains("HTTP 503"))
        assertTrue(app.hosted.messages(session, null).isEmpty(), "a successful empty history remains authoritative")
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

    private fun preparing(revision: Int, attempt: String = "attempt_live", body: JsonObjectBuilder.() -> Unit): String =
        buildJsonObject {
            put("type", "preparing")
            putJsonObject("properties") {
                put("sessionID", "ses_cloud")
                putJsonObject("preparation") {
                    put("version", 2)
                    put("attemptId", attempt)
                    put("triggerMessageId", "msg_live")
                    put("revision", revision)
                    put("timestamp", revision)
                    put("step", "setup_commands")
                    put("stepId", "setup_command:0")
                    put("message", "Preparing workspace")
                    body()
                }
            }
        }.toString()

    private fun snapshots(): List<String> = listOf(ATTEMPT) + (1..16).map {
        """{"type":"preparing","properties":{"preparation":{"version":2,"attemptId":"e718c48d-eae1-451a-a773-c84ddff94d59","triggerMessageId":"msg_01a1a792125boXEU3GPUHuh0eH","revision":$it,"timestamp":$it,"step":"cloning","message":"Preparation snapshot","action":"step_snapshot","stepId":"clone:$it","stepSnapshot":{"id":"clone:$it","key":"cloning","kind":"phase","label":"Clone step $it","status":"completed","revision":$it}}}}"""
    } + listOf(COMMAND, PHASE)

    private companion object {
        const val TIMEOUT = 10_000L
        const val ATTEMPT = """{"type":"preparing","properties":{"preparation":{"version":2,"attemptId":"e718c48d-eae1-451a-a773-c84ddff94d59","triggerMessageId":"msg_01a1a792125boXEU3GPUHuh0eH","revision":21,"timestamp":1793812765086,"step":"workspace_setup","message":"Preparation snapshot","action":"attempt_snapshot","attempt":{"id":"e718c48d-eae1-451a-a773-c84ddff94d59","status":"failed","revision":21,"completedAt":1793812765086,"safeError":"workspace_setup_failed"}}}}"""
        const val COMMAND = """{"type":"preparing","properties":{"preparation":{"version":2,"attemptId":"e718c48d-eae1-451a-a773-c84ddff94d59","triggerMessageId":"msg_01a1a792125boXEU3GPUHuh0eH","revision":19,"timestamp":1793812765084,"step":"setup_commands","message":"Preparation snapshot","action":"step_snapshot","stepId":"setup_command:0","stepSnapshot":{"id":"setup_command:0","key":"setup_commands","kind":"setup_command","label":"Setup command 1","status":"failed","revision":19,"commandIndex":0,"commandCount":1,"parentStepId":"phase:setup_commands","outputTail":"bash: line 1: cd: cloud-agent: No such file or directory\n","outputTruncated":false,"safeError":"Setup command 1 failed","exitCode":1}}}}"""
        const val PHASE = """{"type":"preparing","properties":{"preparation":{"version":2,"attemptId":"e718c48d-eae1-451a-a773-c84ddff94d59","triggerMessageId":"msg_01a1a792125boXEU3GPUHuh0eH","revision":20,"timestamp":1793812765085,"step":"setup_commands","message":"Preparation snapshot","action":"step_snapshot","stepId":"phase:setup_commands","stepSnapshot":{"id":"phase:setup_commands","key":"setup_commands","kind":"phase","label":"setup commands","status":"failed","revision":20,"safeError":"workspace_setup_failed"}}}}"""
        const val PERMISSION = """{"id":"per_1","sessionID":"ses_cloud","permission":"bash","patterns":["pwd"],"always":[],"metadata":{}}"""
        const val QUESTION = """{"id":"que_1","sessionID":"ses_cloud","questions":[{"question":"Continue?","header":"Confirm","options":[{"label":"Yes","description":"Continue"}]}]}"""
    }
}
