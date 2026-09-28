package ai.kilocode.client.app

import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.TestLog
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionStatusDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.assertFailsWith

@Suppress("UnstableApiUsage")
class KiloSessionServiceTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeSessionRpcApi
    private lateinit var service: KiloSessionService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeSessionRpcApi()
        service = KiloSessionService(project, scope, rpc)
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test rename replaces cached session in sessions value`() = runBlocking(Dispatchers.Default) {
        rpc.listed += session("ses_1", "Original")
        rpc.listed += session("ses_2", "Other")
        service.list("/test")

        assertEquals(2, service.sessions.value.size)
        assertEquals("Original", service.sessions.value.find { it.id == "ses_1" }!!.title)

        service.renameSession("ses_1", "/test", "Renamed")

        assertEquals(2, service.sessions.value.size)
        assertEquals("Renamed", service.sessions.value.find { it.id == "ses_1" }!!.title)
        assertEquals("Other", service.sessions.value.find { it.id == "ses_2" }!!.title)
    }

    fun `test rename of unknown id does not insert new item`() = runBlocking(Dispatchers.Default) {
        rpc.listed += session("ses_1", "Original")
        service.list("/test")

        assertEquals(1, service.sessions.value.size)

        service.renameSession("ses_unknown", "/test", "Should Not Insert")

        // Size remains 1 — no unexpected insert
        assertEquals(1, service.sessions.value.size)
        assertEquals("ses_1", service.sessions.value[0].id)
    }

    fun `test rename failure propagates exception without mutating cache`() = runBlocking(Dispatchers.Default) {
        rpc.listed += session("ses_1", "Original")
        service.list("/test")

        val before = service.sessions.value.toList()
        rpc.renameThrows = RuntimeException("server error")

        var threw = false
        try {
            service.renameSession("ses_1", "/test", "Renamed")
        } catch (_: RuntimeException) {
            threw = true
        }

        assertTrue(threw)
        assertEquals(before.map { it.id to it.title }, service.sessions.value.map { it.id to it.title })
    }

    fun `test list populates sessions value`() = runBlocking(Dispatchers.Default) {
        rpc.listed += session("ses_1", "One")
        rpc.listed += session("ses_2", "Two")

        service.list("/test")

        assertEquals(2, service.sessions.value.size)
        assertTrue(service.sessions.value.any { it.id == "ses_1" })
        assertTrue(service.sessions.value.any { it.id == "ses_2" })
    }

    fun `test enhance prompt delegates directory and text`() = runBlocking(Dispatchers.Default) {
        rpc.enhanced = "Use a focused implementation plan"

        val result = service.enhancePrompt("/workspace", "make a plan")

        assertEquals("Use a focused implementation plan", result)
        assertEquals(listOf("/workspace" to "make a plan"), rpc.enhancements)
    }

    fun `test events logs normal completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        service = KiloSessionService(project, scope, rpc, log)
        rpc.eventFlow = { _, _ -> flowOf(ChatEventDto.TurnOpen("ses_test")) }

        service.events("ses_test", "/test").toList()

        assertTrue(log.messages.joinToString("\n"), log.messages.any { it.contains("route=client-events start=true") })
        assertTrue(log.messages.joinToString("\n"), log.messages.any { it.contains("route=client-events stop=true cancelled=false") })
    }

    fun `test events logs cancelled completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        service = KiloSessionService(project, scope, rpc, log)
        val job = launch { service.events("ses_test", "/test").collect {} }
        assertTrue(log.awaitMessage { it.contains("route=client-events start=true") })

        job.cancelAndJoin()

        assertTrue(log.messages.joinToString("\n"), log.messages.any { it.contains("route=client-events stop=true cancelled=true") })
    }

    fun `test events logs failed completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        service = KiloSessionService(project, scope, rpc, log)
        rpc.eventFlow = { _, _ -> flow { throw IllegalStateException("stream failed") } }

        assertFailsWith<IllegalStateException> {
            service.events("ses_test", "/test").toList()
        }

        assertTrue(log.messages.joinToString("\n"), log.messages.any { it.contains("route=client-events stop=true failed message=stream failed") })
    }

    fun `test activity snapshot carries every kind the backend reports`() = runBlocking(Dispatchers.Default) {
        // A busy session the backend cannot place in a directory, so only the status map has it.
        rpc.statuses.value = mapOf("ses_busy" to SessionStatusDto("busy"))
        rpc.activity.value = mapOf(
            "ses_failed" to SessionActivityDto("/repo/wt", SessionActivityKindDto.ERROR),
            "ses_asking" to SessionActivityDto("/repo/wt", SessionActivityKindDto.QUESTION),
        )
        // Both maps feed the snapshot through separate collectors, so wait for each one.
        service.statuses.first { it.isNotEmpty() }
        service.activity.first { it.size == 2 }

        assertEquals(
            mapOf(
                "ses_busy" to SessionActivityKind.RUNNING,
                "ses_failed" to SessionActivityKind.ERROR,
                "ses_asking" to SessionActivityKind.QUESTION,
            ),
            service.activitySnapshot(),
        )
    }

    fun `test deleting a session prunes its lingering activity and status entries`() = runBlocking(Dispatchers.Default) {
        rpc.statuses.value = mapOf("ses_asking" to SessionStatusDto("busy"))
        rpc.activity.value = mapOf(
            "ses_asking" to SessionActivityDto("/repo/wt", SessionActivityKindDto.QUESTION),
            "ses_failed" to SessionActivityDto("/repo/wt", SessionActivityKindDto.ERROR),
        )
        service.activity.first { it.size == 2 }

        // The backend keeps reporting the question/error for a deleted session, so the entry must be
        // pruned locally or the badge lingers on every derived surface.
        service.deleteSession("ses_asking", "/repo/wt")
        service.activity.first { "ses_asking" !in it }

        assertEquals(mapOf("ses_failed" to SessionActivityKind.ERROR), service.activitySnapshot())
    }

    fun `test a permission answered inside the grace window never reaches the activity flow`() = runBlocking(Dispatchers.Default) {
        val seen = mutableListOf<Map<String, SessionActivityDto>>()
        val job = launch { service.activity.collect { seen += it } }

        // Mirrors a JetBrains auto-approved edit: the CLI still asks, the client replies `once`
        // right away, so the permission and its resolution land back to back.
        rpc.activity.value = mapOf("ses_1" to SessionActivityDto("/repo/wt", SessionActivityKindDto.PERMISSION))
        rpc.activity.value = mapOf("ses_1" to SessionActivityDto("/repo/wt", SessionActivityKindDto.RUNNING))

        service.activity.first { it["ses_1"]?.kind == SessionActivityKindDto.RUNNING }
        job.cancelAndJoin()

        assertTrue(seen.none { it["ses_1"]?.kind == SessionActivityKindDto.PERMISSION })
    }

    fun `test a permission still pending after the grace window reaches the activity flow`() = runBlocking(Dispatchers.Default) {
        service = KiloSessionService(project, scope, rpc, grace = 50)

        rpc.activity.value = mapOf("ses_1" to SessionActivityDto("/repo/wt", SessionActivityKindDto.PERMISSION))

        val result = service.activity.first { it["ses_1"]?.kind == SessionActivityKindDto.PERMISSION }

        assertEquals(SessionActivityKindDto.PERMISSION, result["ses_1"]?.kind)
    }

    fun `test a session entering attention does not hold back the rest of the snapshot`() = runBlocking(Dispatchers.Default) {
        service = KiloSessionService(project, scope, rpc, grace = 5_000)

        // One snapshot, three sessions: only the one newly waiting on the user may be held.
        rpc.activity.value = mapOf(
            "ses_1" to SessionActivityDto("/repo/wt", SessionActivityKindDto.PERMISSION),
            "ses_2" to SessionActivityDto("/repo/wt", SessionActivityKindDto.ERROR),
            "ses_3" to SessionActivityDto("/repo/wt", SessionActivityKindDto.RUNNING),
        )

        // A 5s grace would time this out if the whole map were delayed with the permission.
        val settled = withTimeout(1_000) { service.activity.first { it.size == 2 } }

        assertEquals(SessionActivityKindDto.ERROR, settled["ses_2"]?.kind)
        assertEquals(SessionActivityKindDto.RUNNING, settled["ses_3"]?.kind)
        assertNull(settled["ses_1"])
    }

    fun `test clearing activity is not delayed`() = runBlocking(Dispatchers.Default) {
        service = KiloSessionService(project, scope, rpc, grace = 5_000)
        rpc.activity.value = mapOf("ses_1" to SessionActivityDto("/repo/wt", SessionActivityKindDto.RUNNING))
        service.activity.first { it["ses_1"]?.kind == SessionActivityKindDto.RUNNING }

        rpc.activity.value = emptyMap()

        // A 5s grace would time this out if clearing were delayed with it.
        val cleared = withTimeout(1_000) { service.activity.first { it.isEmpty() } }
        assertTrue(cleared.isEmpty())
    }

    private fun session(id: String, title: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = title,
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )
}
