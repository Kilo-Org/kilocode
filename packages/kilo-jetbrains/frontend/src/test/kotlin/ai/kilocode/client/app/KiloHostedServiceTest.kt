package ai.kilocode.client.app

import ai.kilocode.client.testing.TestLog
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.awt.EventQueue
import javax.swing.SwingUtilities
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertNull
import com.intellij.openapi.util.Disposer

class KiloHostedServiceTest {
    companion object { private const val WAIT = 5_000L }
    private val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @AfterTest
    fun tearDown() {
        cs.cancel()
    }

    @Test
    fun `repository resolution runs off the EDT`() = runBlocking {
        val thread = CompletableDeferred<Boolean>()
        val service = KiloHostedService(cs, FakeRpc(), gate = { true }, log = TestLog(), repo = {
            thread.complete(EventQueue.isDispatchThread())
            "repo"
        })

        SwingUtilities.invokeAndWait { service.refresh("/repo") }

        assertEquals(false, withTimeout(WAIT) { thread.await() })
    }

    @Test
    fun `failed workspace status reads settle as unavailable rather than loading indefinitely`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val rpc = object : KiloHostedRpcApi by FakeRpc(mapOf(null to HostedWorkspaceListDto(listOf(HostedWorkspaceDto(ref))))) {
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceStatusDto =
                error("status unavailable")
        }
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog(), repo = { "repo" })
        service.refresh("/repo")
        val state = withTimeout(WAIT) { service.state.first { it.items.isNotEmpty() && !it.loading } }
        assertEquals("unavailable", state.presentation(ref)?.computeStatus)
    }

    @Test
    fun `workspace rows publish before parallel status reads settle`() = runBlocking {
        val one = workspace("1")
        val two = workspace("2")
        val gates = mapOf(one.ref to CompletableDeferred<Unit>(), two.ref to CompletableDeferred<Unit>())
        val rpc = object : KiloHostedRpcApi by FakeRpc(mapOf(null to HostedWorkspaceListDto(listOf(one, two)))) {
            val reading = Channel<HostedWorkspaceRefDto>(Channel.UNLIMITED)
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceStatusDto {
                reading.send(ref)
                gates.getValue(ref).await()
                return HostedWorkspaceStatusDto(ref, "active", "running", "ready", 1.0)
            }
        }
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog(), repo = { "repo" })

        service.refresh("/repo")
        val first = withTimeout(WAIT) { service.state.first { it.items.size == 2 } }
        assertTrue(first.loading)
        assertTrue(first.statuses.isEmpty())
        val started = setOf(withTimeout(WAIT) { rpc.reading.receive() }, withTimeout(WAIT) { rpc.reading.receive() })
        assertEquals(setOf(one.ref, two.ref), started)

        gates.getValue(one.ref).complete(Unit)
        withTimeout(WAIT) { service.state.first { it.statuses.keys == setOf(one.ref.key) } }
        gates.getValue(two.ref).complete(Unit)
        val complete = withTimeout(WAIT) { service.state.first { !it.loading && it.statuses.size == 2 } }
        assertEquals(setOf(one.ref.key, two.ref.key), complete.statuses.keys)
    }

    @Test
    fun `superseded status fanout cannot publish or finish the newer refresh`() = runBlocking {
        val old = workspace("old")
        val fresh = workspace("fresh")
        val gate = CompletableDeferred<Unit>()
        val pages = mutableMapOf<String?, HostedWorkspaceListDto>(null to HostedWorkspaceListDto(listOf(old)))
        val rpc = object : KiloHostedRpcApi by FakeRpc(pages) {
            override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) = pages.getValue(cursor)
            override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceStatusDto {
                if (ref == old.ref) gate.await()
                return HostedWorkspaceStatusDto(ref, "active", "running", "ready", 1.0)
            }
        }
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog(), repo = { "repo" })

        service.refresh("/repo-old")
        withTimeout(WAIT) { service.state.first { it.items.singleOrNull()?.ref == old.ref } }
        pages[null] = HostedWorkspaceListDto(listOf(fresh))
        service.refresh("/repo-new")
        withTimeout(WAIT) { service.state.first { !it.loading && it.items.singleOrNull()?.ref == fresh.ref } }
        gate.complete(Unit)

        assertEquals(setOf(fresh.ref.key), service.state.value.statuses.keys)
        assertEquals(fresh.ref, service.state.value.statuses.values.single().ref)
    }

    @Test
    fun `failure survives idle replay and newer attempt retires the failed attempt`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            val failed = HostedSystemEventDto(key, "preparing", action = "attempt_failed",
                message = "Finishing setup", failure = "workspace_setup_failed", triggerMessageID = "msg_1",
                attemptID = "attempt_1", revision = 8, observedAt = 100.0)
            rpc.send(failed)
            assertEquals("workspace_setup_failed", service.state.value.failure(key)?.failure)
            assertNull(service.state.value.preparation(key))
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 110.0))
            assertEquals("workspace_setup_failed", service.state.value.failure(key)?.failure)
            rpc.send(failed.copy(action = "running", failure = null, step = "workspace_setup", revision = 8))
            assertEquals("workspace_setup_failed", service.state.value.failure(key)?.failure)
            val fresh = failed.copy(action = "attempt_started", failure = null, message = null,
                attemptID = "attempt_2", triggerMessageID = "msg_2", revision = 1, observedAt = 200.0)
            rpc.send(fresh)
            assertNull(service.state.value.failure(key))
            assertEquals("attempt_2", service.state.value.preparation(key)?.attemptID)
            rpc.send(failed.copy(revision = 99, observedAt = 9999.0))
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "error", observedAt = 150.0))
            assertNull(service.state.value.failure(key))
            assertEquals("attempt_2", service.state.value.preparation(key)?.attemptID)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `terminal preparation revision is not gated by a later lifecycle observation clock`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            val step = HostedSystemEventDto(key, "preparing", step = "workspace_setup", action = "running",
                attemptID = "attempt_1", revision = 7, observedAt = 100.0)
            rpc.send(step)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 900.0))
            rpc.send(step.copy(step = null, action = "attempt_failed", failure = "workspace_setup_failed",
                revision = 8, observedAt = 110.0))
            assertEquals("workspace_setup_failed", service.state.value.failure(key)?.failure)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `cloud error without code is retained until explicit preparation restart`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "error", observedAt = 100.0))
            assertEquals("attempt_failed", service.state.value.failure(key)?.action)
            assertNull(service.state.value.failure(key)?.failure)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 110.0))
            assertEquals("error", service.state.value.failure(key)?.cloudStatus)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "preparing", observedAt = 120.0))
            assertNull(service.state.value.failure(key))
            assertEquals("preparing", service.state.value.preparation(key)?.cloudStatus)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "error", observedAt = 100.0))
            assertNull(service.state.value.failure(key))
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `terminal step failure with safe code stays separate from its latest detail`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            rpc.send(HostedSystemEventDto(key, "preparing", step = "workspace_setup", action = "failed",
                message = "Finishing setup", failure = "workspace_setup_failed", attemptID = "attempt_1", revision = 8))
            assertNull(service.state.value.preparation(key))
            assertEquals("Finishing setup", service.state.value.failure(key)?.message)
            assertEquals("workspace_setup_failed", service.state.value.failure(key)?.failure)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `discovers every page and dedupes workspaces with passive status`() = runBlocking(Dispatchers.Default) {
        val one = workspace("1")
        val two = workspace("2")
        val rpc = FakeRpc(
            pages = mapOf(
                null to HostedWorkspaceListDto(
                    items = listOf(one),
                    cursor = "c2",
                    providers = listOf(HostedProviderDto("cloud", true, true)),
                ),
                "c2" to HostedWorkspaceListDto(
                    items = listOf(one, two),
                    cursor = null,
                    providers = listOf(HostedProviderDto("cloud", true, true)),
                ),
            ),
        )
        val service = KiloHostedService(
            cs = cs,
            rpc = rpc,
            gate = { true },
            log = TestLog(),
            repo = { "https://github.com/Kilo-Org/kilocode" },
        )

        service.refresh("/repo")
        val state = withTimeout(5_000) {
            service.state.first { !it.loading && it.items.isNotEmpty() }
        }

        assertEquals(2, state.items.size)
        assertEquals(listOf("wrk_1", "wrk_2"), state.items.map { it.ref.workspaceID })
        assertEquals("running", state.statuses[one.ref.key]?.computeStatus)
        assertTrue(state.providers.single().available)
        assertTrue(state.enabled)
    }

    @Test
    fun `discovers repository workspaces across branches beyond ten pages`() = runBlocking(Dispatchers.Default) {
        val remote = "https://example.test/owner/repository"
        val pages = (0 until 12).associate { page ->
            val cursor = page.toString().takeUnless { page == 0 }
            cursor to HostedWorkspaceListDto(
                items = listOf(workspace(page.toString()).copy(
                    repositoryUrl = remote,
                    branch = "feature/$page",
                    sessions = emptyList(),
                )),
                cursor = (page + 1).toString().takeUnless { page == 11 },
            )
        }
        val rpc = FakeRpc(pages = pages)
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog(), repo = { remote })

        service.refresh("/repo")
        val state = withTimeout(WAIT) { service.state.first { !it.loading && it.items.isNotEmpty() } }

        assertEquals((0 until 12).map { "feature/$it" }, state.items.map { it.branch })
        assertEquals(pages.keys.map { remote to it }, rpc.requests.toList())
        assertNull(state.cursor)
        assertNull(state.error)
    }

    @Test
    fun `workspace discovery stops before requesting a repeated cursor again`() = runBlocking(Dispatchers.Default) {
        for (next in listOf("one", "two")) {
            val rpc = FakeRpc(pages = mapOf(
                null to HostedWorkspaceListDto(items = listOf(workspace("0")), cursor = "one"),
                "one" to HostedWorkspaceListDto(items = listOf(workspace("1")), cursor = "two"),
                "two" to HostedWorkspaceListDto(items = listOf(workspace("2")), cursor = next),
            ))
            val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog(), repo = { "repo" })

            service.refresh("/repo")
            val state = withTimeout(WAIT) { service.state.first { !it.loading && it.items.isNotEmpty() } }

            assertEquals(listOf("wrk_0", "wrk_1", "wrk_2"), state.items.map { it.ref.workspaceID })
            assertEquals(listOf(null, "one", "two"), rpc.requests.map { it.second })
            assertNull(state.cursor)
            assertNull(state.error)
            service.loadMore()
            assertEquals(3, rpc.requests.size)
        }
    }

    @Test
    fun `pagination follows the session cursor`() = runBlocking(Dispatchers.Default) {
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val rpc = FakeRpc(
            sessionPages = mapOf(
                null to sessionPage("s1", "s2", cursor = "next"),
                "next" to sessionPage("s2", "s3", cursor = null),
            ),
        )
        val service = KiloHostedService(cs = cs, rpc = rpc, gate = { true }, log = TestLog(), repo = { "repo" })

        val sessions = service.sessions(ref)

        assertEquals(listOf("s1", "s2", "s3"), sessions.map { it.nativeSessionID })
    }

    @Test
    fun `root session discovery follows every page beyond ten pages`() = runBlocking(Dispatchers.Default) {
        val pages = (0 until 12).associate { page ->
            val cursor = page.toString().takeUnless { page == 0 }
            cursor to sessionPage("s$page", cursor = (page + 1).toString().takeUnless { page == 11 })
        }
        val rpc = FakeRpc(sessionPages = pages)
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())

        val sessions = withTimeout(WAIT) { service.sessions(HostedWorkspaceRefDto("cloud", "wrk_1")) }

        assertEquals((0 until 12).map { "s$it" }, sessions.map { it.nativeSessionID })
        assertEquals(pages.keys.toList(), rpc.cursors)
    }

    @Test
    fun `root session discovery stops before requesting repeated cursors again`() = runBlocking(Dispatchers.Default) {
        for (next in listOf("one", "two")) {
            val rpc = FakeRpc(sessionPages = mapOf(
                null to sessionPage("s0", cursor = "one"),
                "one" to sessionPage("s0", "s1", cursor = "two"),
                "two" to sessionPage("s2", cursor = next),
            ))
            val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())

            val sessions = withTimeout(WAIT) { service.sessions(HostedWorkspaceRefDto("cloud", "wrk_1")) }

            assertEquals(listOf("s0", "s1", "s2"), sessions.map { it.nativeSessionID })
            assertEquals(listOf(null, "one", "two"), rpc.cursors)
        }
    }

    @Test
    fun `root session discovery reuses an already loaded first page`() = runBlocking(Dispatchers.Default) {
        val first = sessionPage("s0", "s1", cursor = "next")
        val rpc = FakeRpc(sessionPages = mapOf("next" to sessionPage("s1", "s2", cursor = null)))
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())

        val sessions = service.sessions(first.ref, first)

        assertEquals(listOf("s0", "s1", "s2"), sessions.map { it.nativeSessionID })
        assertEquals(listOf<String?>("next"), rpc.cursors.toList())
        assertEquals(first.sessions, service.sessions(first.ref, first.copy(sessionCursor = null)))
        assertEquals(1, rpc.workspaceCalls)
    }

    @Test
    fun `gate off never calls the backend`() = runBlocking(Dispatchers.Default) {
        val rpc = FakeRpc()
        val service = KiloHostedService(cs = cs, rpc = rpc, gate = { false }, log = TestLog(), repo = { "repo" })

        service.refresh("/repo")

        assertEquals(false, service.state.value.enabled)
        assertTrue(service.state.value.items.isEmpty())
        assertEquals(0, rpc.workspaceCalls)
    }

    @Test
    fun `refresh reloads hosted rows and emits an invalidation each time`() = runBlocking(Dispatchers.Default) {
        val pages = mutableMapOf<String?, HostedWorkspaceListDto>(
            null to HostedWorkspaceListDto(items = listOf(workspace("1"))),
        )
        val service = KiloHostedService(
            cs = cs,
            rpc = FakeRpc(pages = pages),
            gate = { true },
            log = TestLog(),
            repo = { "repo" },
        )
        service.refresh("/repo")
        withTimeout(5_000) { service.state.first { !it.loading && it.items.isNotEmpty() } }
        assertEquals(1L, service.refreshes.value)
        pages[null] = HostedWorkspaceListDto(items = listOf(workspace("2")))

        service.refresh("/repo")
        val state = withTimeout(5_000) {
            service.state.first { !it.loading && it.items.firstOrNull()?.ref?.workspaceID == "wrk_2" }
        }

        assertEquals(listOf("wrk_2"), state.items.map { it.ref.workspaceID })
        assertEquals(2L, service.refreshes.value)
    }

    @Test
    fun `live status is ordered independently from preparation and preserves billing`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "wrk_1")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        rpc.status = HostedWorkspaceStatusDto(ref, "active", "sleeping", "sandbox_stopped", 100.0,
            estimatedSleepAt = 500.0, wakeAvailable = true, rateMicrodollarsPerHour = 123, billingBlocked = false)
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.status(ref)
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            rpc.events.emit(HostedSystemEventDto(key, "cloud.status", cloudStatus = "preparing", observedAt = 110.0))
            withTimeout(WAIT) { service.state.first { it.presentation(ref)?.computeStatus == "starting" } }
            assertEquals("sleeping", service.state.value.statuses[ref.key]?.computeStatus)
            rpc.events.emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "running",
                sandboxDetail = "ready", observedAt = 200.0))
            withTimeout(WAIT) { service.state.first { it.statuses[ref.key]?.computeStatus == "running" } }
            assertEquals("setting_up", service.state.value.presentation(ref)?.computeStatus)
            rpc.events.emit(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 120.0))
            withTimeout(WAIT) { service.state.first { it.preparations[key]?.cloudStatus == "idle" } }
            assertEquals("running", service.state.value.presentation(ref)?.computeStatus)
            rpc.events.emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping", observedAt = 150.0))
            rpc.status = rpc.status!!.copy(observedAt = 160.0)
            assertEquals("running", service.status(ref).computeStatus)
            val live = service.state.value.statuses.getValue(ref.key)
            assertEquals(500.0, live.estimatedSleepAt)
            assertEquals(123L, live.rateMicrodollarsPerHour)
            assertTrue(live.wakeAvailable)
            assertEquals(false, live.billingBlocked)
            rpc.events.emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping",
                sandboxDetail = "sandbox_stopped", observedAt = 300.0))
            withTimeout(WAIT) { service.state.first { it.presentation(ref)?.computeStatus == "sleeping" } }
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `colliding native IDs and stale replay remain isolated with unknown baseline`() = runBlocking {
        val one = HostedWorkspaceRefDto("cloud", "one")
        val two = HostedWorkspaceRefDto("cloud", "two")
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(one, "same", parent)
            service.observe(two, "same", parent)
            repeat(2) { withTimeout(WAIT) { rpc.opened.receive() } }
            rpc.events.emit(HostedSystemEventDto("${one.key}:same", "cloud.status", cloudStatus = "preparing", observedAt = 100.0))
            rpc.events.emit(HostedSystemEventDto("${two.key}:same", "cloud.status", cloudStatus = "idle", observedAt = 20.0))
            withTimeout(WAIT) { service.state.first { it.preparations.size == 2 } }
            assertEquals("unknown", service.state.value.statuses[one.key]?.computeStatus)
            assertEquals("starting", service.state.value.presentation(one)?.computeStatus)
            rpc.events.emit(HostedSystemEventDto("${one.key}:same", "cloud.status", cloudStatus = "idle", observedAt = 90.0))
            rpc.events.emit(HostedSystemEventDto("${two.key}:same", "cloud.sandbox.status", sandboxStatus = "sleeping", observedAt = 30.0))
            withTimeout(WAIT) { service.state.first { it.statuses[two.key]?.computeStatus == "sleeping" } }
            assertEquals("preparing", service.state.value.preparations["${one.key}:same"]?.cloudStatus)
            rpc.events.emit(HostedSystemEventDto("${one.key}:same", "cloud.status", cloudStatus = "idle", observedAt = 110.0))
            withTimeout(WAIT) { service.state.first { it.preparations["${one.key}:same"]?.cloudStatus == "idle" } }
            assertEquals("unknown", service.state.value.presentation(one)?.computeStatus)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `preparation progresses by attempt revision independently of lifecycle and sandbox timestamps`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        rpc.status = HostedWorkspaceStatusDto(ref, "active", "sleeping", "sandbox_stopped", 1000.0,
            wakeAvailable = true, rateMicrodollarsPerHour = 123, billingBlocked = false)
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.status(ref)
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "preparing", observedAt = 900.0))
            val started = HostedSystemEventDto(key, "preparing", step = "cloning", action = "step_started",
                message = "Cloning repo", observedAt = 110.0, attemptID = "attempt_1", revision = 2)
            rpc.send(started)
            assertEquals("Cloning repo", service.state.value.preparation(key)?.message)
            val progress = started.copy(action = "step_progress", message = "Receiving objects: 33%",
                observedAt = 120.0, revision = 3)
            rpc.send(progress)
            assertEquals("Receiving objects: 33%", service.state.value.preparation(key)?.message)
            rpc.send(started.copy(action = "running", message = "Old snapshot", observedAt = 9999.0))
            rpc.send(progress.copy(message = "Duplicate must not replace detail", observedAt = 10000.0))
            assertEquals("Receiving objects: 33%", service.state.value.preparation(key)?.message)
            rpc.send(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "running", observedAt = 2000.0))
            rpc.send(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping", observedAt = 1500.0))
            assertEquals("running", service.state.value.statuses[ref.key]?.computeStatus)
            rpc.send(progress.copy(message = "Receiving objects: 66%", observedAt = 0.0, revision = 6))
            assertEquals("Receiving objects: 66%", service.state.value.preparation(key)?.message)
            assertEquals(120.0, service.state.value.preparation(key)?.observedAt)
            rpc.send(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping", observedAt = 3000.0))
            assertEquals("starting", service.state.value.presentation(ref)?.computeStatus)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle"))
            assertNull(service.state.value.preparation(key))
            assertEquals("Receiving objects: 66%", service.state.value.preparations[key]?.message)
            assertEquals("sleeping", service.state.value.presentation(ref)?.computeStatus)
            val status = service.state.value.statuses.getValue(ref.key)
            assertTrue(status.wakeAvailable)
            assertEquals(123L, status.rateMicrodollarsPerHour)
            assertEquals(false, status.billingBlocked)
            rpc.send(progress.copy(message = "Stale replay", revision = 6))
            assertNull(service.state.value.preparation(key))
            rpc.send(progress.copy(message = "Receiving objects: 90%", observedAt = 0.0, revision = 7))
            assertEquals("Receiving objects: 90%", service.state.value.preparation(key)?.message)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle"))
            assertNull(service.state.value.preparation(key))
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `untimed progress supersedes an old idle snapshot without an invented timestamp`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 900.0))
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "preparing"))
            val progress = HostedSystemEventDto(key, "preparing", step = "cloning", action = "step_progress",
                message = "Receiving objects: 33%")
            rpc.send(progress)
            rpc.send(progress.copy(message = "Receiving objects: 66%"))
            assertEquals("Receiving objects: 66%", service.state.value.preparation(key)?.message)
            assertEquals(0.0, service.state.value.preparation(key)?.observedAt)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle"))
            assertNull(service.state.value.preparation(key))
            rpc.send(progress.copy(message = "Receiving objects: 90%"))
            assertEquals("Receiving objects: 90%", service.state.value.preparation(key)?.message)
            assertEquals(0.0, service.state.value.preparation(key)?.observedAt)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `attempt snapshots enrich equal revision steps and do not reopen a completed attempt`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            val attempt = HostedSystemEventDto(key, "preparing", action = "attempt_started", observedAt = 100.0,
                attemptID = "attempt_1", revision = 5)
            rpc.send(attempt)
            rpc.send(attempt.copy(step = "cloning", action = "running", message = "Receiving objects: 66%"))
            assertEquals("Receiving objects: 66%", service.state.value.preparation(key)?.message)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 90.0))
            assertEquals("Receiving objects: 66%", service.state.value.preparation(key)?.message)
            rpc.send(attempt.copy(action = "attempt_completed", observedAt = 110.0, revision = 6))
            assertNull(service.state.value.preparation(key))
            rpc.send(attempt.copy(step = "cloning", action = "completed", message = "Cloned",
                observedAt = 110.0, revision = 6))
            assertNull(service.state.value.preparation(key))
            assertEquals("attempt_completed", service.state.value.preparations[key]?.action)
            assertEquals("Cloned", service.state.value.preparations[key]?.message)
            val fresh = attempt.copy(attemptID = "attempt_2", observedAt = 200.0, revision = 1)
            rpc.send(fresh)
            assertEquals("attempt_2", service.state.value.preparation(key)?.attemptID)
            assertNull(service.state.value.preparation(key)?.message)
            rpc.send(attempt.copy(step = "cloning", action = "running", message = "Old attempt",
                observedAt = 9999.0, revision = 100))
            assertEquals("attempt_2", service.state.value.preparation(key)?.attemptID)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `step completion stays visible until whole attempt terminal or Cloud lifecycle ends`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val key = "${ref.key}:same"
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            val step = HostedSystemEventDto(key, "preparing", step = "cloning", action = "step_completed",
                message = "Cloned", observedAt = 100.0, attemptID = "attempt_1", revision = 3)
            rpc.send(step)
            assertEquals("Cloned", service.state.value.preparation(key)?.message)
            rpc.send(step.copy(step = "setup_commands", action = "step_started", message = "Setting up",
                observedAt = 110.0, revision = 4))
            rpc.send(step.copy(step = null, action = "attempt_failed", message = "Setup failed",
                observedAt = 120.0, revision = 5))
            assertNull(service.state.value.preparation(key))
            assertEquals("error", service.state.value.preparations[key]?.cloudStatus)
            assertEquals("Setup failed", service.state.value.preparations[key]?.message)
            rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = "preparing"))
            rpc.send(step.copy(attemptID = "attempt_2", action = "step_started", message = "Cloning repo",
                observedAt = 200.0, revision = 1))
            for (status in listOf("ready", "running", "idle")) {
                rpc.send(HostedSystemEventDto(key, "cloud.status", cloudStatus = status))
                assertNull(service.state.value.preparation(key))
            }
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `progress with colliding session and attempt IDs stays isolated between workspaces`() = runBlocking {
        val one = HostedWorkspaceRefDto("cloud", "one")
        val two = HostedWorkspaceRefDto("cloud", "two")
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(one, "same", parent)
            service.observe(two, "same", parent)
            repeat(2) { withTimeout(WAIT) { rpc.opened.receive() } }
            withTimeout(WAIT) { rpc.events.subscriptionCount.first { it == 2 } }
            val progress = HostedSystemEventDto("${one.key}:same", "preparing", step = "cloning",
                action = "step_progress", message = "Receiving objects: 33%", attemptID = "same", revision = 3)
            rpc.send(progress)
            rpc.send(progress.copy(sessionID = "${two.key}:same", message = "Receiving objects: 66%", revision = 6))
            rpc.send(HostedSystemEventDto("${one.key}:same", "cloud.status", cloudStatus = "idle"))
            assertNull(service.state.value.preparation("${one.key}:same"))
            assertEquals("Receiving objects: 66%", service.state.value.preparation("${two.key}:same")?.message)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `equal timestamp probe refreshes billing without replacing live compute`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            rpc.events.emit(HostedSystemEventDto("${ref.key}:same", "cloud.sandbox.status",
                sandboxStatus = "running", sandboxDetail = "ready", observedAt = 100.0))
            withTimeout(WAIT) { service.state.first { it.statuses[ref.key]?.observedAt == 100.0 } }
            rpc.status = HostedWorkspaceStatusDto(ref, "active", "sleeping", "sandbox_stopped", 100.0,
                rateMicrodollarsPerHour = 321, wakeAvailable = true)
            val status = service.status(ref)
            assertEquals("running", status.computeStatus)
            assertEquals("ready", status.computeDetail)
            assertEquals(321L, status.rateMicrodollarsPerHour)
            assertTrue(status.wakeAvailable)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `discovery and consumers share one feed and removal releases it`() = runBlocking {
        val ws = workspace("1")
        val pages = mutableMapOf<String?, HostedWorkspaceListDto>(null to HostedWorkspaceListDto(items = listOf(ws)))
        val rpc = FakeRpc(pages)
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog(), repo = { "repo" })
        service.refresh("/repo")
        withTimeout(WAIT) { service.state.first { !it.loading && it.items.isNotEmpty() } }
        withTimeout(WAIT) { rpc.opened.receive() }
        val parent = Disposer.newDisposable()
        service.observe(ws.ref, ws.sessions.single().nativeSessionID, parent)
        Disposer.dispose(parent)
        assertTrue(rpc.closed.tryReceive().isFailure)
        assertTrue(rpc.opened.tryReceive().isFailure)
        pages[null] = HostedWorkspaceListDto()
        service.refresh("/repo")
        withTimeout(WAIT) { rpc.closed.receive() }
        withTimeout(WAIT) { service.state.first { !it.loading && it.items.isEmpty() } }
        assertTrue(service.state.value.statuses.isEmpty())
    }

    @Test
    fun `slow discovery snapshot cannot replace newer live status`() = runBlocking {
        val ws = workspace("1")
        val rpc = FakeRpc(mapOf(null to HostedWorkspaceListDto(items = listOf(ws))))
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog(), repo = { "repo" })
        val parent = Disposer.newDisposable()
        try {
            service.observe(ws.ref, "ses_1", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            rpc.gate = CompletableDeferred()
            service.refresh("/repo")
            withTimeout(WAIT) { rpc.reading.receive() }
            rpc.events.emit(HostedSystemEventDto("${ws.ref.key}:ses_1", "cloud.sandbox.status",
                sandboxStatus = "sleeping", observedAt = 100.0))
            withTimeout(WAIT) { service.state.first { it.statuses[ws.ref.key]?.observedAt == 100.0 } }
            rpc.gate!!.complete(Unit)
            val state = withTimeout(WAIT) { service.state.first { !it.loading && it.items.isNotEmpty() } }
            assertEquals("sleeping", state.statuses[ws.ref.key]?.computeStatus)
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `collection failures reconnect and consumer disposal cancels the recovered feed`() = runBlocking {
        val rpc = FakeRpc().also { it.fail = true }
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        service.observe(HostedWorkspaceRefDto("cloud", "one"), "same", parent)
        withTimeout(WAIT) { rpc.opened.receive(); rpc.closed.receive(); rpc.opened.receive() }
        Disposer.dispose(parent)
        withTimeout(WAIT) { rpc.closed.receive() }
        assertTrue(rpc.opened.tryReceive().isFailure)
    }

    @Test
    fun `collection failures back off and log repeated attempts at debug until connection`() = runBlocking {
        val ref = HostedWorkspaceRefDto("cloud", "one")
        val waits = Channel<Pair<Long, CompletableDeferred<Unit>>>(Channel.UNLIMITED)
        val calls = Channel<Int>(Channel.UNLIMITED)
        val log = TestLog()
        var count = 0
        val rpc = object : KiloHostedRpcApi by FakeRpc() {
            override suspend fun systemEvents(
                ref: HostedWorkspaceRefDto,
                sessionID: String,
                organizationID: String?,
            ): Flow<HostedSystemEventDto> = flow {
                count++
                calls.send(count)
                if (count <= 3) error("failure $count")
                emit(HostedSystemEventDto("${ref.key}:$sessionID", "cloud.sandbox.status",
                    sandboxStatus = "running", observedAt = 4.0))
                awaitCancellation()
            }
        }
        val service = KiloHostedService(cs, rpc, gate = { true }, log = log, pause = { ms ->
            CompletableDeferred<Unit>().also { waits.send(ms to it) }.await()
        })
        val parent = Disposer.newDisposable()
        try {
            service.observe(ref, "same", parent)
            assertEquals(1, withTimeout(WAIT) { calls.receive() })
            val first = withTimeout(WAIT) { waits.receive() }
            assertEquals(1_000L, first.first)
            first.second.complete(Unit)
            assertEquals(2, withTimeout(WAIT) { calls.receive() })
            val second = withTimeout(WAIT) { waits.receive() }
            assertEquals(2_000L, second.first)
            second.second.complete(Unit)
            assertEquals(3, withTimeout(WAIT) { calls.receive() })
            val third = withTimeout(WAIT) { waits.receive() }
            assertEquals(4_000L, third.first)
            third.second.complete(Unit)
            assertEquals(4, withTimeout(WAIT) { calls.receive() })
            withTimeout(WAIT) { service.state.first { it.statuses[ref.key]?.computeStatus == "running" } }
            assertEquals(1, log.messages.count { it.startsWith("WARN: hosted system observation failed") })
            assertEquals(2, log.messages.count { it.startsWith("DEBUG: hosted system observation failed") })
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `project scope cancellation closes owned collection`() = runBlocking {
        val rpc = FakeRpc()
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog())
        val parent = Disposer.newDisposable()
        try {
            service.observe(HostedWorkspaceRefDto("cloud", "one"), "same", parent)
            withTimeout(WAIT) { rpc.opened.receive() }
            cs.cancel()
            withTimeout(WAIT) { rpc.closed.receive() }
        } finally { Disposer.dispose(parent) }
    }

    @Test
    fun `gate disable and signout clear observers and cached state`() = runBlocking {
        val pages = mutableMapOf<String?, HostedWorkspaceListDto>(null to HostedWorkspaceListDto(items = listOf(workspace("1"))))
        val rpc = FakeRpc(pages)
        var enabled = true
        val service = KiloHostedService(cs, rpc, gate = { enabled }, log = TestLog(), repo = { "repo" })
        service.refresh("/repo-active")
        withTimeout(WAIT) { rpc.opened.receive() }
        pages[null] = HostedWorkspaceListDto(signedOut = true)
        service.refresh("/repo-signed-out")
        withTimeout(WAIT) { rpc.closed.receive() }
        withTimeout(WAIT) { service.state.first { it.signedOut } }
        assertTrue(service.state.value.statuses.isEmpty())
        pages[null] = HostedWorkspaceListDto(items = listOf(workspace("1")))
        service.refresh("/repo-signed-in")
        withTimeout(WAIT) { rpc.opened.receive() }
        enabled = false
        service.refresh("/repo-disabled")
        withTimeout(WAIT) { rpc.closed.receive() }
        assertEquals(false, service.state.value.enabled)
    }

    private fun workspace(id: String): HostedWorkspaceDto = HostedWorkspaceDto(
        ref = HostedWorkspaceRefDto("cloud", "wrk_$id"),
        name = "Repo $id",
        repositoryUrl = "https://github.com/Kilo-Org/kilocode",
        branch = "main",
        sessions = listOf(session("ses_$id")),
    )

    private fun sessionPage(vararg ids: String, cursor: String?) = HostedWorkspaceDto(
        ref = HostedWorkspaceRefDto("cloud", "wrk_1"),
        sessions = ids.map { session(it) },
        sessionCursor = cursor,
    )

    @Test
    fun `status reads are bounded for repositories with many workspaces`() = runBlocking {
        val items = (1..20).map { HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "wrk_$it"), name = "ws$it") }
        val rpc = FakeRpc(mapOf(null to HostedWorkspaceListDto(items)))
        rpc.statusDelay = 25
        val service = KiloHostedService(cs, rpc, gate = { true }, log = TestLog(), repo = { "repo" })
        service.refresh("/repo")
        val state = withTimeout(WAIT) { service.state.first { it.items.size == 20 && !it.loading } }
        assertEquals(20, state.statuses.size)
        assertTrue(rpc.maxStatuses in 1..8, "max concurrent status reads=${rpc.maxStatuses}")
    }

    private fun session(id: String) = HostedWorkspaceSessionDto(
        id = "hosted:cloud:wrk_1:$id",
        nativeSessionID = id,
        title = id,
        created = 1.0,
        updated = 1.0,
    )

    private class FakeRpc(
        private val pages: Map<String?, HostedWorkspaceListDto> = emptyMap(),
        private val sessionPages: Map<String?, HostedWorkspaceDto> = emptyMap(),
    ) : KiloHostedRpcApi {
        var workspaceCalls = 0
            private set
        val requests = mutableListOf<Pair<String?, String?>>()
        val cursors = mutableListOf<String?>()
        val events = MutableSharedFlow<HostedSystemEventDto>(extraBufferCapacity = 16, replay = 16)
        val opened = Channel<Unit>(Channel.UNLIMITED)
        val closed = Channel<Unit>(Channel.UNLIMITED)
        val reading = Channel<Unit>(Channel.UNLIMITED)
        val received = Channel<HostedSystemEventDto>(Channel.UNLIMITED)
        var gate: CompletableDeferred<Unit>? = null
        var status: HostedWorkspaceStatusDto? = null
        var fail = false
        @Volatile var statusDelay = 0L
        @Volatile var maxStatuses = 0
        private val activeStatuses = java.util.concurrent.atomic.AtomicInteger()

        suspend fun send(event: HostedSystemEventDto) {
            val count = withTimeout(WAIT) { events.subscriptionCount.first { it > 0 } }
            events.emit(event)
            repeat(count) { withTimeout(WAIT) { assertEquals(event, received.receive()) } }
        }

        override suspend fun providers(): List<HostedProviderDto> =
            pages.values.firstOrNull()?.providers ?: emptyList()

        override suspend fun workspaces(
            repositoryUrl: String?,
            cursor: String?,
            organizationID: String?,
        ): HostedWorkspaceListDto {
            requests += repositoryUrl to cursor
            return pages.getValue(cursor)
        }

        override suspend fun workspace(
            ref: HostedWorkspaceRefDto,
            sessionCursor: String?,
            organizationID: String?,
        ): HostedWorkspaceDto {
            workspaceCalls++
            cursors += sessionCursor
            return sessionPages.getValue(sessionCursor)
        }

        override suspend fun workspaceStatus(
            ref: HostedWorkspaceRefDto,
            organizationID: String?,
        ): HostedWorkspaceStatusDto {
            maxStatuses = maxOf(maxStatuses, activeStatuses.incrementAndGet())
            try {
                if (statusDelay > 0) delay(statusDelay)
                reading.send(Unit)
                gate?.await()
                return status ?: HostedWorkspaceStatusDto(
            ref = ref,
            deletionState = "active",
            computeStatus = "running",
            computeDetail = "ready",
            observedAt = 1.0,
            activeSessionCount = 1,
            rateMicrodollarsPerHour = 1_000_000,
        )
            } finally {
                activeStatuses.decrementAndGet()
            }
        }

        override suspend fun systemEvents(
            ref: HostedWorkspaceRefDto,
            sessionID: String,
            organizationID: String?,
        ): Flow<HostedSystemEventDto> = flow {
            try {
                opened.send(Unit)
                if (fail) { fail = false; error("connection lost during collection") }
                events.collect { emit(it); received.send(it) }
            } finally { closed.trySend(Unit) }
        }
    }
}
