package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.testing.FakeWorktreeRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.fakeRoot
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.testing.TestUiTimers
import ai.kilocode.client.testing.activateIde
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
        // The probe resolves the backend project root before each call.
        fakeRoot(project, coroutines.scope, testRootDisposable, ROOT)
        service = GhStatusCoordinator(coroutines.scope, timers)
        ApplicationManager.getApplication().replaceService(GhStatusCoordinator::class.java, service, testRootDisposable)
    }

    override fun tearDown() {
        try {
            KiloPluginSettings.unsetGithub()
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

    fun `test coordinator probes the resolved backend root`() {
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)

        assertEquals(ROOT, rpc.ghCalls.first())
        assertFalse(rpc.ghCalls.contains(project.basePath))
        handle.close()
    }

    fun `test coordinator does not probe or latch when the root is unresolved`() {
        // A blank backend root must not call ghStatus, and must not leave the probe stuck busy:
        // the coordinator stays responsive to later reports.
        fakeRoot(project, coroutines.scope, testRootDisposable, "")
        val handle = edtWait { service.attach(project) }
        drain()
        assertTrue(rpc.ghCalls.isEmpty())

        report(GhAvailability.OK)
        assertEquals(GhAvailability.OK, service.current())
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

    fun `test coordinator drops submitted syncs while busy instead of queueing`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGhStatus = { gate.await() }
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)

        // Past the event throttle, so an in-flight probe is the only thing that can drop the submit.
        timers.advanceBy(EVENT_THROTTLE)
        edtWait { service.sync("test") }
        pump()
        assertEquals(1, rpc.ghCalls.size)

        gate.complete(Unit)
        drain()
        assertEquals(1, rpc.ghCalls.size)
        handle.close()
    }

    fun `test coordinator throttles a burst of submitted syncs`() {
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(1, rpc.ghCalls.size)

        // Focus and tab-switch events can arrive in bursts; inside the window they collapse to none.
        repeat(5) { edtWait { service.sync("burst") } }
        drain()
        assertEquals(1, rpc.ghCalls.size)

        timers.advanceBy(EVENT_THROTTLE)
        edtWait { service.sync("later") }
        drain()

        assertEquals(2, rpc.ghCalls.size)
        handle.close()
    }

    fun `test coordinator ignores submitted syncs while nothing is attached`() {
        edtWait { service.sync("detached") }
        drain()

        assertTrue(rpc.ghCalls.isEmpty())
    }

    fun `test coordinator syncs when the ide frame is activated`() {
        rpc.ghResult = GhAvailability.UNAUTH
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(GhAvailability.UNAUTH, service.current())
        assertEquals(1, rpc.ghCalls.size)
        timers.advanceBy(EVENT_THROTTLE)

        // The user authorized gh in a terminal and came back to the IDE.
        rpc.ghResult = GhAvailability.OK
        edtWait { activateIde(project) }
        drain()

        assertEquals(2, rpc.ghCalls.size)
        assertEquals(GhAvailability.OK, service.current())
        handle.close()
    }

    fun `test coordinator does not probe on activation before anything attaches`() {
        edtWait { activateIde(project) }
        drain()

        assertTrue(rpc.ghCalls.isEmpty())
    }

    fun `test coordinator probes git only while the github integration is off`() {
        rpc.ghResult = GhAvailability.UNAUTH
        val handle = edtWait { service.attach(project) }
        drain()
        assertEquals(GhAvailability.UNAUTH, service.current())

        github(false)
        drain()
        // Disabling publishes OK immediately so the banner hides without waiting for a probe.
        assertEquals(GhAvailability.OK, service.current())

        val before = rpc.ghCalls.size
        // SLOW cadence while disabled: the loop only checks whether git exists.
        timers.advanceBy(59_999)
        drain()
        assertEquals(before, rpc.ghCalls.size)

        timers.advanceBy(1)
        drain()
        assertEquals(before + 1, rpc.ghCalls.size)
        assertFalse("a disabled probe must never ask the backend to run gh", rpc.ghFlags.last())
        assertEquals(GhAvailability.OK, service.current())
        handle.close()
    }

    fun `test coordinator still reports a missing git while the github integration is off`() {
        rpc.ghResult = GhAvailability.GIT_MISSING
        github(false)
        val handle = edtWait { service.attach(project) }
        drain()

        assertEquals(GhAvailability.GIT_MISSING, service.current())
        assertFalse(rpc.ghFlags.last())
        handle.close()
    }

    fun `test coordinator ignores a stale gh report while the github integration is off`() {
        val events = mutableListOf<GhAvailability>()
        ApplicationManager.getApplication().messageBus.connect(testRootDisposable)
            .subscribe(GhStatusListener.TOPIC, GhStatusListener { events += it })
        github(false)

        // A prStatus lookup that was in flight at the moment of disabling.
        report(GhAvailability.UNAUTH)

        assertEquals(GhAvailability.OK, service.current())
        assertTrue(events.isEmpty())
    }

    fun `test coordinator cancels the in flight probe and reprobes when re-enabled`() {
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGhStatus = { gate.await() }
        val handle = edtWait { service.attach(project) }
        awaitCalls(1)

        // Disabling must not wait for the running gh call to finish.
        github(false)
        assertEquals(GhAvailability.OK, service.current())
        gate.complete(Unit)
        drain()

        rpc.beforeGhStatus = {}
        rpc.ghResult = GhAvailability.UNAUTH
        val before = rpc.ghCalls.size
        github(true)
        drain()

        assertEquals("re-enabling probes at once instead of waiting out the timer", before + 1, rpc.ghCalls.size)
        assertTrue(rpc.ghFlags.last())
        assertEquals(GhAvailability.UNAUTH, service.current())
        handle.close()
    }

    private fun report(value: GhAvailability) {
        edtWait { service.report(project, value) }
        pump()
    }

    private fun github(enabled: Boolean) {
        edtWait { setGithubIntegration(enabled, "test") }
        pump()
    }

    private fun drain() = coroutines.drain()

    private fun awaitCalls(count: Int) {
        assertTrue(coroutines.pumpUntil { rpc.ghCalls.size >= count })
    }

    private fun pump() = pumpEdt()

    private companion object {
        private const val ROOT = "/real/repo"

        /** Mirrors GhStatusCoordinator.EVENT_THROTTLE, the floor between event-driven syncs. */
        private const val EVENT_THROTTLE = 3_000L
    }
}
