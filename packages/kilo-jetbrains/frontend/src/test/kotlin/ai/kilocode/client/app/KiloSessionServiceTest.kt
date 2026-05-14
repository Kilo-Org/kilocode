package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.rpc.dto.SessionTimeDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

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

    private fun session(id: String, title: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = title,
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )
}
