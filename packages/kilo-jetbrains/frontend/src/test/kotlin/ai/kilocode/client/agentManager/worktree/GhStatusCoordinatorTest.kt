package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.installBrowser
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.GhAvailability
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import kotlinx.coroutines.CompletableDeferred

@Suppress("UnstableApiUsage")
class GhStatusCoordinatorTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeWorktreeRpcApi
    private lateinit var timers: TestUiTimers
    private lateinit var service: GhStatusCoordinator

    override fun setUp() {
        super.setUp()
        installBrowser()
        coroutines = TestCoroutines()
        rpc = FakeWorktreeRpcApi()
        timers = TestUiTimers()
        ApplicationManager.getApplication()
            .replaceService(KiloWorktreeService::class.java, KiloWorktreeService(coroutines.scope, rpc), testRootDisposable)
        service = GhStatusCoordinator(coroutines.scope, timers)
        ApplicationManager.getApplication().replaceService(GhStatusCoordinator::class.java, service, testRootDisposable)
    }

    override fun tearDown() {
        try {
            coroutines.close(::pump)
        } finally {
            super.tearDown()
        }
    }

    fun `test coordinator publishes only state transitions`() {
        val events = mutableListOf<GhAvailability>()
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(GhStatusListener.TOPIC, GhStatusListener { events += it })

        report(GhAvailability.MISSING)
        report(GhAvailability.MISSING)
        report(GhAvailability.OK)
        report(GhAvailability.UNAUTH)

        assertEquals(listOf(GhAvailability.MISSING, GhAvailability.OK, GhAvailability.UNAUTH), events)
        assertEquals(GhAvailability.UNAUTH, service<GhStatusCoordinator>().current())
    }

    fun `test coordinator polls fast while unauthorized and relaxes after recovery`() {
        rpc.ghResult = GhAvailability.UNAUTH
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(GhAvailability.UNAUTH, service.current())
        assertEquals(1, rpc.ghCalls.size)

        timers.advanceBy(4_999)
        drain()
        assertEquals(1, rpc.ghCalls.size)

        rpc.ghResult = GhAvailability.OK
        timers.advanceBy(1)
        drain()
        assertEquals(GhAvailability.OK, service.current())
        assertEquals(2, rpc.ghCalls.size)

        timers.advanceBy(29_999)
        drain()
        assertEquals(2, rpc.ghCalls.size)

        timers.advanceBy(1)
        drain()
        assertEquals(3, rpc.ghCalls.size)
        handle.close()
    }

    fun `test coordinator backs off on backend failure without reporting ok`() {
        rpc.ghResult = GhAvailability.UNAUTH
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(GhAvailability.UNAUTH, service.current())
        assertEquals(1, rpc.ghCalls.size)

        // A backend/RPC failure must reach the coordinator's failure path, not be laundered into OK.
        rpc.beforeGhStatus = { throw RuntimeException("backend down") }
        timers.advanceBy(5_000)
        drain()
        assertEquals(2, rpc.ghCalls.size)
        assertEquals(GhAvailability.UNAUTH, service.current())

        // failures>0 now drives exponential backoff instead of the steady FAST cadence.
        timers.advanceBy(5_000)
        drain()
        assertEquals(3, rpc.ghCalls.size)
        assertEquals(GhAvailability.UNAUTH, service.current())
        handle.close()
    }

    fun `test coordinator stops polling after detach`() {
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(1, rpc.ghCalls.size)

        handle.close()
        timers.advanceBy(120_000)
        drain()

        assertEquals(1, rpc.ghCalls.size)
    }

    fun `test coordinator skips forced probes while busy instead of queueing`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGhStatus = { gate.await() }
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)

        edtWait { service.forceProbe("test") }
        timers.advanceBy(0)
        pump()
        assertEquals(1, rpc.ghCalls.size)

        gate.complete(Unit)
        drain()
        assertEquals(1, rpc.ghCalls.size)
        handle.close()
    }

    private fun report(value: GhAvailability) {
        edtWait { service.report(project, value) }
        pump()
    }

    private fun drain() = coroutines.drain()

    private fun awaitCalls(count: Int) {
        assertTrue(coroutines.pumpUntil { rpc.ghCalls.size >= count })
    }

    private fun pump() = pumpEdt()
}
